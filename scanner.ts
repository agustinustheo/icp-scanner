/**
 * ICP Transaction Scanner
 * Parallel, reusable fetchers (start,length) for ICP and ICRC-3 ledgers.
 * Sanity checks and scanners share the same fetch code.
 */

import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import * as fs from "fs";

// ---------------- Env helpers ----------------
function envStr(name: string, def: string): string {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : def;
}
function envNum(name: string, def: number, min?: number): number {
  const raw = process.env[name];
  const n = raw !== undefined ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return def;
  if (min !== undefined && n < min) return def;
  return n;
}
function envDate(name: string, defISO: string): Date {
  const raw = process.env[name];
  if (!raw) return new Date(defISO);
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : new Date(defISO);
}
function envHex(name: string, def: string): string {
  const raw = process.env[name];
  const s = (raw ?? def).toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]*$/.test(s) ? s : def.toLowerCase();
}

// ---------------- Config ----------------
const WALLET_PRINCIPAL = envStr(
  "WALLET_PRINCIPAL",
  "ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe"
);
const ICP_ACCOUNT_ID_HEX = envHex(
  "ICP_ACCOUNT_ID_HEX",
  "e71fb5d09ec4082185c469d95ea1628e1fd5a6b3302cc7ed001df577995e9297"
);

const LEDGERS: Record<string, string> = {
  ICP: envStr("ICP_LEDGER", "ryjl3-tyaaa-aaaaa-aaaba-cai"),
  ckBTC: envStr("CKBTC_LEDGER", "mxzaz-hqaaa-aaaar-qaada-cai"),
  ckUSDC: envStr("CKUSDC_LEDGER", "xevnm-gaaaa-aaaar-qafnq-cai"),
  ckUSDT: envStr("CKUSDT_LEDGER", "cngnf-vqaaa-aaaar-qag4q-cai"),
};

// Time window (inclusive). Defaults to START=2025-06-01T00:00:00Z and END=now.
const START_DATE = envDate("START_DATE", "2025-06-01T00:00:00Z");
const END_DATE = envDate("END_DATE", new Date().toISOString());
const _start = START_DATE.getTime();
const _end = END_DATE.getTime();
const [FROM_MS, TO_MS] = _start <= _end ? [_start, _end] : [_end, _start];
const FROM_TS = BigInt(FROM_MS) * 1_000_000n; // nanoseconds
const TO_TS = BigInt(TO_MS) * 1_000_000n;

// Tuning knobs
const MAX_BLOCKS_PER_LEDGER = envNum("MAX_BLOCKS_PER_LEDGER", 4_000_000, 1);
const PAGE = envNum("PAGE", 1000, 1);
const PROGRESS_EVERY = envNum("PROGRESS_EVERY", 50, 1);

// Parallelism
const CONCURRENCY = envNum("CONCURRENCY", 6, 1);
const ARCHIVE_CONCURRENCY = envNum("ARCHIVE_CONCURRENCY", CONCURRENCY, 1);
const VERBOSE_FETCH = envNum("VERBOSE_FETCH", 0, 0) > 0;

const HOST = envStr("IC_HOST", "https://ic0.app");
const OUT_CSV = envStr("OUT_CSV", "flows.csv");

// Optional subaccount for ICRC ledgers
const WALLET_SUBACCOUNT_HEX = envHex("WALLET_SUBACCOUNT_HEX", "");

// Sanity check indices (defaults from known transactions)
const VERIFY_CKBTC_INDEX = BigInt(envNum("VERIFY_CKBTC_INDEX", 2_783_712, 0));
const VERIFY_CKUSDC_INDEX = BigInt(envNum("VERIFY_CKUSDC_INDEX", 408_821, 0));
const VERIFY_ICP_INDEX = BigInt(envNum("VERIFY_ICP_INDEX", 25_906_544, 0));

