/**
 * Verify ICP ecosystem holdings (balances) by address via Rosetta.
 *
 * - ICP balances via ICP Rosetta /account/balance
 * - ICRC (ckBTC/ckUSDC/ckUSDT) balances via ICRC Rosetta /account/balance
 * - Logs each address balance and a PASS/FAIL summary vs expected totals
 *
 * Requirements: Node 18+ (built-in fetch) + ts-node for convenience
 *
 * Env (optional):
 *   ICP_ROSETTA_URL   (default: https://rosetta-api.internetcomputer.org)
 *   ICRC_ROSETTA_URL  (default: https://icrc-rosetta-api.internetcomputer.org)
 */

import { Principal } from "@dfinity/principal";
import { encodeIcrcAccount } from "@dfinity/ledger-icrc";

type NetworkId = string;

const ICP_ROSETTA = process.env.ICP_ROSETTA_URL || "https://rosetta-api.internetcomputer.org";
const ICRC_API = process.env.ICRC_API_URL || "https://icrc-api.internetcomputer.org/api/v1";

// ---- Ledgers (canister IDs) ----
const LEDGERS = {
  ICP: "00000000000000020101", // Rosetta network id for ICP mainnet
  ckBTC: "mxzaz-hqaaa-aaaar-qaada-cai",
  ckUSDC: "xevnm-gaaaa-aaaar-qafnq-cai",
  ckUSDT: "cngnf-vqaaa-aaaar-qag4q-cai",
} as const;

type Token = keyof typeof LEDGERS;

// ---- Token metadata (decimals) ----
const META: Record<Token, number> = {
  ICP: 8,
  ckBTC: 8,
  ckUSDC: 6,
  ckUSDT: 6,
};

// ---- Expected totals from your report (human units) ----
const EXPECTED: Record<Token, string> = {
  ICP: "10.58446086",
  ckBTC: "0.00003292",
  ckUSDC: "26.137704",
  ckUSDT: "8.308104",
};

// ---- Addresses from your report ----
// ICP = 64-hex account IDs
const ICP_ACCOUNTS: string[] = [
  // Medium holdings
  "385a55c2ce11e653a6b2a57977ccd2e8ac2c213322c33b108f5454038673f92a", // 2.000000 ICP
  "9e33c8e1f40d608f28a90e3b42e0981b45f60d2556cd53db0abaebb63b23ca04", // 1.299000 ICP
  "73bb002a5ca69d63e692d99383353082e591bacd439ef25eb22e8078904344eb", // 1.20606989 ICP
  // Small holdings
  "8b57f932fa624a9214afc2e2fda6e3d4bbc77cafec755249cb4279eee7089b70", // 0.242400 ICP
  "e71fb5d09ec4082185c469d95ea1628e1fd5a6b3302cc7ed001df577995e9297", // 0.128400 ICP
  "ac801181c724872270475e1ab0d74fda7b60cc0163534f95512cc3a4f9a0880d", // 0.091200 ICP
  "8585fdac56c2733021c57ae9cab6fb57bd67edc6ceb75dc3f75116e8031bc1f5", // 0.051100 ICP
];

// ICRC = Dashboard-style “principal[-tag].suffix” (or just “principal”)
// We’ll parse owner + subaccount from these strings.

// ckBTC holders
const CKBTC_ADDRS: string[] = [
  "ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe", // +0.00001081
  "6izkb-536f7-eib6o-anvgi-ob4rq-httn6-cqfqr-7yxg2-kxupl-sgar2-qqe", // +0.00002201
  "uiz2m-baaaa-aaaal-qjbxq-cai-jr377uq.109", // +0.00001010
  "g5nrt-myaaa-aaaap-qhluq-cai-tewwnyq.39", // +0.00000100
  "g5nrt-myaaa-aaaap-qhluq-cai-tzakf6y.35", // +0.00000100
];

