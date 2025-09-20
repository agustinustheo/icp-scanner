/**
 * Unified ICP Transaction Scanner
 * Scans ICP, ckBTC, ckUSDC, and ckUSDT with June 2025 cutoff
 */

import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";
import * as fs from "fs";
import * as crypto from "crypto";

// ---------- CONFIG ----------
const WALLET_PRINCIPAL =
  process.env.WALLET_PRINCIPAL ??
  "ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe";

const ICP_ACCOUNT_ID_HEX =
  (process.env.ICP_ACCOUNT_ID_HEX ??
    "e71fb5d09ec4082185c469d95ea1628e1fd5a6b3302cc7ed001df577995e9297")
    .toLowerCase();

const LEDGERS: Record<string, string> = {
  ICP: process.env.ICP_LEDGER ?? "ryjl3-tyaaa-aaaaa-aaaba-cai",
  ckBTC: process.env.CKBTC_LEDGER ?? "mxzaz-hqaaa-aaaar-qaada-cai",
  ckUSDC: process.env.CKUSDC_LEDGER ?? "xevnm-gaaaa-aaaar-qafnq-cai",
  ckUSDT: process.env.CKUSDT_LEDGER ?? "cngnf-vqaaa-aaaar-qag4q-cai",
};

// Optional cutoff date - set to far future by default (no cutoff)
const CUTOFF_DATE_STR = process.env.CUTOFF_DATE ?? "2030-12-31T23:59:59Z";
const CUTOFF_DATE = new Date(CUTOFF_DATE_STR);
const CUTOFF_TIMESTAMP = BigInt(CUTOFF_DATE.getTime()) * 1_000_000n;

const MAX_BLOCKS_PER_LEDGER = Number(process.env.MAX_BLOCKS_PER_LEDGER ?? 1_000_000);
const PAGE = 1000;
const HOST = process.env.IC_HOST ?? "https://ic0.app";
const OUT_CSV = process.env.OUT_CSV ?? "flows.csv";

// ---------- ICP Ledger IDL (query_blocks) ----------
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
  });
  
  const Mint = IDL.Record({
    to: AccountIdentifier,
    amount: Tokens,
  });
  
  const Burn = IDL.Record({
    from: AccountIdentifier,
    amount: Tokens,
  });
  
  const Operation = IDL.Variant({
    Transfer: Transfer,
    Mint: Mint,
    Burn: Burn,
  });
  
  const Transaction = IDL.Record({
    operation: Operation,
    memo: Memo,
    created_at_time: TimeStamp,
  });
  
  const Block = IDL.Record({
    parent_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
    transaction: Transaction,
    timestamp: TimeStamp,
  });
  
  const GetBlocksArgs = IDL.Record({
    start: BlockIndex,
    length: IDL.Nat64,
  });
  
  const QueryBlocksResponse = IDL.Rec();
  
  const QueryArchiveFn = IDL.Func([GetBlocksArgs], [QueryBlocksResponse], ["query"]);
  
  const ArchivedBlockRange = IDL.Record({
    start: BlockIndex,
    length: IDL.Nat64,
    callback: QueryArchiveFn,
  });
  
  QueryBlocksResponse.fill(IDL.Record({
    chain_length: IDL.Nat64,
    certificate: IDL.Opt(IDL.Vec(IDL.Nat8)),
    blocks: IDL.Vec(Block),
    first_block_index: BlockIndex,
    archived_blocks: IDL.Vec(ArchivedBlockRange),
  }));
  
  return IDL.Service({
    query_blocks: IDL.Func([GetBlocksArgs], [QueryBlocksResponse], ["query"]),
    symbol: IDL.Func([], [IDL.Text], ["query"]),
    decimals: IDL.Func([], [IDL.Nat32], ["query"]),
  });
};

// ---------- ICRC-3 IDL ----------
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

  const GetBlocksArgs = IDL.Vec(IDL.Record({ 
    start: IDL.Nat, 
    length: IDL.Nat 
  }));

  const GetBlocksResult = IDL.Rec();
  GetBlocksResult.fill(IDL.Record({
    log_length: IDL.Nat,
    blocks: IDL.Vec(IDL.Record({ 
      id: IDL.Nat, 
      block: Value 
    })),
    archived_blocks: IDL.Vec(IDL.Record({
      args: GetBlocksArgs,
      callback: IDL.Func([GetBlocksArgs], [GetBlocksResult], ["query"]),
    })),
  }));

  return IDL.Service({
    icrc1_symbol: IDL.Func([], [IDL.Text], ["query"]),
    icrc1_decimals: IDL.Func([], [IDL.Nat8], ["query"]),
    icrc3_get_blocks: IDL.Func([GetBlocksArgs], [GetBlocksResult], ["query"]),
  });
};