// ---------------- ICP Ledger IDL (query_blocks) ----------------
const ICP_LEDGER_IDL = ({ IDL }: { IDL: typeof import("@dfinity/candid").IDL }) => {
  const AccountIdentifier = IDL.Vec(IDL.Nat8);
  const Tokens = IDL.Record({ e8s: IDL.Nat64 });
  const Memo = IDL.Nat64;
  const TimeStamp = IDL.Record({ timestamp_nanos: IDL.Nat64 });
  const BlockIndex = IDL.Nat64;

  const Transfer = IDL.Record({
    from: AccountIdentifier,
    to: AccountIdentifier,
    amount: Tokens,
    fee: Tokens,
    spender: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Mint = IDL.Record({ to: AccountIdentifier, amount: Tokens });
  const Burn = IDL.Record({
    from: AccountIdentifier,
    spender: IDL.Opt(AccountIdentifier),
    amount: Tokens,
  });
  const Approve = IDL.Record({
    from: AccountIdentifier,
    spender: AccountIdentifier,
    allowance_e8s: IDL.Int,
    allowance: Tokens,
    fee: Tokens,
    expires_at: IDL.Opt(TimeStamp),
    expected_allowance: IDL.Opt(Tokens),
  });

  const Operation = IDL.Variant({ Transfer, Mint, Burn, Approve });
  const Transaction = IDL.Record({
    memo: Memo,
    icrc1_memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    operation: IDL.Opt(Operation),
    created_at_time: TimeStamp,
  });

  const Block = IDL.Record({
    parent_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
    transaction: Transaction,
    timestamp: TimeStamp,
  });

  const GetBlocksArgs = IDL.Record({ start: BlockIndex, length: IDL.Nat64 });
  const QueryBlocksResponse = IDL.Rec();

  const BlockRange = IDL.Record({ blocks: IDL.Vec(Block) });
  const QueryArchiveError = IDL.Variant({
    BadFirstBlockIndex: IDL.Record({ requested_index: BlockIndex, first_valid_index: BlockIndex }),
    Other: IDL.Record({ error_code: IDL.Nat64, error_message: IDL.Text }),
  });
  const QueryArchiveResult = IDL.Variant({ Ok: BlockRange, Err: QueryArchiveError });
  const QueryArchiveFn = IDL.Func([GetBlocksArgs], [QueryArchiveResult], ["query"]);

  const ArchivedBlockRange = IDL.Record({
    start: BlockIndex,
    length: IDL.Nat64,
    callback: QueryArchiveFn,
  });

  QueryBlocksResponse.fill(
    IDL.Record({
      chain_length: IDL.Nat64,
      certificate: IDL.Opt(IDL.Vec(IDL.Nat8)),
      blocks: IDL.Vec(Block),
      first_block_index: BlockIndex,
      archived_blocks: IDL.Vec(ArchivedBlockRange),
    })
  );

  return IDL.Service({
    query_blocks: IDL.Func([GetBlocksArgs], [QueryBlocksResponse], ["query"]),
    symbol: IDL.Func([], [IDL.Record({ symbol: IDL.Text })], ["query"]),
    decimals: IDL.Func([], [IDL.Record({ decimals: IDL.Nat32 })], ["query"]),
  });
};

// ---------------- ICRC-3 IDL ----------------
const ICRC3_IDL = ({ IDL }: { IDL: typeof import("@dfinity/candid").IDL }) => {
  const Value = IDL.Rec();
  Value.fill(
    IDL.Variant({
      Blob: IDL.Vec(IDL.Nat8),
      Text: IDL.Text,
      Nat: IDL.Nat,
      Int: IDL.Int,
      Array: IDL.Vec(Value),
      Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
    })
  );

  const GetBlocksArgs = IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat }));
  const GetBlocksResult = IDL.Rec();
  GetBlocksResult.fill(
    IDL.Record({
      log_length: IDL.Nat,
      blocks: IDL.Vec(IDL.Record({ id: IDL.Nat, block: Value })),
      archived_blocks: IDL.Vec(
        IDL.Record({
          args: GetBlocksArgs,
          callback: IDL.Func([GetBlocksArgs], [GetBlocksResult], ["query"]),
        })
      ),
    })
  );

  return IDL.Service({
    icrc1_symbol: IDL.Func([], [IDL.Text], ["query"]),
    icrc1_decimals: IDL.Func([], [IDL.Nat8], ["query"]),
    icrc3_get_blocks: IDL.Func([GetBlocksArgs], [GetBlocksResult], ["query"]),
  });
};

// ---------------- Types ----------------
type Account = { owner: Principal; subaccount?: number[] | null };

type CsvRow = {
  date_iso: string;
  token: string;
  direction: "inflow" | "outflow" | "self" | "mint" | "burn";
  amount: string;
  from_principal: string;
  to_principal: string;
  block_index: string;
  memo: string;
};

// ---------------- CSV helpers ----------------
const CSV_HEADER: (keyof CsvRow)[] = [
  "date_iso",
  "token",
  "direction",
  "amount",
  "from_principal",
  "to_principal",
  "block_index",
  "memo",
];

function ensureCsvHeader(path: string) {
  try {
    if (!fs.existsSync(path) || fs.statSync(path).size === 0) {
      fs.writeFileSync(path, CSV_HEADER.join(",") + "\n", "utf8");
    }
  } catch (e) {
    console.error(`Failed to init CSV ${path}:`, e);
  }
}

