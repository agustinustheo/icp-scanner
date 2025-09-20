/**
 * ICP + ICRC history via ICP Dashboard REST APIs with Rosetta fallback for sanity checks.
 * Sequence:
 *   1) sanityCheckKnownTxs (ckBTC, ckUSDC via ICRC API; ICP via Ledger API; each with Rosetta fallback)
 *   2) ensureCsvHeader
 *   3) Parallel scan all ledgers (ICP via Ledger API; ICRC via ICRC API)
 *   4) Sort + done
 *
 * Env (same spirit as yours):
 *  WALLET_PRINCIPAL=ijsei-...-aqe
 *  ICP_ACCOUNT_ID_HEX=e71f...e9297         // lower/upper ok; hex w/o 0x
 *  START_DATE=2025-06-01T00:00:00Z
 *  END_DATE=2025-09-20T23:59:59Z
 *  PAGE=1000
 *  OUT_CSV=flows.csv
 *  STRICT_SUBACCOUNT_MATCH=0|1              // default 0 (owner-only)
 *  // Verify indices (defaults kept from your script):
 *  VERIFY_CKBTC_INDEX=2783712
 *  VERIFY_CKUSDC_INDEX=408821
 *  VERIFY_ICP_INDEX=25906544
 *  // Optional: WALLET_SUBACCOUNT_HEX=64-hex
 *  // Optional: LEDGER canister ids
 */

import * as fs from "fs";

// ---------- Env helpers (same style) ----------
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

// ---------- Config ----------
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

const START_DATE = envDate("START_DATE", "2025-06-01T00:00:00Z");
const END_DATE = envDate("END_DATE", new Date().toISOString());
const PAGE = envNum("PAGE", 1000, 1);
const OUT_CSV = envStr("OUT_CSV", "flows.csv");
const STRICT_SUB = envNum("STRICT_SUBACCOUNT_MATCH", 0) > 0;

const VERIFY_CKBTC_INDEX = BigInt(envNum("VERIFY_CKBTC_INDEX", 2_783_712, 0));
const VERIFY_CKUSDC_INDEX = BigInt(envNum("VERIFY_CKUSDC_INDEX", 408_821, 0));
const VERIFY_ICP_INDEX = BigInt(envNum("VERIFY_ICP_INDEX", 25_906_544, 0));

// ---------- Endpoints ----------
// const LEDGER_API_V1 = "https://ledger-api.internetcomputer.org/api/v1"; // ICP (Dashboard) - deprecated
const LEDGER_API_BASE = "https://ledger-api.internetcomputer.org"; // no /api prefix
const ICRC_API_V1 = "https://icrc-api.internetcomputer.org/api/v1"; // ICRC (Dashboard v1)
// Optional Rosetta (only if you run one)
const ICP_ROSETTA = envStr("ICP_ROSETTA_URL", ""); // e.g. http://127.0.0.1:8081
const ICRC_ROSETTA = envStr("ICRC_ROSETTA_URL", ""); // e.g. http://127.0.0.1:8082