// ckUSDC holders
const CKUSDC_ADDRS: string[] = [
  "uiz2m-baaaa-aaaal-qjbxq-cai-3teoeqy.98", // +11.900000
  "ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe", // +10.664462
  "6izkb-536f7-eib6o-anvgi-ob4rq-httn6-cqfqr-7yxg2-kxupl-sgar2-qqe", // +2.488926
  "g5nrt-myaaa-aaaap-qhluq-cai-5fdze3i.34", // +0.600000
  "gf3g2-eaeha-ii22q-ij5tb-bep3w-xxwgx-h4roh-6c2sm-cx2sw-tppv4-qqe", // +0.500000
  "g5nrt-myaaa-aaaap-qhluq-cai-aasdowa.36", // +0.300000
  "g5nrt-myaaa-aaaap-qhluq-cai-5yvfm5a.38", // +0.100000
];

// ckUSDT holders
const CKUSDT_ADDRS: string[] = [
  "uiz2m-baaaa-aaaal-qjbxq-cai-3teoeqy.98", // +0.850000 (and others)
  "ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe", // +2.295287
  "6izkb-536f7-eib6o-anvgi-ob4rq-httn6-cqfqr-7yxg2-kxupl-sgar2-qqe", // +3.006886
  "uiz2m-baaaa-aaaal-qjbxq-cai-vph5fvi.99", // +1.000000
  "uiz2m-baaaa-aaaal-qjbxq-cai-vsrbnta.103", // +0.850000
  "g5nrt-myaaa-aaaap-qhluq-cai-bgjhw4y.40", // +0.100000
  "g5nrt-myaaa-aaaap-qhluq-cai-aasdowa.36", // +0.100000
];