function csvEscape(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function rowToCsvLine(r: CsvRow): string {
  return (
    [
      r.date_iso,
      r.token,
      r.direction,
      r.amount,
      r.from_principal,
      r.to_principal,
      r.block_index,
      r.memo,
    ]
      .map(csvEscape)
      .join(",") + "\n"
  );
}

function appendRow(path: string, row: CsvRow) {
  try {
    fs.appendFileSync(path, rowToCsvLine(row), "utf8");
  } catch (e) {
    console.error(`Failed to append to ${path}:`, e, row);
  }
}

function logRow(symbol: string, r: CsvRow) {
  const path =
    r.from_principal || r.to_principal
      ? ` | ${r.from_principal || "-"} -> ${r.to_principal || "-"}`
      : "";
  const memo = r.memo ? ` | memo=${r.memo}` : "";
  console.log(
    `    [+] ${symbol} ${r.direction} ${r.amount} @ block ${r.block_index} | ${r.date_iso}${path}${memo}`
  );
}

// Convenience: log + append together
function emitRow(symbol: string, row: CsvRow) {
  logRow(symbol, row);
  appendRow(OUT_CSV, row);
}

// ---------------- Generic helpers ----------------
function hexToBytes(hex: string): number[] {
  const s = hex.replace(/^0x/, "").toLowerCase();
  if (!s.length) return [];
  if (s.length % 2 !== 0) throw new Error(`Invalid hex length for "${hex}"`);
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
}

function bytesToHex(u8: Uint8Array): string {
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function acctStr(a: Account | null): string {
  if (!a) return "<nil>";
  const sa = normalizeSub(a.subaccount ?? null);
  const saHex = sa ? bytesToHex(Uint8Array.from(sa)) : "(default)";
  return `${a.owner.toText()} / sa=${saHex}`;
}

function toHex(a: Uint8Array): string {
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function accountIdToHex(accountId: number[]): string {
  return toHex(new Uint8Array(accountId));
}

function memoToHex(m?: unknown): string {
  if (!m) return "";
  // ICP uses u64 for memo
  if (typeof m === "bigint" || typeof m === "number") {
    return BigInt(m).toString(16).padStart(16, "0");
  }
  const bytes = m instanceof Uint8Array ? m : Uint8Array.from(m as ArrayLike<number>);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function n64ToMillis(n?: unknown): number | null {
  if (n === undefined || n === null) return null;
  try {
    const nanos = (n as { timestamp_nanos?: unknown }).timestamp_nanos ?? n;
    return Number(BigInt(nanos as string | number | bigint) / 1_000_000n);
  } catch {
    return null;
  }
}

function extractValue(value: unknown, key: string): unknown {
  const v = value as { Map?: unknown };
  if (!value || !v.Map) return null;
  const map = (value as { Map?: [string, unknown][] }).Map;
  if (!map) return null;
  const entry = map.find(([k]) => k === key);
  return entry ? entry[1] : null;
}

function extractText(value: unknown): string {
  if (!value) return "";
  const v = value as { Text?: string; Nat?: bigint; Int?: bigint };
  if (v.Text !== undefined) return v.Text;
  if (v.Nat !== undefined) return v.Nat.toString();
  if (v.Int !== undefined) return v.Int.toString();
  return "";
}

function extractNat(value: unknown): bigint {
  const v = value as { Nat?: bigint | string | number };
  if (!value || v.Nat === undefined) return 0n;
  return BigInt(v.Nat);
}

function extractBlob(value: unknown): number[] {
  const v = value as { Blob?: number[] };
  if (!value || !v.Blob) return [];
  return v.Blob;
}

function extractAccount(value: unknown): Account | null {
  if (!value) return null;

  // Map form: { owner: Blob, subaccount: opt Blob }
  const v = value as { Map?: unknown; Array?: unknown };
  if (v.Map) {
    const ownerVal = extractValue(value, "owner");
    const subVal = extractValue(value, "subaccount");
    const ownerBlob = extractBlob(ownerVal);
    if (!ownerBlob.length) return null;
    try {
      const owner = Principal.fromUint8Array(new Uint8Array(ownerBlob));
      const sub = extractBlob(subVal);
      return { owner, subaccount: sub?.length ? sub : null };
    } catch {
      return null;
    }
  }

  // Array/Tuple form: [ownerBlob, subaccountBlob?]
  const arr = v.Array as { Blob?: number[] }[] | undefined;
  if (arr && arr[0]?.Blob) {
    try {
      const owner = Principal.fromUint8Array(new Uint8Array(arr[0].Blob));
      const sub = arr[1]?.Blob;
      return { owner, subaccount: sub?.length ? sub : null };
    } catch {
      return null;
    }
  }

  return null;
}

// Normalize subaccount - treat 32 zero bytes as null
function normalizeSub(sa?: number[] | null): number[] | null {
  if (!sa || !sa.length) return null;
  if (sa.length === 32 && sa.every((b) => b === 0)) return null;
  return sa;
}

function eqAccount(a: Account | null, b: Account): boolean {
  if (!a) return false;
  if (a.owner.toText() !== b.owner.toText()) return false;
  const sa = normalizeSub(a.subaccount);
  const sb = normalizeSub(b.subaccount);
  if (!sa && !sb) return true;
  if (!!sa !== !!sb || sa!.length !== sb!.length) return false;
  for (let i = 0; i < sa!.length; i++) if (sa![i] !== sb![i]) return false;
  return true;
}

function formatAmount(raw: string, decimals: number): string {
  const s = raw.replace(/^0+/, "") || "0";
  if (decimals <= 0) return s;
  const whole = s.length > decimals ? s.slice(0, -decimals) : "0";
  const frac = s.length > decimals ? s.slice(-decimals) : s.padStart(decimals, "0");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed.length ? `${whole}.${trimmed}` : whole;
}

// Lightweight promise limiter (no deps)
function pLimit(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    if (queue.length) queue.shift()!();
  };
  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then((v) => {
            next();
            resolve(v);
          })
          .catch((e) => {
            next();
            reject(e);
          });
      };
      if (active < max) run();
      else queue.push(run);
    });
  };
}

function buildSegments(startIndex: bigint, endIndex: bigint, page: number) {
  const segs: Array<{ start: bigint; length: bigint; idx: number }> = [];
  let cursor = endIndex;
  let idx = 0;
  while (cursor >= startIndex) {
    const length = BigInt(Math.min(page, Number(cursor - startIndex + 1n)));
    const start = cursor - (length - 1n);
    segs.push({ start, length, idx });
    if (start === 0n) break;
    cursor = start - 1n;
    idx++;
  }
  return segs;
}

// ---------------- Actor factories ----------------
function makeIcpActor(agent: HttpAgent, canisterId: string | Principal) {
  return Actor.createActor(ICP_LEDGER_IDL as any, { agent, canisterId });
}
function makeIcrc3Actor(agent: HttpAgent, canisterId: string | Principal) {
  return Actor.createActor(ICRC3_IDL as any, { agent, canisterId });
}