// ---------- CSV ----------
type Direction = "inflow" | "outflow" | "self" | "mint" | "burn";
type CsvRow = {
  date_iso: string;
  token: string;
  direction: Direction;
  amount: string;
  from_principal: string;
  to_principal: string;
  block_index: string;
  memo: string;
};
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
  if (!fs.existsSync(path) || fs.statSync(path).size === 0) {
    fs.writeFileSync(path, CSV_HEADER.join(",") + "\n", "utf8");
  }
}
function csvEscape(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
function appendRow(path: string, row: CsvRow) {
  const line =
    [
      row.date_iso,
      row.token,
      row.direction,
      row.amount,
      row.from_principal,
      row.to_principal,
      row.block_index,
      row.memo,
    ]
      .map(csvEscape)
      .join(",") + "\n";
  fs.appendFileSync(path, line, "utf8");
}
function formatAmount(raw: string, decimals: number): string {
  const s = (raw || "0").replace(/^0+/, "") || "0";
  if (decimals <= 0) return s;
  const whole = s.length > decimals ? s.slice(0, -decimals) : "0";
  const frac = s.length > decimals ? s.slice(-decimals) : s.padStart(decimals, "0");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}
function toISO(x: any) {
  const d = new Date(x);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

// ---------- Fetch helpers ----------

async function getJson<T>(url: string, params?: Record<string, string | number | undefined>) {
  const qp =
    params &&
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
  const full = qp ? `${url}?${qp}` : url;
  const res = await fetch(full);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} for ${full}\n${body.slice(0, 256)}`);
  }
  return (await res.json()) as T;
}

// ---------- ICP Ledger API (account tx history) ----------
type IcpTx = {
  block_height: string;
  block_hash: string;
  transaction_hash: string;
  transfer_type: "transfer" | "mint" | "burn" | "approve";
  amount: string;
  fee?: string;
  from_account_identifier?: string;
  to_account_identifier?: string;
  created_at: number; // epoch seconds
  memo?: string;
};
async function fetchIcpTxByAccountHex(
  accountHex: string,
  fromISO: string,
  toISO: string,
  pageSize: number
): Promise<IcpTx[]> {
  const limit = Math.min(100, Math.max(1, pageSize));
  const start = Math.floor(new Date(fromISO).getTime() / 1000);
  const end = Math.floor(new Date(toISO).getTime() / 1000);

  const out: IcpTx[] = [];
  let after: string | undefined = undefined;

  for (;;) {
    const url = `${LEDGER_API_BASE}/v2/accounts/${accountHex}/transactions`;
    const page: { data: IcpTx[]; next_cursor?: string } = await getJson(url, {
      sort_by: "-block_height",
      limit,
      created_at_start: start,
      created_at_end: end,
      ...(after ? { after } : {}),
    });
    out.push(...(page.data || []));
    if (!page.next_cursor || (page.data || []).length < limit) break;
    after = page.next_cursor;
  }
  return out;
}

// ---------- ICRC API (account tx + block-by-id) ----------
type IcrcTx = {
  id: string;
  timestamp: string; // ISO
  op: string; // transfer/approve...
  from?: { owner: string; subaccount?: string } | undefined;
  to?: { owner: string; subaccount?: string } | undefined;
  amount?: string; // base units
  symbol?: string | undefined;
  decimals?: number | undefined;
  memo_hex?: string;
};
async function fetchIcrcTxByAccount(
  ledger: string,
  owner: string,
  _subHex: string | undefined,
  fromISO: string,
  toISO: string,
  pageSize: number
): Promise<IcrcTx[]> {
  const limit = Math.min(100, Math.max(1, pageSize));
  const start = Math.floor(new Date(fromISO).getTime() / 1000);
  const end = Math.floor(new Date(toISO).getTime() / 1000);

  const out: IcrcTx[] = [];
  let after: string | undefined;

  for (;;) {
    const url = `${ICRC_API_V1.replace("/api/v1", "/api/v2")}/ledgers/${ledger}/transactions`;
    const page: { data: any[]; next_cursor?: string } = await getJson(url, {
      limit,
      sort_by: "-index",
      start,
      end,
      query: owner,
      include_kind: "transfer",
      ...(after ? { after } : {}),
    });

    // Map the indexer's v2 'Transaction' objects into your IcrcTx shape
    for (const r of page.data || []) {
      out.push({
        id: String(r?.index ?? ""),
        timestamp: r?.timestamp ?? "",
        op: String(r?.kind ?? "").toLowerCase(),
        from: r?.from_owner
          ? {
              owner: r.from_owner,
              ...(r.from_subaccount ? { subaccount: r.from_subaccount } : {}),
            }
          : undefined,
        to: r?.to_owner
          ? {
              owner: r.to_owner,
              ...(r.to_subaccount ? { subaccount: r.to_subaccount } : {}),
            }
          : undefined,
        amount: r?.amount ?? "0",
        symbol: r?.symbol,
        decimals: r?.decimals,
        memo_hex: r?.memo ?? "",
      });
    }

    if (!page.next_cursor || (page.data || []).length < limit) break;
    after = page.next_cursor;
  }
  return out;
}

// Block detail (first try Dashboard ICRC API, else Rosetta /block)
type IcrcBlock = {
  id: string;
  timestamp: string;
  tx?: IcrcTx;
};
async function getIcrcBlockByIndex(ledger: string, index: bigint): Promise<IcrcBlock | null> {
  const idx = index.toString();
  try {
    const r = await getJson<any>(`${ICRC_API_V1}/ledgers/${ledger}/transactions/${idx}`);
    // r is a Transaction (v1), fields include: index, kind, amount, from_owner, to_owner, memo, timestamp, ...
    return {
      id: r?.index?.toString() ?? idx,
      timestamp: r?.timestamp ?? "",
      tx: {
        id: r?.index?.toString() ?? idx,
        timestamp: r?.timestamp ?? "",
        op: String(r?.kind ?? "").toLowerCase(),
        from: r?.from_owner
          ? { owner: r.from_owner, ...(r.from_subaccount ? { subaccount: r.from_subaccount } : {}) }
          : undefined,
        to: r?.to_owner
          ? { owner: r.to_owner, ...(r.to_subaccount ? { subaccount: r.to_subaccount } : {}) }
          : undefined,
        amount: r?.amount ?? "0",
        symbol: undefined,
        decimals: undefined,
        memo_hex: r?.memo ?? "",
      },
    };
  } catch {
    // keep your Rosetta fallback if configured
    if (!ICRC_ROSETTA) return null;
  }

  // Rosetta fallback unchanged…
  try {
    const body = {
      network_identifier: { blockchain: "Internet Computer", network: ledger },
      block_identifier: { index: Number(index) },
    };
    const res = await fetch(`${ICRC_ROSETTA}/block`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const tsMs = Number(j?.block?.timestamp ?? 0) / 1_000_000; // ns → ms
    const ops = j?.block?.transactions?.[0]?.operations ?? [];
    // Best-effort mapping
    const firstOp = ops[0] || {};
    const meta = firstOp?.metadata || {};
    return {
      id: String(index),
      timestamp: toISO(tsMs),
      tx: {
        id: String(index),
        timestamp: toISO(tsMs),
        op: String(firstOp?.type || meta?.op || "transfer"),
        ...(meta?.from
          ? {
              from: {
                owner: String(meta.from.owner),
                ...(meta.from.subaccount ? { subaccount: String(meta.from.subaccount) } : {}),
              },
            }
          : {}),
        ...(meta?.to
          ? {
              to: {
                owner: String(meta.to.owner),
                ...(meta.to.subaccount ? { subaccount: String(meta.to.subaccount) } : {}),
              },
            }
          : {}),
        amount: meta?.amount ?? meta?.amt ?? "0",
        symbol: meta?.symbol || "TOKEN",
        decimals: meta?.decimals ?? 8,
        memo_hex: meta?.memo_hex || "",
      },
    };
  } catch {
    return null;
  }
}

// ICP block detail (first try Ledger API if exposed, else ICP Rosetta /block)
type IcpBlock = {
  index: string;
  timestamp: string;
  op?: string;
  from_hex?: string;
  to_hex?: string;
  amount_e8s?: string;
  memo_hex?: string;
};
async function getIcpBlockByIndex(index: bigint): Promise<IcpBlock | null> {
  // ICP block by index only available via Rosetta
  if (!ICP_ROSETTA) return null;
  try {
    const body = {
      network_identifier: { blockchain: "Internet Computer", network: "00000000000000020101" },
      block_identifier: { index: Number(index) },
    };
    const res = await fetch(`${ICP_ROSETTA}/block`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const tsMs = Number(j?.block?.timestamp ?? 0) / 1_000_000;
    const tx = j?.block?.transactions?.[0];
    const ops = tx?.operations ?? [];
    // Heuristic mapping for a Transfer op
    const op = ops.find((o: any) => /transfer/i.test(o?.type || "")) || ops[0] || {};
    const meta = op?.metadata || {};
    return {
      index: String(index),
      timestamp: toISO(tsMs),
      op: String(op?.type || "Transfer"),
      from_hex: meta?.from_account_identifier || meta?.from || "",
      to_hex: meta?.to_account_identifier || meta?.to || "",
      amount_e8s: meta?.amount_e8s || meta?.amount || "0",
      memo_hex: meta?.memo_hex || "",
    };
  } catch {
    return null;
  }
}

// ---------- Matching helpers ----------
function eqSub(a?: string, b?: string) {
  const norm = (x?: string) => {
    const s = (x || "").replace(/^0x/, "").toLowerCase();
    if (!s || /^0+$/.test(s)) return ""; // treat zero-32 as default
    return s;
  };
  return norm(a) === norm(b);
}
function matchesIcrcAccount(
  acct: { owner?: string; subaccount?: string } | undefined,
  walletOwner: string,
  walletSubHex?: string
) {
  if (!acct?.owner) return false;
  if (acct.owner !== walletOwner) return false;
  if (!STRICT_SUB) return true;
  return eqSub(acct.subaccount, walletSubHex);
}

function passesStrictSub(t: IcrcTx, walletSubHex?: string): boolean {
  if (!STRICT_SUB || !walletSubHex) return true;
  const norm = (x?: string) => (x || "").replace(/^0x/, "").toLowerCase().replace(/^0+$/, "");
  const w = norm(walletSubHex);
  const fromOk = t.from?.owner === WALLET_PRINCIPAL && norm(t.from?.subaccount) === w;
  const toOk = t.to?.owner === WALLET_PRINCIPAL && norm(t.to?.subaccount) === w;
  return fromOk || toOk;
}

// ---------- Mapping → CSV (ICP + ICRC) ----------
function mapIcpTxToCsv(t: IcpTx): CsvRow | null {
  const token = "ICP";
  const decimals = 8;
  const op = (t.transfer_type || "").toLowerCase();

  let direction: Direction | null = null;
  if (op === "mint") direction = "mint";
  else if (op === "burn") direction = "burn";
  else if (op === "transfer") {
    const fromHex = (t.from_account_identifier || "").toLowerCase();
    const toHex = (t.to_account_identifier || "").toLowerCase();
    if (fromHex === ICP_ACCOUNT_ID_HEX && toHex === ICP_ACCOUNT_ID_HEX) direction = "self";
    else if (toHex === ICP_ACCOUNT_ID_HEX) direction = "inflow";
    else if (fromHex === ICP_ACCOUNT_ID_HEX) direction = "outflow";
  }
  if (!direction) return null;

  return {
    date_iso: toISO((t.created_at ?? 0) * 1000),
    token,
    direction,
    amount: formatAmount(String(t.amount ?? "0"), decimals),
    from_principal: (t.from_account_identifier || "").toLowerCase(),
    to_principal: (t.to_account_identifier || "").toLowerCase(),
    block_index: String(t.block_height),
    memo: (t.memo || "").toLowerCase(),
  };
}
function mapIcrcTxToCsv(t: IcrcTx): CsvRow | null {
  const op = (t.op || "").toLowerCase();
  const isXfer = op === "transfer" || op === "1xfer" || op === "icrc1_transfer" || op === "xfer";
  if (!isXfer) return null;

  const symbol = t.symbol || "TOKEN";
  const decimals = t.decimals ?? 8;

  let direction: Direction | null = null;
  if (matchesIcrcAccount(t.from, WALLET_PRINCIPAL)) {
    if (matchesIcrcAccount(t.to, WALLET_PRINCIPAL)) direction = "self";
    else direction = "outflow";
  } else if (matchesIcrcAccount(t.to, WALLET_PRINCIPAL)) {
    direction = "inflow";
  }
  if (!direction) return null;

  return {
    date_iso: toISO(t.timestamp),
    token: symbol,
    direction,
    amount: formatAmount(String(t.amount ?? "0"), decimals),
    from_principal: t.from?.owner || "",
    to_principal: t.to?.owner || "",
    block_index: String(t.id),
    memo: (t.memo_hex || "").toLowerCase(),
  };
}

// ---------- Sanity checks (per your diagram) ----------
async function sanityCheck_ckBTC(index: bigint, walletSubHex?: string) {
  const ledger = LEDGERS.ckBTC;
  console.log(`\n[Sanity] ckBTC @ ${ledger} index=${index}`);
  const blk = await getIcrcBlockByIndex(ledger || "", index);
  if (!blk || !blk.tx) {
    console.log("  -> Not found via Dashboard ICRC API; Rosetta not configured or also failed.");
    return;
  }
  const t = blk.tx;
  const dir =
    matchesIcrcAccount(t.from, WALLET_PRINCIPAL, walletSubHex) &&
    matchesIcrcAccount(t.to, WALLET_PRINCIPAL, walletSubHex)
      ? "self"
      : matchesIcrcAccount(t.to, WALLET_PRINCIPAL, walletSubHex)
        ? "inflow"
        : matchesIcrcAccount(t.from, WALLET_PRINCIPAL, walletSubHex)
          ? "outflow"
          : "mint";
  console.log(`  Block ts: ${toISO(t.timestamp)}`);
  console.log(`  From: ${t.from?.owner || "-"} / sub=${t.from?.subaccount || "(default)"}`);
  console.log(`  To  : ${t.to?.owner || "-"} / sub=${t.to?.subaccount || "(default)"}`);
  console.log(
    `  Amount: ${formatAmount(String(t.amount ?? "0"), t.decimals ?? 8)} ${t.symbol || ""}`
  );
  console.log(`  Would emit? ${dir}`);
}
async function sanityCheck_ckUSDC(index: bigint, walletSubHex?: string) {
  const ledger = LEDGERS.ckUSDC;
  console.log(`\n[Sanity] ckUSDC @ ${ledger} index=${index}`);
  const blk = await getIcrcBlockByIndex(ledger || "", index);
  if (!blk || !blk.tx) {
    console.log("  -> Not found via Dashboard ICRC API; Rosetta not configured or also failed.");
    return;
  }
  const t = blk.tx;
  const dir =
    matchesIcrcAccount(t.from, WALLET_PRINCIPAL, walletSubHex) &&
    matchesIcrcAccount(t.to, WALLET_PRINCIPAL, walletSubHex)
      ? "self"
      : matchesIcrcAccount(t.to, WALLET_PRINCIPAL, walletSubHex)
        ? "inflow"
        : matchesIcrcAccount(t.from, WALLET_PRINCIPAL, walletSubHex)
          ? "outflow"
          : "mint";
  console.log(`  Block ts: ${toISO(t.timestamp)}`);
  console.log(`  From: ${t.from?.owner || "-"} / sub=${t.from?.subaccount || "(default)"}`);
  console.log(`  To  : ${t.to?.owner || "-"} / sub=${t.to?.subaccount || "(default)"}`);
  console.log(
    `  Amount: ${formatAmount(String(t.amount ?? "0"), t.decimals ?? 6)} ${t.symbol || ""}`
  );
  console.log(`  Would emit? ${dir}`);
}
async function sanityCheck_ICP(index: bigint) {
  console.log(`\n[Sanity] ICP @ ${LEDGERS.ICP} index=${index}`);
  const blk = await getIcpBlockByIndex(index);
  if (!blk) {
    console.log("  -> Not found via Ledger API; Rosetta not configured or also failed.");
    return;
  }
  const op = (blk.op || "").toLowerCase();
  if (op !== "transfer") {
    console.log(`  Block ts: ${toISO(blk.timestamp)} | op=${blk.op}`);
    console.log("  Would emit? (non-transfer) mint/burn depends on op.");
    return;
  }
  const fromHex = (blk.from_hex || "").toLowerCase();
  const toHex = (blk.to_hex || "").toLowerCase();
  const dir =
    fromHex === ICP_ACCOUNT_ID_HEX && toHex === ICP_ACCOUNT_ID_HEX
      ? "self"
      : toHex === ICP_ACCOUNT_ID_HEX
        ? "inflow"
        : fromHex === ICP_ACCOUNT_ID_HEX
          ? "outflow"
          : "burn";
  console.log(`  Block ts: ${toISO(blk.timestamp)}`);
  console.log(`  From: ${fromHex || "-"}`);
  console.log(`  To  : ${toHex || "-"}`);
  console.log(`  Amount: ${formatAmount(String(blk.amount_e8s ?? "0"), 8)} ICP`);
  console.log(`  Would emit? ${dir}`);
}
async function sanityCheckKnownTxs(walletSubHex?: string) {
  console.log("=== Sanity Check: Known Transactions ===");
  console.log(
    `Date window: ${START_DATE.toISOString()} .. ${END_DATE.toISOString()} | Wallet=${WALLET_PRINCIPAL} | STRICT_SUBACCOUNT_MATCH=${STRICT_SUB ? 1 : 0}`
  );
  await sanityCheck_ckBTC(VERIFY_CKBTC_INDEX, walletSubHex);
  await sanityCheck_ckUSDC(VERIFY_CKUSDC_INDEX, walletSubHex);
  await sanityCheck_ICP(VERIFY_ICP_INDEX);
  console.log("=== End Sanity Check ===\n");
}

// ---------- Main scan ----------

async function main() {
  const WALLET_SUB_HEX = envHex("WALLET_SUBACCOUNT_HEX", "");
  console.log("ICP Transaction Scanner (REST)");
  console.log("================================");
  console.log(`Wallet Principal: ${WALLET_PRINCIPAL}`);
  console.log(`ICP Account ID:  ${ICP_ACCOUNT_ID_HEX}`);
  console.log(`Date window:     ${START_DATE.toISOString()} .. ${END_DATE.toISOString()}`);
  console.log(`STRICT_SUB:      ${STRICT_SUB ? "1 (exact)" : "0 (owner-only)"}`);
  console.log("");

  // 1) Sanity checks
  await sanityCheckKnownTxs(WALLET_SUB_HEX || undefined);

  // 2) CSV init
  ensureCsvHeader(OUT_CSV);
  console.log(`CSV file: ${OUT_CSV} (appending rows as they're found)\n`);

  // 3) Parallel scans (ICP + ICRC*)
  const fromISO = START_DATE.toISOString();
  const toISO = END_DATE.toISOString();

  const tasks = Object.entries(LEDGERS).map(async ([name, canister]) => {
    try {
      if (name === "ICP") {
        console.log(`Scanning ICP via Ledger API for ${ICP_ACCOUNT_ID_HEX} ...`);
        const txs = await fetchIcpTxByAccountHex(ICP_ACCOUNT_ID_HEX, fromISO, toISO, PAGE);
        let n = 0;
        for (const t of txs) {
          const row = mapIcpTxToCsv(t);
          if (row) {
            appendRow(OUT_CSV, row);
            n++;
          }
        }
        console.log(`  -> appended ${n} ICP rows\n`);
        return n;
      } else {
        console.log(`Scanning ${name} via ICRC API @ ${canister} for ${WALLET_PRINCIPAL} ...`);
        const txs = await fetchIcrcTxByAccount(
          canister,
          WALLET_PRINCIPAL,
          WALLET_SUB_HEX || undefined,
          fromISO,
          toISO,
          PAGE
        );
        let n = 0;
        for (const t of txs) {
          if (!passesStrictSub(t, WALLET_SUB_HEX || undefined)) continue;
          const row = mapIcrcTxToCsv(t);
          if (row) {
            appendRow(OUT_CSV, row);
            n++;
          }
        }
        console.log(`  -> appended ${n} ${name} rows\n`);
        return n;
      }
    } catch (e) {
      console.error(`  Error scanning ${name}:`, e, "\n");
      return 0;
    }
  });

  const counts = await Promise.all(tasks);
  const total = counts.reduce((a, b) => a + b, 0);

  console.log(`✅ Scan complete. Appended ${total} rows to ${OUT_CSV}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