// ---------------- utilities ----------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Small helper to GET JSON with query params
async function getJson<T>(url: string, params?: Record<string, string>): Promise<T> {
  const qs =
    params && Object.keys(params).length ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(url + qs, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}${qs}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function toUnitsBig(human: string, decimals: number): bigint {
  const [w, f = ""] = String(human ?? "").split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

function formatUnits(units: bigint, decimals: number): string {
  const s = (units || 0n).toString();
  if (decimals === 0) return s;
  const pad = s.padStart(decimals + 1, "0");
  const whole = pad.slice(0, -decimals);
  const frac = pad.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function icrcTextToCanonicalId(text: string): string {
  if (!text || typeof text !== "string") throw new Error("ICRC address text is required.");

  // Split "<owner[-tag]>[.suffix]"
  const lastDot = text.lastIndexOf(".");
  const ownerWithMaybeTag = lastDot === -1 ? text : text.slice(0, lastDot);
  const suffix = lastDot === -1 ? "" : text.slice(lastDot + 1);

  // Extract bare principal (strip any trailing "-xxxxxxx" tag if present)
  const m = ownerWithMaybeTag.match(/^(.*?)(?:-[a-z2-7]{7})?$/i);
  const ownerPrincipal = (m?.[1] || "").trim();
  if (!ownerPrincipal) throw new Error(`Could not parse principal from "${text}"`);

  // Build optional 32-byte subaccount bytes from suffix
  let subBytes: Uint8Array | undefined;
  if (suffix) {
    const hexFromDec = (n: string): string => {
      let h = BigInt(n).toString(16);
      if (h.length % 2) h = "0" + h;
      return h.padStart(64, "0"); // 32 bytes BE
    };

    let hex = "";
    if (/^\d+$/.test(suffix)) {
      hex = hexFromDec(suffix);
    } else if (/^(?:0x)?[0-9a-f]{64}$/i.test(suffix)) {
      hex = suffix.replace(/^0x/i, "").toLowerCase();
    } else {
      throw new Error(`Invalid subaccount suffix "${suffix}"`);
    }

    // hex -> bytes
    const out = new Uint8Array(32);
    for (let i = 0; i < 64; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    subBytes = out;
  }

  // Canonical account text (includes the short checksum tag + ".0xHEX" when subaccount set)
  const principal = Principal.fromText(ownerPrincipal);
  return subBytes
    ? encodeIcrcAccount({ owner: principal, subaccount: subBytes })
    : encodeIcrcAccount({ owner: principal });
}

// ---------------- Rosetta calls ----------------
type RosettaCurrency = { symbol: string; decimals: number };
type RosettaBalanceResponse = { balances?: Array<{ value: string; currency: RosettaCurrency }> };

async function rosettaAccountBalance(
  baseUrl: string,
  network: NetworkId,
  accountIdentifier: Record<string, unknown>
): Promise<{ value: bigint; currency?: RosettaCurrency }> {
  const body = {
    network_identifier: { blockchain: "Internet Computer", network },
    account_identifier: accountIdentifier,
  };
  const res = await fetch(`${baseUrl}/account/balance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Rosetta balance error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as RosettaBalanceResponse;
  const entry = (data.balances || [])[0];
  const value = BigInt(entry?.value ?? "0");
  const currency = entry?.currency as RosettaCurrency | undefined;

  // exactOptionalPropertyTypes: don't assign undefined to an optional; omit instead.
  return currency ? { value, currency } : { value };
}

async function getIcpBalance(accountIdHex: string): Promise<bigint> {
  const { value } = await rosettaAccountBalance(ICP_ROSETTA, LEDGERS.ICP, {
    address: accountIdHex.toLowerCase(),
  });
  return value; // e8s
}

async function getIcrcBalance(ledgerCanister: string, textAddress: string): Promise<bigint> {
  const id = icrcTextToCanonicalId(textAddress); // <-- canonical <owner-tag>[.0xHEX]
  const url = `${ICRC_API}/ledgers/${encodeURIComponent(ledgerCanister)}/accounts/${encodeURIComponent(id)}`;
  const acct = await getJson<{ balance: string }>(url);
  return BigInt(acct.balance || "0");
}

async function sumTokenBalances(token: Token, addresses: string[]): Promise<bigint> {
  const decimals = META[token];
  const isICP = token === "ICP";
  let total = 0n;

  console.log(`\n=== ${token} address balances ===`);
  for (const addr of addresses) {
    try {
      let units = 0n;
      units = isICP ? await getIcpBalance(addr) : await getIcrcBalance(LEDGERS[token], addr);
      total += units;
      console.log(`${token.padEnd(6)} ${addr} -> ${formatUnits(units, decimals)} ${token}`);
    } catch (e: any) {
      console.log(`${token.padEnd(6)} ${addr} -> ERROR: ${e?.message || String(e)}`);
    }
    // polite pacing to avoid throttling
    await sleep(60);
  }
  console.log(`Total ${token}: ${formatUnits(total, decimals)} ${token}\n`);
  return total;
}

async function main(): Promise<void> {
  console.log("ICP Ecosystem Holdings Verifier (Rosetta + TypeScript)");
  console.log("------------------------------------------------------");
  console.log(`ICP Rosetta: ${ICP_ROSETTA}`);
  console.log(`ICRC API: ${ICRC_API}`);

  const live: Record<Token, bigint> = {
    ICP: 0n,
    ckBTC: 0n,
    ckUSDC: 0n,
    ckUSDT: 0n,
  };

  live.ICP = await sumTokenBalances("ICP", ICP_ACCOUNTS);
  live.ckBTC = await sumTokenBalances("ckBTC", CKBTC_ADDRS);
  live.ckUSDC = await sumTokenBalances("ckUSDC", CKUSDC_ADDRS);
  live.ckUSDT = await sumTokenBalances("ckUSDT", CKUSDT_ADDRS);

  console.log("\n====== SUMMARY ======");
  let allPass = true;
  (["ICP", "ckBTC", "ckUSDC", "ckUSDT"] as Token[]).forEach((tkn) => {
    const dec = META[tkn];
    const expectedUnits = toUnitsBig(EXPECTED[tkn], dec);
    const liveUnits = live[tkn];
    const diff = liveUnits - expectedUnits;
    const pass = diff === 0n; // strict
    allPass &&= pass;
    const diffAbs = diff < 0n ? -diff : diff;
    const diffHuman = formatUnits(diffAbs, dec);

    console.log(
      `${tkn.padEnd(6)} EXPECTED=${EXPECTED[tkn].padStart(14)}  ` +
        `LIVE=${formatUnits(liveUnits, dec).padStart(14)}  ` +
        (pass ? "✅ PASS" : `❌ DIFF=${diff < 0n ? "-" : "+"}${diffHuman}`)
    );
  });

  console.log(
    allPass ? "\nALL TOTALS MATCH ✅" : "\nSome totals differ ❗ Review the per-address logs above."
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