// ---------------- Reusable fetchers (start, length) ----------------
type IcpFetched = { index: bigint; block: any };
async function fetchIcpBlocks(
  actor: any,
  agent: HttpAgent,
  _canisterId: string | Principal,
  start: bigint,
  length: bigint,
  limitArchive: ReturnType<typeof pLimit>
): Promise<IcpFetched[]> {
  const out: IcpFetched[] = [];
  const res = await actor.query_blocks({ start, length });

  const blocks = (res?.blocks || []) as any[];
  const firstIdx = res?.first_block_index ?? start;
  for (let i = 0; i < blocks.length; i++) {
    out.push({ index: firstIdx + BigInt(i), block: blocks[i] });
  }

  const archived = (res?.archived_blocks || []) as Array<{
    start: bigint;
    length: bigint;
    callback: [Principal, string];
  }>;

  if (VERBOSE_FETCH) {
    console.log(
      `[fetch][ICP] ${start}..${start + length - 1n} main=${blocks.length} archEntries=${archived.length}`
    );
  }

  await Promise.all(
    archived.map((ar) =>
      limitArchive(async () => {
        const [archiveCanister, method] = ar.callback ?? [];
        const ArchiveIDL = ({ IDL }: any) => {
          const AccountIdentifier = IDL.Vec(IDL.Nat8);
          const Tokens = IDL.Record({ e8s: IDL.Nat64 });
          const Memo = IDL.Nat64;
          const TimeStamp = IDL.Record({ timestamp_nanos: IDL.Nat64 });
          const BlockIndex = IDL.Nat64;
          const Transfer = IDL.Record({
            from: AccountIdentifier,
            to: AccountIdentifier,
            amount: Tokens,
            fee: Tokens,
            spender: IDL.Opt(IDL.Vec(IDL.Nat8)),
          });
          const Mint = IDL.Record({ to: AccountIdentifier, amount: Tokens });
          const Burn = IDL.Record({
            from: AccountIdentifier,
            spender: IDL.Opt(AccountIdentifier),
            amount: Tokens,
          });
          const Approve = IDL.Record({
            from: AccountIdentifier,
            spender: AccountIdentifier,
            allowance_e8s: IDL.Int,
            allowance: Tokens,
            fee: Tokens,
            expires_at: IDL.Opt(TimeStamp),
            expected_allowance: IDL.Opt(Tokens),
          });
          const Operation = IDL.Variant({ Transfer, Mint, Burn, Approve });
          const Transaction = IDL.Record({
            memo: Memo,
            icrc1_memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
            operation: IDL.Opt(Operation),
            created_at_time: TimeStamp,
          });
          const Block = IDL.Record({
            parent_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
            transaction: Transaction,
            timestamp: TimeStamp,
          });
          return IDL.Service({
            [method || "get_blocks"]: IDL.Func(
              [IDL.Record({ start: IDL.Nat64, length: IDL.Nat64 })],
              [
                IDL.Variant({
                  Ok: IDL.Record({ blocks: IDL.Vec(Block) }),
                  Err: IDL.Variant({
                    BadFirstBlockIndex: IDL.Record({
                      requested_index: BlockIndex,
                      first_valid_index: BlockIndex,
                    }),
                    Other: IDL.Record({ error_code: IDL.Nat64, error_message: IDL.Text }),
                  }),
                }),
              ],
              ["query"]
            ),
          });
        };
        const archive = Actor.createActor(ArchiveIDL as any, {
          agent,
          canisterId: archiveCanister,
        });
        const r = await (archive as any)[method || "get_blocks"]({
          start: ar.start,
          length: ar.length,
        });
        const ok = (r && (r.Ok || r.ok)) as { blocks: any[] } | undefined;
        const arr = ok?.blocks || [];
        if (VERBOSE_FETCH) {
          console.log(
            `  [fetch-arch][ICP] ${ar.start}..${ar.start + ar.length - 1n} blocks=${arr.length}`
          );
        }
        for (let i = 0; i < arr.length; i++) {
          out.push({ index: BigInt(ar.start) + BigInt(i), block: arr[i] });
        }
      })
    )
  );

  return out;
}

type IcrcFetched = { id: bigint; block: any };
async function fetchIcrc3Blocks(
  actor: any,
  agent: HttpAgent,
  _canisterId: string | Principal,
  start: bigint,
  length: bigint,
  limitArchive: ReturnType<typeof pLimit>
): Promise<IcrcFetched[]> {
  const out: IcrcFetched[] = [];
  const res = await actor.icrc3_get_blocks([{ start, length }]);

  const blocks = (res?.blocks || []) as Array<{ id: bigint; block: any }>;
  out.push(...blocks);

  const archived = (res?.archived_blocks || []) as Array<{
    args: Array<{ start: bigint; length: bigint }>;
    callback: [Principal, string];
  }>;

  if (VERBOSE_FETCH) {
    console.log(
      `[fetch][ICRC3] ${start}..${start + length - 1n} main=${blocks.length} archEntries=${archived.length}`
    );
  }

  await Promise.all(
    archived.flatMap((ai) => {
      const [cbPrin] = ai.callback ?? [];
      const archiveActor = makeIcrc3Actor(agent, cbPrin);
      return ai.args.map((argsEntry) =>
        limitArchive(async () => {
          const r = await (archiveActor as any).icrc3_get_blocks([argsEntry]);
          const aBlocks = (r?.blocks || []) as Array<{ id: bigint; block: any }>;
          if (VERBOSE_FETCH) {
            console.log(
              `  [fetch-arch][ICRC3] ${argsEntry.start}..${argsEntry.start + argsEntry.length - 1n} blocks=${aBlocks.length}`
            );
          }
          out.push(...aBlocks);
        })
      );
    })
  );

  return out;
}