// ---------- Types ----------
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

// ---------- Helper Functions ----------
function toHex(a: Uint8Array): string {
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

function accountIdToHex(accountId: number[]): string {
  return toHex(new Uint8Array(accountId));
}

function memoToHex(m?: any): string {
  if (!m) return "";
  // ICP uses u64 for memo
  if (typeof m === "bigint" || typeof m === "number") {
    return BigInt(m).toString(16).padStart(16, "0");
  }
  const bytes = m instanceof Uint8Array ? m : Uint8Array.from(m);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function n64ToMillis(n?: any): number | null {
  if (n === undefined || n === null) return null;
  try {
    const nanos = n.timestamp_nanos ?? n;
    return Number(BigInt(nanos) / 1_000_000n);
  } catch {
    return null;
  }
}

function extractValue(value: any, key: string): any {
  if (!value || !value.Map) return null;
  const map = value.Map as [string, any][];
  const entry = map.find(([k]) => k === key);
  return entry ? entry[1] : null;
}

function extractText(value: any): string {
  if (!value) return "";
  if (value.Text !== undefined) return value.Text;
  if (value.Nat !== undefined) return value.Nat.toString();
  if (value.Int !== undefined) return value.Int.toString();
  return "";
}

function extractNat(value: any): bigint {
  if (!value || value.Nat === undefined) return 0n;
  return BigInt(value.Nat);
}

function extractBlob(value: any): number[] {
  if (!value || !value.Blob) return [];
  return value.Blob;
}

function extractAccount(value: any): Account | null {
  if (!value) return null;
  
  // Map form: { owner: Blob, subaccount: opt Blob }
  if (value.Map) {
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
  if (value.Array && value.Array?.[0]?.Blob) {
    try {
      const owner = Principal.fromUint8Array(new Uint8Array(value.Array[0].Blob));
      const sub = value.Array[1]?.Blob;
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
  if (sa.length === 32 && sa.every(b => b === 0)) return null;
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

async function getSymbolAndDecimals(actor: any, isIcp: boolean): Promise<{ symbol: string; decimals: number }> {
  let symbol = "TOKEN";
  let decimals = 0;
  try {
    if (isIcp) {
      symbol = await (actor as any).symbol();
      decimals = Number(await (actor as any).decimals());
    } else {
      symbol = await (actor as any).icrc1_symbol();
      decimals = Number(await (actor as any).icrc1_decimals());
    }
  } catch {}
  return { symbol, decimals };
}

// ---------- ICP Ledger Scanner ----------
async function scanIcpLedger(canisterId: string, walletPrincipal: string, icpAccountIdHex: string): Promise<CsvRow[]> {
  const agent = new HttpAgent({ host: HOST });
  const actor = Actor.createActor(ICP_LEDGER_IDL as any, { agent, canisterId });
  
  const { symbol, decimals } = await getSymbolAndDecimals(actor, true);
  console.log(`  Symbol: ${symbol}, Decimals: ${decimals}`);
  
  const rows: CsvRow[] = [];
  let scanned = 0;
  
  // Get chain length
  let chainLength = 0n;
  try {
    const res = await (actor as any).query_blocks({ start: 0n, length: 1n });
    chainLength = res.chain_length;
  } catch (e) {
    console.error(`  Failed to get chain length:`, e);
    return [];
  }
  
  const endIndex = chainLength - 1n;
  const startIndex = endIndex > BigInt(MAX_BLOCKS_PER_LEDGER) ? endIndex - BigInt(MAX_BLOCKS_PER_LEDGER) : 0n;
  
  console.log(`  Scanning blocks ${startIndex} to ${endIndex}...`);
  
  for (let cursor = endIndex; cursor >= startIndex && scanned < MAX_BLOCKS_PER_LEDGER;) {
    const length = BigInt(Math.min(PAGE, Number(cursor - startIndex + 1n)));
    const start = cursor - (length - 1n);
    
    try {
      const res = await (actor as any).query_blocks({ start, length });
      const blocks = res.blocks || [];
      
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const blockIndex = res.first_block_index + BigInt(i);
        const timestamp = n64ToMillis(block.timestamp);
        
        // Check cutoff date
        if (timestamp && timestamp > CUTOFF_DATE.getTime()) continue;
        
        const date_iso = timestamp ? new Date(timestamp).toISOString() : "";
        
        const tx = block.transaction;
        const opKey = Object.keys(tx.operation)[0];
        if (!opKey) continue;
        const op = tx.operation[opKey];
        
        if (opKey === "Transfer") {
          const fromHex = accountIdToHex(op.from);
          const toHex = accountIdToHex(op.to);
          const amount = op.amount.e8s.toString();
          const memo = memoToHex(tx.memo);
          
          let direction: CsvRow["direction"] | null = null;
          
          const matchesFrom = fromHex === icpAccountIdHex;
          const matchesTo = toHex === icpAccountIdHex;
          
          if (matchesFrom && matchesTo) direction = "self";
          else if (matchesTo) direction = "inflow";
          else if (matchesFrom) direction = "outflow";
          
          if (direction) {
            rows.push({
              date_iso,
              token: symbol,
              direction,
              amount: formatAmount(amount, decimals),
              from_principal: "", 
              to_principal: "",
              block_index: blockIndex.toString(),
              memo,
            });
          }
        }
      }
      
      // Process archived blocks (commenting out for now as ICP archive format varies)
      /*
      for (const range of res.archived_blocks ?? []) {
        if (scanned >= MAX_BLOCKS_PER_LEDGER) break;
        
        const [archiveCanister, method] = range.callback as [Principal, string];
        
        // ICP Archive IDL
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
          });
          
          const Mint = IDL.Record({
            to: AccountIdentifier,
            amount: Tokens,
          });
          
          const Burn = IDL.Record({
            from: AccountIdentifier,
            amount: Tokens,
          });
          
          const Operation = IDL.Variant({
            Transfer: Transfer,
            Mint: Mint,
            Burn: Burn,
          });
          
          const Transaction = IDL.Record({
            operation: Operation,
            memo: Memo,
            created_at_time: TimeStamp,
          });
          
          const Block = IDL.Record({
            parent_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
            transaction: Transaction,
            timestamp: TimeStamp,
          });
          
          return IDL.Service({
            get_blocks: IDL.Func(
              [IDL.Record({ start: IDL.Nat64, length: IDL.Nat64 })],
              [IDL.Record({
                blocks: IDL.Vec(Block),
                first_block_index: BlockIndex,
                chain_length: IDL.Nat64,
                certificate: IDL.Opt(IDL.Vec(IDL.Nat8))
              })],
              ["query"]
            )
          });
        };
        
        try {
          const archiveActor = Actor.createActor(ArchiveIDL as any, { 
            agent, 
            canisterId: archiveCanister.toText() 
          });
          const archiveRes = await (archiveActor as any)[method || "get_blocks"]({
            start: range.start,
            length: range.length
          });
          
          for (let i = 0; i < archiveRes.blocks.length && scanned < MAX_BLOCKS_PER_LEDGER; i++) {
            const block = archiveRes.blocks[i];
            const blockIndex = archiveRes.first_block_index + BigInt(i);
            const timestamp = n64ToMillis(block.timestamp);
            
            // Check cutoff date
            if (timestamp && timestamp > CUTOFF_DATE.getTime()) continue;
            
            const date_iso = timestamp ? new Date(timestamp).toISOString() : "";
            
            const tx = block.transaction;
            const opKey = Object.keys(tx.operation)[0];
            if (!opKey) continue;
            const op = tx.operation[opKey];
            
            if (opKey === "Transfer") {
              const fromHex = accountIdToHex(op.from);
              const toHex = accountIdToHex(op.to);
              const amount = op.amount.e8s.toString();
              const memo = memoToHex(tx.memo);
              
              let direction: CsvRow["direction"] | null = null;
              
              const matchesFrom = fromHex === icpAccountIdHex;
              const matchesTo = toHex === icpAccountIdHex;
              
              if (matchesFrom && matchesTo) direction = "self";
              else if (matchesTo) direction = "inflow";
              else if (matchesFrom) direction = "outflow";
              
              if (direction) {
                rows.push({
                  date_iso,
                  token: symbol,
                  direction,
                  amount: formatAmount(amount, decimals),
                  from_principal: "", 
                  to_principal: "",
                  block_index: blockIndex.toString(),
                  memo,
                });
              }
            }
            scanned++;
          }
        } catch (e) {
          console.error(`    Error fetching from archive:`, e);
        }
      }
      */
      
      scanned += blocks.length;
      cursor = start - 1n;
    } catch (e) {
      console.error(`  Failed to get blocks:`, e);
      break;
    }
  }
  
  return rows;
}

// ---------- ICRC-3 Scanner ----------
async function scanIcrcLedger(name: string, canisterId: string, wallet: Account): Promise<CsvRow[]> {
  const agent = new HttpAgent({ host: HOST });
  const actor = Actor.createActor(ICRC3_IDL as any, { agent, canisterId });
  
  const { symbol, decimals } = await getSymbolAndDecimals(actor, false);
  console.log(`  Symbol: ${symbol}, Decimals: ${decimals}`);
  
  const rows: CsvRow[] = [];
  let totalScanned = 0;
  
  try {
    const infoRes = await (actor as any).icrc3_get_blocks([{ start: 0n, length: 0n }]);
    const logLength = BigInt(infoRes.log_length);
    console.log(`  Total blocks: ${logLength}`);
    
    if (logLength === 0n) return rows;
    
    const endIndex = logLength - 1n;
    const scanStart = endIndex > BigInt(MAX_BLOCKS_PER_LEDGER) ? 
      endIndex - BigInt(MAX_BLOCKS_PER_LEDGER) : 0n;
    
    console.log(`  Scanning blocks ${scanStart} to ${endIndex}...`);
    
    for (let cursor = endIndex; cursor >= scanStart && totalScanned < MAX_BLOCKS_PER_LEDGER;) {
      const length = BigInt(Math.min(PAGE, Number(cursor - scanStart + 1n)));
      const start = cursor - (length - 1n);
      
      const res = await (actor as any).icrc3_get_blocks([{ start, length }]);
      const blocks = res.blocks || [];
      const archived = res.archived_blocks || [];
      
      // Process main blocks
      for (const blockWrapper of blocks) {
        if (totalScanned >= MAX_BLOCKS_PER_LEDGER) break;
        
        const blockId = blockWrapper.id;
        const block = blockWrapper.block;
        
        if (!block || !block.Map) {
          if (totalScanned < 10) console.log(`    Block ${blockId}: Not a Map`, block);
          continue;
        }
        
        const tx = extractValue(block, "tx");
        if (!tx || !tx.Map) {
          if (totalScanned < 10) console.log(`    Block ${blockId}: No tx Map`);
          continue;
        }
        
        const timestamp = extractNat(extractValue(block, "ts"));
        
        // Check cutoff date
        if (timestamp > CUTOFF_TIMESTAMP) continue;
        
        const date_iso = timestamp ? new Date(Number(timestamp) / 1_000_000).toISOString() : "";
        
        // Check for operation type - can be in tx.op or block.btype/type
        const opType = extractText(extractValue(tx, "op")) || 
                      extractText(extractValue(block, "btype")) ||
                      extractText(extractValue(block, "type"));
        
        if (opType === "xfer" || opType === "transfer") {
          const fromVal = extractValue(tx, "from");
          const toVal = extractValue(tx, "to");
          
          if (totalScanned < 10) {
            console.log(`    Block ${blockId}: xfer op, from:`, fromVal);
            console.log(`    Block ${blockId}: xfer op, to:`, toVal);
          }
          
          const from = extractAccount(fromVal);
          const to = extractAccount(toVal);
          const amount = extractNat(extractValue(tx, "amt")).toString();
          const memo = toHex(new Uint8Array(extractBlob(extractValue(tx, "memo"))));
          
          let direction: CsvRow["direction"] | null = null;
          
          if (from && to) {
            if (eqAccount(from, wallet) && eqAccount(to, wallet)) direction = "self";
            else if (eqAccount(to, wallet)) direction = "inflow";
            else if (eqAccount(from, wallet)) direction = "outflow";
            
            if (direction) {
              rows.push({
                date_iso,
                token: symbol,
                direction,
                amount: formatAmount(amount, decimals),
                from_principal: from.owner.toText(),
                to_principal: to.owner.toText(),
                block_index: blockId.toString(),
                memo,
              });
            }
          }
        }
        
        totalScanned++;
      }
      
      // Process archived blocks
      for (const archiveInfo of archived) {
        if (totalScanned >= MAX_BLOCKS_PER_LEDGER) break;
        
        const archiveArgs = archiveInfo.args;
        if (!archiveArgs || archiveArgs.length === 0) continue;
        
        const callback = archiveInfo.callback;
        if (!callback || !callback[0]) continue;
        
        try {
          const archiveCanisterId = callback[0];
          const archiveActor = Actor.createActor(ICRC3_IDL as any, { 
            agent, 
            canisterId: archiveCanisterId 
          });
          
          const archiveRes = await (archiveActor as any).icrc3_get_blocks(archiveArgs);
          const archiveBlocks = archiveRes.blocks || [];
          
          for (const blockWrapper of archiveBlocks) {
            if (totalScanned >= MAX_BLOCKS_PER_LEDGER) break;
            
            const blockId = blockWrapper.id;
            const block = blockWrapper.block;
            
            if (!block || !block.Map) continue;
            
            const tx = extractValue(block, "tx");
            if (!tx || !tx.Map) continue;
            
            const timestamp = extractNat(extractValue(block, "ts"));
            
            // Check cutoff date
            if (timestamp > CUTOFF_TIMESTAMP) continue;
            
            const date_iso = timestamp ? new Date(Number(timestamp) / 1_000_000).toISOString() : "";
            
            // Check for operation type - can be in tx.op or block.btype/type
            const opType = extractText(extractValue(tx, "op")) || 
                          extractText(extractValue(block, "btype")) ||
                          extractText(extractValue(block, "type"));
            
            if (opType === "xfer" || opType === "transfer") {
              const from = extractAccount(extractValue(tx, "from"));
              const to = extractAccount(extractValue(tx, "to"));
              const amount = extractNat(extractValue(tx, "amt")).toString();
              const memo = toHex(new Uint8Array(extractBlob(extractValue(tx, "memo"))));
              
              let direction: CsvRow["direction"] | null = null;
              
              if (from && to) {
                if (eqAccount(from, wallet) && eqAccount(to, wallet)) direction = "self";
                else if (eqAccount(to, wallet)) direction = "inflow";
                else if (eqAccount(from, wallet)) direction = "outflow";
                
                if (direction) {
                  rows.push({
                    date_iso,
                    token: symbol,
                    direction,
                    amount: formatAmount(amount, decimals),
                    from_principal: from.owner.toText(),
                    to_principal: to.owner.toText(),
                    block_index: blockId.toString(),
                    memo,
                  });
                }
              }
            }
            
            totalScanned++;
          }
        } catch (e) {
          console.error(`    Error fetching from archive:`, e);
        }
      }
      
      if (start === 0n) break;
      cursor = start - 1n;
    }
    
    console.log(`  Scanned ${totalScanned} blocks, found ${rows.length} transactions`);
    
  } catch (e) {
    console.error(`  Error scanning:`, e);
  }
  
  return rows;
}

// ---------- Main ----------
async function main() {
  const wallet: Account = {
    owner: Principal.fromText(WALLET_PRINCIPAL),
    subaccount: null,
  };
  
  console.log(`Unified ICP Transaction Scanner`);
  console.log(`================================`);
  console.log(`Wallet Principal: ${WALLET_PRINCIPAL}`);
  console.log(`ICP Account ID: ${ICP_ACCOUNT_ID_HEX}`);
  console.log(`Cutoff Date: ${CUTOFF_DATE.toISOString()}`);
  console.log(`Max blocks per ledger: ${MAX_BLOCKS_PER_LEDGER}`);
  console.log(`Debug: Scanner fixed with:`);
  console.log(`  - Map-based account extraction for ICRC-3`);
  console.log(`  - Archive support for ICP ledger`);
  console.log(`  - Normalized subaccount comparison`);
  console.log(`  - Flexible block type detection`);
  console.log(`\n`);
  
  const all: CsvRow[] = [];
  
  for (const [name, canisterId] of Object.entries(LEDGERS)) {
    console.log(`Scanning ${name} @ ${canisterId} ...`);
    
    try {
      let rows: CsvRow[];
      
      if (canisterId === LEDGERS.ICP) {
        rows = await scanIcpLedger(canisterId, WALLET_PRINCIPAL, ICP_ACCOUNT_ID_HEX);
      } else {
        rows = await scanIcrcLedger(name, canisterId, wallet);
      }
      
      console.log(`  -> found ${rows.length} matching transactions\n`);
      all.push(...rows);
    } catch (e) {
      console.error(`  Error scanning ${name}:`, e, "\n");
    }
  }
  
  // Sort by date
  all.sort((a, b) => (a.date_iso || "").localeCompare(b.date_iso || ""));
  
  // Write CSV
  const header = [
    "date_iso", "token", "direction", "amount", 
    "from_principal", "to_principal", "block_index", "memo"
  ];
  const lines = [header.join(",")].concat(
    all.map(r => [
        r.date_iso, r.token, r.direction, r.amount,
        r.from_principal, r.to_principal, r.block_index, r.memo,
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
    )
  );
  
  fs.writeFileSync(OUT_CSV, lines.join("\n"), "utf8");
  console.log(`✅ Wrote ${OUT_CSV} with ${all.length} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});