// ---------------- Symbol/decimals ----------------
async function getSymbolAndDecimals(
  actor: unknown,
  isIcp: boolean
): Promise<{ symbol: string; decimals: number }> {
  let symbol = "TOKEN";
  let decimals = 0;
  try {
    if (isIcp) {
      const icpActor = actor as {
        symbol: () => Promise<{ symbol: string }>;
        decimals: () => Promise<{ decimals: number }>;
      };
      symbol = (await icpActor.symbol()).symbol;
      decimals = Number((await icpActor.decimals()).decimals);
    } else {
      const icrcActor = actor as unknown as {
        icrc1_symbol: () => Promise<string>;
        icrc1_decimals: () => Promise<number>;
      };
      symbol = await icrcActor.icrc1_symbol();
      decimals = Number(await icrcActor.icrc1_decimals());
    }
  } catch {
    // Ignore symbol/decimals fetch errors
  }
  return { symbol, decimals };
}

// ---------------- Parallel scanners (using reusable fetchers) ----------------
async function scanIcpLedger(canisterId: string, icpAccountIdHex: string): Promise<CsvRow[]> {
  const targetHex = icpAccountIdHex.toLowerCase();
  const agent = new HttpAgent({ host: HOST });
  const actor = makeIcpActor(agent, canisterId);
  const { symbol, decimals } = await getSymbolAndDecimals(actor, true);
  console.log(`  Symbol: ${symbol}, Decimals: ${decimals}`);

  // Get tip + compute bounded window
  let chainLength = 0n;
  try {
    const meta = await (actor as any).query_blocks({ start: 0n, length: 0n });
    chainLength = meta.chain_length;
  } catch (e) {
    console.error(`  Failed to get chain length:`, e);
    return [];
  }

  const endIndex = chainLength - 1n;
  const startIndex =
    endIndex > BigInt(MAX_BLOCKS_PER_LEDGER) ? endIndex - BigInt(MAX_BLOCKS_PER_LEDGER) : 0n;

  const segs = buildSegments(startIndex, endIndex, PAGE);
  console.log(
    `  Scanning ICP blocks ${startIndex}..${endIndex} in ${segs.length} segments (PAGE=${PAGE}, CONCURRENCY=${CONCURRENCY})`
  );

  const limit = pLimit(CONCURRENCY);
  const limitArchive = pLimit(ARCHIVE_CONCURRENCY);

  const rows: CsvRow[] = [];
  let segDone = 0;
  let blocksSeen = 0;
  let matches = 0;

  function handleBlock(block: any, blockIndex: bigint) {
    const ts = n64ToMillis(block?.timestamp);
    if (ts && (ts < FROM_MS || ts > TO_MS)) return;

    const tx = block?.transaction;
    const opVal = tx?.operation;
    const optInner = Array.isArray(opVal) ? opVal[0] : opVal;
    if (!optInner) return;
    const opKey = Object.keys(optInner)[0];
    if (opKey !== "Transfer") return;

    const op = (optInner as any)[opKey] as {
      from?: number[];
      to?: number[];
      amount?: { e8s?: bigint };
    };
    const fromHex = accountIdToHex(op.from || []);
    const toHex = accountIdToHex(op.to || []);
    const amount = (op.amount?.e8s || 0n).toString();
    const memo = memoToHex(tx?.memo);

    let direction: CsvRow["direction"] | null = null;
    if (fromHex === targetHex && toHex === targetHex) direction = "self";
    else if (toHex === targetHex) direction = "inflow";
    else if (fromHex === targetHex) direction = "outflow";

    if (direction) {
      const date_iso = ts ? new Date(ts).toISOString() : "";
      const row: CsvRow = {
        date_iso,
        token: symbol,
        direction,
        amount: formatAmount(amount, decimals),
        from_principal: "",
        to_principal: "",
        block_index: blockIndex.toString(),
        memo,
      };
      rows.push(row);
      emitRow(symbol, row);
      matches++;
    }
  }

  await Promise.all(
    segs.map((seg) =>
      limit(async () => {
        const label = `seg#${seg.idx + 1}/${segs.length} [${seg.start}..${
          seg.start + seg.length - 1n
        }]`;
        try {
          const fetched = await fetchIcpBlocks(
            actor,
            agent,
            canisterId,
            seg.start,
            seg.length,
            limitArchive
          );
          for (const { index, block } of fetched) handleBlock(block, index);
          blocksSeen += fetched.length;
          segDone++;
          if (segDone % PROGRESS_EVERY === 0 || segDone === segs.length) {
            console.log(
              `  [ICP] ${label} DONE | segments=${segDone}/${segs.length}, blocksSeen≈${blocksSeen}, matches=${matches}`
            );
          }
        } catch (e) {
          segDone++;
          console.error(`  [ICP] ${label} ERROR:`, e);
        }
      })
    )
  );

  console.log(
    `  [ICP] Parallel scan complete. segments=${segs.length}, blocksSeen≈${blocksSeen}, matches=${matches}`
  );
  return rows;
}

async function scanIcrcLedger(
  name: string,
  canisterId: string,
  wallet: Account
): Promise<CsvRow[]> {
  const agent = new HttpAgent({ host: HOST });
  const actor = makeIcrc3Actor(agent, canisterId);
  const { symbol, decimals } = await getSymbolAndDecimals(actor, false);
  console.log(`  Symbol: ${symbol}, Decimals: ${decimals}`);

  let logLength = 0n;
  try {
    const info = await (actor as any).icrc3_get_blocks([{ start: 0n, length: 0n }]);
    logLength = BigInt(info.log_length);
    console.log(`  Total blocks: ${logLength}`);
  } catch (e) {
    console.error(`  Failed to get ${name} log length:`, e);
    return [];
  }
  if (logLength === 0n) return [];

  const endIndex = logLength - 1n;
  const scanStart =
    endIndex > BigInt(MAX_BLOCKS_PER_LEDGER) ? endIndex - BigInt(MAX_BLOCKS_PER_LEDGER) : 0n;

  const segs = buildSegments(scanStart, endIndex, PAGE);
  console.log(
    `  Scanning ${name} blocks ${scanStart}..${endIndex} in ${segs.length} segments (PAGE=${PAGE}, CONCURRENCY=${CONCURRENCY})`
  );

  const limit = pLimit(CONCURRENCY);
  const limitArchive = pLimit(ARCHIVE_CONCURRENCY);

  const rows: CsvRow[] = [];
  let segDone = 0;
  let blocksSeen = 0;
  let matches = 0;

  function handleIcrcBlock(bw: { id: bigint; block: any }) {
    const block = bw.block;
    const ts = extractNat(extractValue(block, "ts"));
    if (ts < FROM_TS || ts > TO_TS) return;

    const tx = extractValue(block, "tx");
    if (!tx || !(tx as any).Map) return;

    const opType =
      extractText(extractValue(tx, "op")) ||
      extractText(extractValue(block, "btype")) ||
      extractText(extractValue(block, "type"));
    if (opType !== "xfer" && opType !== "transfer") return;

    const from = extractAccount(extractValue(tx, "from"));
    const to = extractAccount(extractValue(tx, "to"));
    const amount = extractNat(extractValue(tx, "amt")).toString();
    const memo = toHex(new Uint8Array(extractBlob(extractValue(tx, "memo"))));

    let direction: CsvRow["direction"] | null = null;
    if (from && to) {
      if (eqAccount(from, wallet) && eqAccount(to, wallet)) direction = "self";
      else if (eqAccount(to, wallet)) direction = "inflow";
      else if (eqAccount(from, wallet)) direction = "outflow";
    }
    if (!direction) return;

    const row: CsvRow = {
      date_iso: new Date(Number(ts) / 1_000_000).toISOString(),
      token: symbol,
      direction,
      amount: formatAmount(amount, decimals),
      from_principal: from?.owner.toText() || "",
      to_principal: to?.owner.toText() || "",
      block_index: bw.id.toString(),
      memo,
    };
    rows.push(row);
    emitRow(symbol, row);
    matches++;
  }

  await Promise.all(
    segs.map((seg) =>
      limit(async () => {
        const label = `[${name}] seg#${seg.idx + 1}/${segs.length} [${seg.start}..${
          seg.start + seg.length - 1n
        }]`;
        try {
          const fetched = await fetchIcrc3Blocks(
            actor,
            agent,
            canisterId,
            seg.start,
            seg.length,
            limitArchive
          );
          for (const bw of fetched) handleIcrcBlock(bw);
          blocksSeen += fetched.length;
          segDone++;
          if (segDone % PROGRESS_EVERY === 0 || segDone === segs.length) {
            console.log(
              `  ${label} DONE | segments=${segDone}/${segs.length}, blocksSeen≈${blocksSeen}, matches=${matches}`
            );
          }
        } catch (e) {
          segDone++;
          console.error(`  ${label} ERROR:`, e);
        }
      })
    )
  );

  console.log(
    `  [${name}] Parallel scan complete. segments=${segs.length}, blocksSeen≈${blocksSeen}, matches=${matches}`
  );
  return rows;
}

// ---------------- Would-Capture Checkers (unchanged) ----------------
function wouldCaptureIcpBlock(
  block: any,
  icpAccountIdHex: string,
  symbol: string,
  decimals: number
) {
  const timestampMs = n64ToMillis(block?.timestamp);
  const inWindow =
    typeof timestampMs === "number" && timestampMs >= FROM_MS && timestampMs <= TO_MS;

  let direction: CsvRow["direction"] | null = null;
  let amount = "0";
  let fromHex = "";
  let toHex = "";
  let memo = "";

  const tx = block?.transaction;
  const opVal = tx?.operation;
  const optInner = Array.isArray(opVal) ? opVal[0] : opVal;
  if (optInner) {
    const opKey = Object.keys(optInner)[0];
    if (opKey === "Transfer") {
      const op = (optInner as any)[opKey] as {
        from?: number[];
        to?: number[];
        amount?: { e8s?: bigint };
      };
      fromHex = accountIdToHex(op.from || []);
      toHex = accountIdToHex(op.to || []);
      amount = ((op.amount?.e8s ?? 0n) as bigint).toString();
      memo = memoToHex(tx?.memo);

      const matchesFrom = fromHex === icpAccountIdHex.toLowerCase();
      const matchesTo = toHex === icpAccountIdHex.toLowerCase();

      if (matchesFrom && matchesTo) direction = "self";
      else if (matchesTo) direction = "inflow";
      else if (matchesFrom) direction = "outflow";
    }
  }

  const wouldEmit = !!direction && inWindow;

  return {
    wouldEmit,
    direction,
    inWindow,
    timestampIso: timestampMs ? new Date(timestampMs).toISOString() : "",
    fromHex,
    toHex,
    amountFmt: formatAmount(amount, decimals),
    memo,
    symbol,
  };
}

function wouldCaptureIcrc3Block(
  blockWrap: { id: bigint; block: any },
  wallet: Account,
  symbol: string,
  decimals: number
) {
  const { id, block } = blockWrap;
  const ts = extractNat(extractValue(block, "ts"));
  const inWindow = ts >= FROM_TS && ts <= TO_TS;

  let direction: CsvRow["direction"] | null = null;
  let from: Account | null = null;
  let to: Account | null = null;
  let amount = "0";
  let memo = "";

  const tx = extractValue(block, "tx");
  if (tx && (tx as any).Map) {
    const opType =
      extractText(extractValue(tx, "op")) ||
      extractText(extractValue(block, "btype")) ||
      extractText(extractValue(block, "type"));

    if (opType === "xfer" || opType === "transfer") {
      from = extractAccount(extractValue(tx, "from"));
      to = extractAccount(extractValue(tx, "to"));
      amount = extractNat(extractValue(tx, "amt")).toString();
      memo = toHex(new Uint8Array(extractBlob(extractValue(tx, "memo"))));

      if (from && to) {
        if (eqAccount(from, wallet) && eqAccount(to, wallet)) direction = "self";
        else if (eqAccount(to, wallet)) direction = "inflow";
        else if (eqAccount(from, wallet)) direction = "outflow";
      }
    }
  }

  const wouldEmit = !!direction && inWindow;
  const ownerMatch =
    (from && from.owner.toText() === wallet.owner.toText()) ||
    (to && to.owner.toText() === wallet.owner.toText());

  return {
    id: id.toString(),
    wouldEmit,
    direction,
    inWindow,
    timestampIso: ts ? new Date(Number(ts) / 1_000_000).toISOString() : "",
    fromStr: acctStr(from),
    toStr: acctStr(to),
    amountFmt: formatAmount(amount, decimals),
    memo,
    symbol,
    ownerMatch,
    walletStr: acctStr(wallet),
  };
}

// ---------------- Sanity Check Functions (now using reusable fetchers) ----------------
async function sanityCheck_ckBTC(index: bigint, wallet: Account) {
  console.log(`\n[Sanity] ckBTC @ ${LEDGERS.ckBTC} index=${index.toString()}`);
  const agent = new HttpAgent({ host: HOST });
  const actor = makeIcrc3Actor(agent, Principal.fromText(LEDGERS.ckBTC!));
  const { symbol, decimals } = await getSymbolAndDecimals(actor, false);

  const out = await fetchIcrc3Blocks(actor as any, agent, LEDGERS.ckBTC!, index, 1n, pLimit(2));
  const block = out.find((b) => b.id === index);
  if (!block) {
    console.log("  -> Could not fetch that block (not found in main/archives).");
    return;
  }
  const verdict = wouldCaptureIcrc3Block(block, wallet, symbol, decimals);

  console.log(`  Block ts: ${verdict.timestampIso}`);
  console.log(`  From: ${verdict.fromStr}`);
  console.log(`  To  : ${verdict.toStr}`);
  console.log(`  Amount: ${verdict.amountFmt} ${symbol}`);
  console.log(`  In window? ${verdict.inWindow ? "YES" : "NO"}`);
  console.log(`  Owner match (ignoring subaccount): ${verdict.ownerMatch ? "YES" : "NO"}`);
  console.log(`  Wallet considered: ${verdict.walletStr}`);
  console.log(
    `  Would current scanner emit? ${verdict.wouldEmit ? `YES (${verdict.direction})` : "NO"}${
      !verdict.wouldEmit && verdict.ownerMatch && !verdict.direction
        ? "  (owner matched but subaccount differs — set WALLET_SUBACCOUNT_HEX accordingly)"
        : ""
    }`
  );
}

async function sanityCheck_ckUSDC(index: bigint, wallet: Account) {
  console.log(`\n[Sanity] ckUSDC @ ${LEDGERS.ckUSDC} index=${index.toString()}`);
  const agent = new HttpAgent({ host: HOST });
  const actor = makeIcrc3Actor(agent, Principal.fromText(LEDGERS.ckUSDC!));
  const { symbol, decimals } = await getSymbolAndDecimals(actor, false);

  const out = await fetchIcrc3Blocks(actor as any, agent, LEDGERS.ckUSDC!, index, 1n, pLimit(2));
  const block = out.find((b) => b.id === index);
  if (!block) {
    console.log("  -> Could not fetch that block (not found in main/archives).");
    return;
  }
  const verdict = wouldCaptureIcrc3Block(block, wallet, symbol, decimals);

  console.log(`  Block ts: ${verdict.timestampIso}`);
  console.log(`  From: ${verdict.fromStr}`);
  console.log(`  To  : ${verdict.toStr}`);
  console.log(`  Amount: ${verdict.amountFmt} ${symbol}`);
  console.log(`  In window? ${verdict.inWindow ? "YES" : "NO"}`);
  console.log(`  Owner match (ignoring subaccount): ${verdict.ownerMatch ? "YES" : "NO"}`);
  console.log(`  Wallet considered: ${verdict.walletStr}`);
  console.log(
    `  Would current scanner emit? ${verdict.wouldEmit ? `YES (${verdict.direction})` : "NO"}${
      !verdict.wouldEmit && verdict.ownerMatch && !verdict.direction
        ? "  (owner matched but subaccount differs — set WALLET_SUBACCOUNT_HEX accordingly)"
        : ""
    }`
  );
}

async function sanityCheck_ICP(index: bigint) {
  console.log(`\n[Sanity] ICP @ ${LEDGERS.ICP} index=${index.toString()}`);
  const agent = new HttpAgent({ host: HOST });
  const actor = makeIcpActor(agent, Principal.fromText(LEDGERS.ICP!));
  const { symbol, decimals } = await getSymbolAndDecimals(actor, true);

  const out = await fetchIcpBlocks(actor as any, agent, LEDGERS.ICP!, index, 1n, pLimit(2));
  const hit = out.find((b) => b.index === index);
  if (!hit) {
    console.log("  -> Could not fetch that block (not found in main/archives).");
    return;
  }
  const verdict = wouldCaptureIcpBlock(hit.block, ICP_ACCOUNT_ID_HEX, symbol, decimals);

  console.log(`  Block ts: ${verdict.timestampIso}`);
  console.log(`  From: ${verdict.fromHex}`);
  console.log(`  To  : ${verdict.toHex}`);
  console.log(`  Amount: ${verdict.amountFmt} ${symbol}`);
  console.log(`  In window? ${verdict.inWindow ? "YES" : "NO"}`);
  console.log(
    `  Would current scanner emit? ${
      verdict.wouldEmit ? `YES (${verdict.direction})` : "NO"
    }  (matching against ICP_ACCOUNT_ID_HEX=${ICP_ACCOUNT_ID_HEX.toLowerCase()})`
  );
}

async function sanityCheckKnownTxs(wallet: Account) {
  console.log("=== Sanity Check: Known Transactions ===");
  console.log(
    `Date window: ${new Date(FROM_MS).toISOString()} .. ${new Date(TO_MS).toISOString()} | Wallet=${WALLET_PRINCIPAL} | Subaccount=${
      wallet.subaccount ? bytesToHex(Uint8Array.from(wallet.subaccount)) : "(default)"
    }`
  );
  await sanityCheck_ckBTC(VERIFY_CKBTC_INDEX, wallet);
  await sanityCheck_ckUSDC(VERIFY_CKUSDC_INDEX, wallet);
  await sanityCheck_ICP(VERIFY_ICP_INDEX);
  console.log("=== End Sanity Check ===\n");
}

// ---------------- Main ----------------
async function main() {
  // Parse subaccount for wallet
  const WALLET_SUBACCOUNT = (() => {
    if (!WALLET_SUBACCOUNT_HEX) return null;
    const b = hexToBytes(WALLET_SUBACCOUNT_HEX);
    if (b.length === 0) return null;
    if (b.length !== 32) {
      console.warn(`WALLET_SUBACCOUNT_HEX must be 32 bytes (64 hex chars). Got ${b.length} bytes.`);
      return null;
    }
    return b;
  })();

  const wallet: Account = {
    owner: Principal.fromText(WALLET_PRINCIPAL),
    subaccount: WALLET_SUBACCOUNT ?? null,
  };

  // Always run sanity checks first
  await sanityCheckKnownTxs(wallet);

  console.log(`ICP Transaction Scanner`);
  console.log(`================================`);
  console.log(`Wallet Principal: ${WALLET_PRINCIPAL}`);
  console.log(`ICP Account ID: ${ICP_ACCOUNT_ID_HEX}`);
  console.log(
    `Date window: ${new Date(FROM_MS).toISOString()} .. ${new Date(TO_MS).toISOString()}`
  );
  console.log(`Max blocks per ledger: ${MAX_BLOCKS_PER_LEDGER}`);
  console.log(
    `Parallelism: CONCURRENCY=${CONCURRENCY} ARCHIVE_CONCURRENCY=${ARCHIVE_CONCURRENCY} PAGE=${PAGE}`
  );
  console.log(`\n`);

  ensureCsvHeader(OUT_CSV);
  console.log(`CSV file: ${OUT_CSV} (appending rows as they're found)`);
  console.log(`\n`);

  // Scan all ledgers in parallel
  const perLedger = await Promise.all(
    Object.entries(LEDGERS).map(async ([name, canisterId]) => {
      console.log(`Scanning ${name} @ ${canisterId} ...`);
      try {
        let rows: CsvRow[];
        if (name === "ICP") {
          rows = await scanIcpLedger(canisterId, ICP_ACCOUNT_ID_HEX);
        } else {
          rows = await scanIcrcLedger(name, canisterId, wallet);
        }
        console.log(`  -> found ${rows.length} matching transactions\n`);
        return rows;
      } catch (e) {
        console.error(`  Error scanning ${name}:`, e, "\n");
        return [] as CsvRow[];
      }
    })
  );

  const all = perLedger.flat();

  // Sort by date
  all.sort((a, b) => (a.date_iso || "").localeCompare(b.date_iso || ""));

  // Write CSV
  console.log(`✅ Scan complete. Appended ${all.length} rows to ${OUT_CSV}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
