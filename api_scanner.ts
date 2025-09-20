/**
 * ICP Transaction Scanner - Unified scanner for ICP and ICRC tokens
 *
 * Features:
 * - Scans ICP via Rosetta API (primary) or Dashboard API (fallback)
 * - Scans ICRC tokens (ckBTC, ckUSDC, ckUSDT) via ICRC API
 * - Exports all transactions to CSV format
 * - Supports date filtering and subaccount matching
 *
 * Environment Variables:
 * - WALLET_PRINCIPAL: Your ICP principal
 * - ICP_ACCOUNT_ID_HEX: Your ICP account ID (64-hex)
 * - START_DATE/END_DATE: Date range to scan
 * - OUT_CSV: Output CSV filename
 * - PAGE: Page size for fetching (default: 1000)
 * - STRICT_SUBACCOUNT_MATCH: 0=owner-only, 1=exact subaccount match
 */

import * as fs from "fs";

// ==================== Environment Helpers ====================

const env = {
  getString: (name: string, defaultValue: string): string => {
    const value = process.env[name];
    return value?.trim() || defaultValue;
  },

  getNumber: (name: string, defaultValue: number, min?: number): number => {
    const value = Number(process.env[name]);
    if (!Number.isFinite(value)) return defaultValue;
    return min !== undefined && value < min ? defaultValue : value;
  },

  getDate: (name: string, defaultISO: string): Date => {
    const value = process.env[name];
    if (!value) return new Date(defaultISO);
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : new Date(defaultISO);
  },

  getHex: (name: string, defaultValue: string): string => {
    const value = (process.env[name] ?? defaultValue).toLowerCase().replace(/^0x/, "");
    return /^[0-9a-f]*$/.test(value) ? value : defaultValue.toLowerCase();
  },
};

// ==================== Configuration ====================

const config = {
  // Wallet configuration
  wallet: {
    principal: env.getString(
      "WALLET_PRINCIPAL",
      "ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe"
    ),
    accountIdHex: env.getHex(
      "ICP_ACCOUNT_ID_HEX",
      "e71fb5d09ec4082185c469d95ea1628e1fd5a6b3302cc7ed001df577995e9297"
    ),
    subaccountHex: env.getHex("WALLET_SUBACCOUNT_HEX", ""),
  },

  // Ledger canister IDs
  ledgers: {
    ICP: env.getString("ICP_LEDGER", "ryjl3-tyaaa-aaaaa-aaaba-cai"),
    ckBTC: env.getString("CKBTC_LEDGER", "mxzaz-hqaaa-aaaar-qaada-cai"),
    ckUSDC: env.getString("CKUSDC_LEDGER", "xevnm-gaaaa-aaaar-qafnq-cai"),
    ckUSDT: env.getString("CKUSDT_LEDGER", "cngnf-vqaaa-aaaar-qag4q-cai"),
  },

  // Scanning parameters
  scanning: {
    startDate: env.getDate("START_DATE", "2025-06-01T00:00:00Z"),
    endDate: env.getDate("END_DATE", new Date().toISOString()),
    pageSize: env.getNumber("PAGE", 1000, 1),
    strictSubaccountMatch: env.getNumber("STRICT_SUBACCOUNT_MATCH", 0) > 0,
  },

  // Output configuration
  output: {
    csvPath: env.getString("OUT_CSV", "flows.csv"),
  },

  // Sanity check indices
  verifyIndices: {
    ckBTC: BigInt(env.getNumber("VERIFY_CKBTC_INDEX", 2_783_712, 0)),
    ckUSDC: BigInt(env.getNumber("VERIFY_CKUSDC_INDEX", 408_821, 0)),
    ICP: BigInt(env.getNumber("VERIFY_ICP_INDEX", 25_906_544, 0)),
  },
};

// ==================== API Endpoints ====================

const endpoints = {
  ledger: {
    host: "https://ledger-api.internetcomputer.org",
    bases: [
      "https://ledger-api.internetcomputer.org/api",
      "https://ledger-api.internetcomputer.org",
    ],
  },
  icrc: {
    v1: "https://icrc-api.internetcomputer.org/api/v1",
    v2: "https://icrc-api.internetcomputer.org/api/v2",
  },
  rosetta: {
    icp: env.getString("ICP_ROSETTA_URL", "https://rosetta-api.internetcomputer.org"),
    icrc: env.getString("ICRC_ROSETTA_URL", ""),
  },
};

// Token metadata
const tokenMetadata: Record<string, { symbol: string; decimals: number }> = {
  [config.ledgers.ICP]: { symbol: "ICP", decimals: 8 },
  [config.ledgers.ckBTC]: { symbol: "ckBTC", decimals: 8 },
  [config.ledgers.ckUSDC]: { symbol: "ckUSDC", decimals: 6 },
  [config.ledgers.ckUSDT]: { symbol: "ckUSDT", decimals: 6 },
};

// ==================== Types ====================

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

type IcrcTx = {
  id: string;
  timestamp: string;
  op: string;
  from?: { owner: string; subaccount?: string } | undefined;
  to?: { owner: string; subaccount?: string } | undefined;
  amount?: string;
  symbol?: string;
  decimals?: number;
  memo_hex?: string;
};

// ==================== CSV Utilities ====================

const csv = {
  header: [
    "date_iso",
    "token",
    "direction",
    "amount",
    "from_principal",
    "to_principal",
    "block_index",
    "memo",
  ] as const,

  ensureHeader: (path: string): void => {
    if (!fs.existsSync(path) || fs.statSync(path).size === 0) {
      fs.writeFileSync(path, csv.header.join(",") + "\n", "utf8");
    }
  },

  escape: (value: unknown): string => {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  },

  appendRow: (path: string, row: CsvRow): void => {
    const values = csv.header.map((key) => row[key]);
    const line = values.map(csv.escape).join(",") + "\n";
    fs.appendFileSync(path, line, "utf8");
  },
};
// ==================== Utility Functions ====================

const utils = {
  /**
   * Format amount with proper decimal places
   * Example: formatAmount("123456", 2) => "1234.56"
   */
  formatAmount: (raw: string, decimals: number): string => {
    const cleanAmount = (raw || "0").replace(/^0+/, "") || "0";
    if (decimals <= 0) return cleanAmount;

    const whole = cleanAmount.length > decimals ? cleanAmount.slice(0, -decimals) : "0";
    const fraction =
      cleanAmount.length > decimals
        ? cleanAmount.slice(-decimals)
        : cleanAmount.padStart(decimals, "0");
    const trimmedFraction = fraction.replace(/0+$/, "");

    return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  },

  /**
   * Convert various timestamp formats to ISO string
   * Handles: ISO strings, epoch seconds, milliseconds, microseconds, nanoseconds
   */
  toISO: (timestamp: any): string => {
    if (!timestamp) return "";

    // Handle string dates
    if (typeof timestamp === "string" && timestamp.trim() && isNaN(Number(timestamp))) {
      const date = new Date(timestamp);
      return Number.isFinite(date.getTime()) ? date.toISOString() : "";
    }

    let numericTime = Number(timestamp);
    if (!Number.isFinite(numericTime)) return "";

    // Convert to milliseconds based on magnitude
    if (numericTime > 1e18) {
      numericTime = Math.floor(numericTime / 1e6); // nanoseconds to ms
    } else if (numericTime > 1e15) {
      numericTime = Math.floor(numericTime / 1e3); // microseconds to ms
    } else if (numericTime > 1e12) {
      numericTime = Math.floor(numericTime); // already milliseconds
    } else if (numericTime > 1e5) {
      numericTime = Math.floor(numericTime * 1000); // seconds to ms
    }

    const date = new Date(numericTime);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  },

  /**
   * Normalize subaccount hex strings for comparison
   */
  normalizeSubaccount: (sub?: string): string => {
    const normalized = (sub || "").replace(/^0x/, "").toLowerCase();
    return !normalized || /^0+$/.test(normalized) ? "" : normalized;
  },
};

// ==================== HTTP Utilities ====================
type RosettaSearchTx = {
  block_identifier: { index: number; hash: string };
  transaction: {
    transaction_identifier: { hash: string };
    operations: Array<{
      operation_identifier: { index: number };
      type: string;
      status: string;
      account?: {
        address: string;
        sub_account?: { address: string };
      };
      amount?: {
        value: string;
        currency: { symbol: string; decimals: number };
      };
      metadata?: any;
    }>;
    metadata: {
      timestamp?: string;
      memo?: string;
      [key: string]: any;
    };
  };
};

const http = {
  /**
   * Build query string from parameters
   */
  buildQueryString: (params?: Record<string, string | number | undefined>): string => {
    if (!params) return "";
    const entries = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    return entries.length > 0 ? `?${entries.join("&")}` : "";
  },

  /**
   * Fetch JSON from a URL with query parameters
   */
  getJson: async <T>(
    url: string,
    params?: Record<string, string | number | undefined>
  ): Promise<T> => {
    const fullUrl = url + http.buildQueryString(params);
    const response = await fetch(fullUrl);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status} ${response.statusText} for ${fullUrl}\n${errorBody.slice(0, 256)}`
      );
    }

    return response.json() as Promise<T>;
  },

  /**
   * Try multiple base URLs until one succeeds
   */
  getJsonFromBases: async <T>(
    path: string,
    params?: Record<string, string | number | undefined>
  ): Promise<T> => {
    const queryString = http.buildQueryString(params);
    const urls = endpoints.ledger.bases.map((base) => `${base}${path}${queryString}`);

    let lastError: any;
    for (const url of urls) {
      try {
        return await http.getJson<T>(url);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  },

  /**
   * POST JSON to a Rosetta endpoint
   */
  postRosetta: async <T>(endpoint: string, body: any): Promise<T> => {
    const response = await fetch(`${endpoints.rosetta.icp}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Rosetta ${response.status}: ${errorText.slice(0, 256)}`);
    }

    return response.json() as Promise<T>;
  },
};

// ==================== ICP Transaction Fetching ====================

const icpTransactions = {
  /**
   * Normalize ICP v2 API response (handles different response shapes)
   */
  normalizeV2Response: (response: any): { items: IcpTx[]; next?: string } => {
    const items = (response?.blocks ?? response?.data ?? response?.transactions ?? []) as IcpTx[];
    const next = response?.next_cursor ?? response?.next ?? response?.links?.next;
    return { items, next };
  },

  /**
   * Fetch ICP transactions for account (tries v2 then v1 API)
   */
  fetchByAccount: async (
    accountHex: string,
    fromISO: string,
    toISO: string,
    pageSize: number
  ): Promise<IcpTx[]> => {
    const limit = Math.min(100, pageSize); // API max is 100
    const startTime = Math.floor(new Date(fromISO).getTime() / 1000);
    const endTime = Math.floor(new Date(toISO).getTime() / 1000);
    const transactions: IcpTx[] = [];

    // Try v2 API with cursor pagination
    try {
      let cursor: string | undefined;
      for (let iterations = 0; iterations < 1000; iterations++) {
        const response = await http.getJsonFromBases<any>(
          `/v2/accounts/${accountHex}/transactions`,
          {
            sort_by: "-block_height",
            limit,
            created_at_start: startTime,
            created_at_end: endTime,
            ...(cursor ? { after: cursor } : {}),
          }
        );

        const { items, next } = icpTransactions.normalizeV2Response(response);
        transactions.push(...items);

        if (!next || items.length < limit) break;
        cursor = next;
      }

      if (transactions.length > 0) return transactions;
    } catch {
      // Fall through to v1
    }

    // Fallback to v1 API with offset pagination
    let offset = 0;
    for (let iterations = 0; iterations < 1000; iterations++) {
      const response = await http.getJsonFromBases<any>(`/accounts/${accountHex}/transactions`, {
        sort_by: "-block_height",
        limit,
        offset,
        start: startTime,
        end: endTime,
      });

      const batch = (response.blocks ?? response.data ?? []) as IcpTx[];
      transactions.push(...batch);

      if (batch.length === 0 || batch.length < limit) break;
      offset += batch.length;
    }

    return transactions;
  },

  /**
   * Fetch ICP transactions via global fallback (when account-scoped returns 0)
   */
  fetchGlobalFallback: async (
    accountHex: string,
    fromISO: string,
    toISO: string,
    pageSize: number
  ): Promise<IcpTx[]> => {
    const limit = Math.min(100, pageSize);
    const startTime = Math.floor(new Date(fromISO).getTime() / 1000);
    const endTime = Math.floor(new Date(toISO).getTime() / 1000);
    const transactions: IcpTx[] = [];

    // Helper to page through v2 global transactions
    const fetchV2Global = async (params: Record<string, any>) => {
      let cursor: string | undefined;
      for (let iterations = 0; iterations < 1000; iterations++) {
        const response = await http.getJsonFromBases<any>("/v2/transactions", {
          sort_by: "-block_height",
          limit,
          created_at_start: startTime,
          created_at_end: endTime,
          ...(cursor ? { after: cursor } : {}),
          ...params,
        });

        const items = (response?.blocks ??
          response?.data ??
          response?.transactions ??
          []) as IcpTx[];
        transactions.push(...items);

        const next = response?.next_cursor ?? response?.next ?? response?.links?.next;
        if (!next || items.length < limit) break;
        cursor = next;
      }
    };

    // Helper to page through v1 global transactions
    const fetchV1Global = async (params: Record<string, any>) => {
      let offset = 0;
      for (let iterations = 0; iterations < 1000; iterations++) {
        const response = await http.getJsonFromBases<any>("/transactions", {
          sort_by: "-block_height",
          limit,
          offset,
          start: startTime,
          end: endTime,
          ...params,
        });

        const batch = (response?.blocks ?? response?.data ?? []) as IcpTx[];
        transactions.push(...batch);

        if (batch.length === 0 || batch.length < limit) break;
        offset += batch.length;
      }
    };

    try {
      // Try v2 first, both directions
      const beforeFrom = transactions.length;
      await fetchV2Global({ from_account: accountHex });
      const fromCount = transactions.length - beforeFrom;

      const beforeTo = transactions.length;
      await fetchV2Global({ to_account: accountHex });
      const toCount = transactions.length - beforeTo;

      if (transactions.length > 0) {
        console.log(
          `    Global v2: found ${fromCount} from_account + ${toCount} to_account = ${transactions.length} total`
        );
        return transactions;
      }
    } catch {
      // Fall through to v1
    }

    // Try v1 fallback
    await fetchV1Global({ from_account: accountHex });
    await fetchV1Global({ to_account: accountHex });

    return transactions;
  },

  /**
   * Fetch ICP transactions via Rosetta API
   */
  fetchViaRosetta: async (
    accountHex: string,
    fromISO: string,
    toISO: string,
    pageSize: number
  ): Promise<IcpTx[]> => {
    const limit = Math.min(100, pageSize);
    const transactions: IcpTx[] = [];
    let offset = 0;

    for (let iterations = 0; iterations < 1000; iterations++) {
      const result = await http.postRosetta<{
        transactions: RosettaSearchTx[];
        total_count: number;
        next_offset?: number;
      }>("/search/transactions", {
        network_identifier: { blockchain: "Internet Computer", network: "00000000000000020101" },
        account_identifier: { address: accountHex },
        limit,
        offset,
      });

      for (const rtx of result.transactions || []) {
        // Extract timestamp
        const tsNano = rtx.transaction.metadata?.timestamp;
        const tsMs = tsNano ? Number(BigInt(tsNano) / BigInt(1_000_000)) : 0;
        const timestamp = new Date(tsMs);

        // Skip if outside date range
        if (timestamp < new Date(fromISO) || timestamp > new Date(toISO)) {
          continue;
        }

        // Extract from/to/amount from operations
        let fromAddress = "";
        let toAddress = "";
        let amount = "0";

        for (const op of rtx.transaction.operations) {
          if (op.type !== "TRANSACTION" && op.type !== "TRANSFER") continue;

          if (op.amount?.value?.startsWith("-")) {
            fromAddress = op.account?.address || "";
          } else if (op.amount?.value) {
            toAddress = op.account?.address || "";
            amount = op.amount.value;
          }
        }

        transactions.push({
          block_height: String(rtx.block_identifier.index),
          block_hash: rtx.block_identifier.hash,
          transaction_hash: rtx.transaction.transaction_identifier.hash,
          transfer_type: "transfer",
          amount,
          from_account_identifier: fromAddress,
          to_account_identifier: toAddress,
          created_at: Math.floor(tsMs / 1000),
          memo: String(rtx.transaction.metadata?.memo || ""),
        });
      }

      if (!result.next_offset || result.transactions.length < limit) break;
      offset = result.next_offset;
    }

    return transactions;
  },
};

// ==================== ICRC Transaction Fetching ====================

const icrcTransactions = {
  /**
   * Fetch ICRC transactions for an account
   */
  fetchByAccount: async (
    ledger: string,
    owner: string,
    _subHex: string | undefined,
    fromISO: string,
    toISO: string,
    pageSize: number
  ): Promise<IcrcTx[]> => {
    const limit = Math.min(100, pageSize);
    const startTime = Math.floor(new Date(fromISO).getTime() / 1000);
    const endTime = Math.floor(new Date(toISO).getTime() / 1000);
    const meta = tokenMetadata[ledger] ?? { symbol: "TOKEN", decimals: 8 };
    const transactions: IcrcTx[] = [];
    let cursor: string | undefined;

    for (let iterations = 0; iterations < 1000; iterations++) {
      const response = await http.getJson<{ data: any[]; next_cursor?: string }>(
        `${endpoints.icrc.v2}/ledgers/${ledger}/transactions`,
        {
          limit,
          sort_by: "-index",
          start: startTime,
          end: endTime,
          query: owner,
          include_kind: "transfer",
          ...(cursor ? { after: cursor } : {}),
        }
      );

      for (const item of response.data || []) {
        const timestamp = item?.created_at ?? item?.timestamp ?? "";
        transactions.push({
          id: String(item?.index ?? ""),
          timestamp,
          op: String(item?.kind ?? "").toLowerCase(),
          from: item?.from_owner
            ? {
                owner: item.from_owner,
                ...(item.from_subaccount ? { subaccount: item.from_subaccount } : {}),
              }
            : undefined,
          to: item?.to_owner
            ? {
                owner: item.to_owner,
                ...(item.to_subaccount ? { subaccount: item.to_subaccount } : {}),
              }
            : undefined,
          amount: item?.amount ?? "0",
          symbol: meta.symbol,
          decimals: meta.decimals,
          memo_hex: item?.memo ?? "",
        });
      }

      if (!response.next_cursor || (response.data || []).length < limit) break;
      cursor = response.next_cursor;
    }

    return transactions;
  },

  /**
   * Get ICRC block by index (for sanity checks)
   */
  getBlockByIndex: async (
    ledger: string,
    index: bigint
  ): Promise<{ id: string; timestamp: string; tx?: IcrcTx } | null> => {
    const indexStr = index.toString();

    // Try ICRC API first
    try {
      const response = await http.getJson<any>(
        `${endpoints.icrc.v1}/ledgers/${ledger}/transactions/${indexStr}`
      );

      return {
        id: response?.index?.toString() ?? indexStr,
        timestamp: response?.timestamp ?? "",
        tx: {
          id: response?.index?.toString() ?? indexStr,
          timestamp: response?.timestamp ?? "",
          op: String(response?.kind ?? "").toLowerCase(),
          from: response?.from_owner
            ? {
                owner: response.from_owner,
                ...(response.from_subaccount ? { subaccount: response.from_subaccount } : {}),
              }
            : undefined,
          to: response?.to_owner
            ? {
                owner: response.to_owner,
                ...(response.to_subaccount ? { subaccount: response.to_subaccount } : {}),
              }
            : undefined,
          amount: response?.amount ?? "0",
          symbol: "TOKEN",
          decimals: 8,
          memo_hex: response?.memo ?? "",
        },
      };
    } catch {
      // Try Rosetta fallback if configured
      if (!endpoints.rosetta.icrc) return null;

      try {
        const response = await fetch(`${endpoints.rosetta.icrc}/block`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            network_identifier: { blockchain: "Internet Computer", network: ledger },
            block_identifier: { index: Number(index) },
          }),
        });

        if (!response.ok) return null;

        const data = await response.json();
        const tsMs = Number(data?.block?.timestamp ?? 0) / 1_000_000;
        const ops = data?.block?.transactions?.[0]?.operations ?? [];
        const firstOp = ops[0] || {};
        const opMeta = firstOp?.metadata || {};

        return {
          id: String(index),
          timestamp: utils.toISO(tsMs),
          tx: {
            id: String(index),
            timestamp: utils.toISO(tsMs),
            op: String(firstOp?.type || opMeta?.op || "transfer"),
            from: opMeta?.from
              ? {
                  owner: String(opMeta.from.owner),
                  ...(opMeta.from.subaccount ? { subaccount: String(opMeta.from.subaccount) } : {}),
                }
              : undefined,
            to: opMeta?.to
              ? {
                  owner: String(opMeta.to.owner),
                  ...(opMeta.to.subaccount ? { subaccount: String(opMeta.to.subaccount) } : {}),
                }
              : undefined,
            amount: opMeta?.amount ?? opMeta?.amt ?? "0",
            symbol: opMeta?.symbol || "TOKEN",
            decimals: opMeta?.decimals ?? 8,
            memo_hex: opMeta?.memo_hex || "",
          },
        };
      } catch {
        return null;
      }
    }
  },
};

// ==================== Block Fetching ====================

const blockFetching = {
  /**
   * Get ICP block by index via Rosetta (for sanity checks)
   */
  getIcpBlockByIndex: async (
    index: bigint
  ): Promise<{
    index: string;
    timestamp: string;
    op?: string;
    from_hex?: string;
    to_hex?: string;
    amount_e8s?: string;
    memo_hex?: string;
  } | null> => {
    if (!endpoints.rosetta.icp) return null;

    try {
      const response = await fetch(`${endpoints.rosetta.icp}/block`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          network_identifier: { blockchain: "Internet Computer", network: "00000000000000020101" },
          block_identifier: { index: Number(index) },
        }),
      });

      if (!response.ok) return null;

      const data = await response.json();
      const tsMs = Number(data?.block?.timestamp ?? 0) / 1_000_000;
      const tx = data?.block?.transactions?.[0];
      const ops = tx?.operations ?? [];
      const transferOp = ops.find((o: any) => /transfer/i.test(o?.type || "")) || ops[0] || {};
      const opMeta = transferOp?.metadata || {};

      return {
        index: String(index),
        timestamp: utils.toISO(tsMs),
        op: String(transferOp?.type || "Transfer"),
        from_hex: opMeta?.from_account_identifier || opMeta?.from || "",
        to_hex: opMeta?.to_account_identifier || opMeta?.to || "",
        amount_e8s: opMeta?.amount_e8s || opMeta?.amount || "0",
        memo_hex: opMeta?.memo_hex || "",
      };
    } catch {
      return null;
    }
  },
};

// ==================== Account Matching ====================

const matching = {
  /**
   * Compare two subaccount hex strings (treating empty/zero as equivalent)
   */
  equalSubaccounts: (a?: string, b?: string): boolean => {
    const normA = utils.normalizeSubaccount(a);
    const normB = utils.normalizeSubaccount(b);
    return normA === normB;
  },

  /**
   * Check if an ICRC account matches the wallet
   */
  matchesIcrcAccount: (
    account: { owner?: string; subaccount?: string } | undefined,
    walletOwner: string,
    walletSubHex?: string
  ): boolean => {
    if (!account?.owner || account.owner !== walletOwner) return false;
    if (!config.scanning.strictSubaccountMatch) return true;
    return matching.equalSubaccounts(account.subaccount, walletSubHex);
  },

  /**
   * Check if an ICRC transaction passes strict subaccount filter
   */
  passesStrictSubaccountFilter: (tx: IcrcTx, walletSubHex?: string): boolean => {
    if (!config.scanning.strictSubaccountMatch || !walletSubHex) return true;

    const normalizedWallet = utils.normalizeSubaccount(walletSubHex);
    const fromMatches =
      tx.from?.owner === config.wallet.principal &&
      utils.normalizeSubaccount(tx.from?.subaccount) === normalizedWallet;
    const toMatches =
      tx.to?.owner === config.wallet.principal &&
      utils.normalizeSubaccount(tx.to?.subaccount) === normalizedWallet;

    return fromMatches || toMatches;
  },
};

// ==================== CSV Mapping ====================

const csvMapping = {
  /**
   * Convert ICP transaction to CSV row
   */
  fromIcpTransaction: (tx: IcpTx): CsvRow | null => {
    const operation = (tx.transfer_type || "").toLowerCase();
    const fromHex = (tx.from_account_identifier || "").toLowerCase();
    const toHex = (tx.to_account_identifier || "").toLowerCase();
    const accountIdHex = config.wallet.accountIdHex.toLowerCase();

    let direction: Direction | null = null;
    if (operation === "mint") {
      direction = "mint";
    } else if (operation === "burn") {
      direction = "burn";
    } else if (operation === "transfer") {
      if (fromHex === accountIdHex && toHex === accountIdHex) {
        direction = "self";
      } else if (toHex === accountIdHex) {
        direction = "inflow";
      } else if (fromHex === accountIdHex) {
        direction = "outflow";
      }
    }

    if (!direction) return null;

    return {
      date_iso: utils.toISO((tx.created_at ?? 0) * 1000), // seconds to ms
      token: "ICP",
      direction,
      amount: utils.formatAmount(String(tx.amount ?? "0"), 8),
      from_principal: fromHex,
      to_principal: toHex,
      block_index: String(tx.block_height),
      memo: String((tx as any).icrc1_memo ?? tx.memo ?? "").toLowerCase(),
    };
  },

  /**
   * Convert ICRC transaction to CSV row
   */
  fromIcrcTransaction: (tx: IcrcTx): CsvRow | null => {
    const operation = (tx.op || "").toLowerCase();
    const isTransfer = ["transfer", "1xfer", "icrc1_transfer", "xfer"].includes(operation);

    if (!isTransfer) return null;

    let direction: Direction | null = null;
    const fromMatches = matching.matchesIcrcAccount(tx.from, config.wallet.principal);
    const toMatches = matching.matchesIcrcAccount(tx.to, config.wallet.principal);

    if (fromMatches && toMatches) {
      direction = "self";
    } else if (toMatches) {
      direction = "inflow";
    } else if (fromMatches) {
      direction = "outflow";
    }

    if (!direction) return null;

    return {
      date_iso: utils.toISO(tx.timestamp),
      token: tx.symbol || "TOKEN",
      direction,
      amount: utils.formatAmount(String(tx.amount ?? "0"), tx.decimals ?? 8),
      from_principal: tx.from?.owner || "",
      to_principal: tx.to?.owner || "",
      block_index: String(tx.id),
      memo: (tx.memo_hex || "").toLowerCase(),
    };
  },
};

// ==================== Sanity Checks ====================

const sanityChecks = {
  /**
   * Check a specific ICRC transaction
   */
  checkIcrcTransaction: async (
    tokenName: string,
    ledger: string,
    index: bigint,
    expectedDecimals: number
  ) => {
    console.log(`\n[Sanity] ${tokenName} @ ${ledger} index=${index}`);

    const block = await icrcTransactions.getBlockByIndex(ledger, index);
    if (!block?.tx) {
      console.log("  -> Not found via Dashboard ICRC API; Rosetta not configured or also failed.");
      return;
    }

    const tx = block.tx;
    const fromMatches = matching.matchesIcrcAccount(
      tx.from,
      config.wallet.principal,
      config.wallet.subaccountHex
    );
    const toMatches = matching.matchesIcrcAccount(
      tx.to,
      config.wallet.principal,
      config.wallet.subaccountHex
    );

    let direction = "none";
    if (fromMatches && toMatches) direction = "self";
    else if (toMatches) direction = "inflow";
    else if (fromMatches) direction = "outflow";
    else direction = "mint";

    console.log(`  Block ts: ${utils.toISO(tx.timestamp)}`);
    console.log(`  From: ${tx.from?.owner || "-"} / sub=${tx.from?.subaccount || "(default)"}`);
    console.log(`  To  : ${tx.to?.owner || "-"} / sub=${tx.to?.subaccount || "(default)"}`);
    console.log(
      `  Amount: ${utils.formatAmount(String(tx.amount ?? "0"), expectedDecimals)} ${tx.symbol || tokenName}`
    );
    console.log(`  Would emit? ${direction}`);
  },

  /**
   * Check a specific ICP transaction
   */
  checkIcpTransaction: async (index: bigint) => {
    console.log(`\n[Sanity] ICP @ ${config.ledgers.ICP} index=${index}`);

    const block = await blockFetching.getIcpBlockByIndex(index);
    if (!block) {
      console.log("  -> Not found via Rosetta API.");
      return;
    }

    const operation = (block.op || "").toLowerCase();
    if (operation !== "transfer") {
      console.log(`  Block ts: ${utils.toISO(block.timestamp)} | op=${block.op}`);
      console.log("  Would emit? (non-transfer) mint/burn depends on op.");
      return;
    }

    const fromHex = (block.from_hex || "").toLowerCase();
    const toHex = (block.to_hex || "").toLowerCase();
    const accountIdHex = config.wallet.accountIdHex.toLowerCase();

    let direction = "none";
    if (fromHex === accountIdHex && toHex === accountIdHex) direction = "self";
    else if (toHex === accountIdHex) direction = "inflow";
    else if (fromHex === accountIdHex) direction = "outflow";
    else direction = "burn";

    console.log(`  Block ts: ${utils.toISO(block.timestamp)}`);
    console.log(`  From: ${fromHex || "-"}`);
    console.log(`  To  : ${toHex || "-"}`);
    console.log(`  Amount: ${utils.formatAmount(String(block.amount_e8s ?? "0"), 8)} ICP`);
    console.log(`  Would emit? ${direction}`);
  },

  /**
   * Run all sanity checks
   */
  runAll: async () => {
    console.log("=== Sanity Check: Known Transactions ===");
    console.log(
      `Date window: ${config.scanning.startDate.toISOString()} .. ${config.scanning.endDate.toISOString()}`
    );
    console.log(`Wallet: ${config.wallet.principal}`);
    console.log(
      `STRICT_SUBACCOUNT_MATCH: ${config.scanning.strictSubaccountMatch ? "1 (exact)" : "0 (owner-only)"}`
    );

    await sanityChecks.checkIcrcTransaction(
      "ckBTC",
      config.ledgers.ckBTC,
      config.verifyIndices.ckBTC,
      8
    );
    await sanityChecks.checkIcrcTransaction(
      "ckUSDC",
      config.ledgers.ckUSDC,
      config.verifyIndices.ckUSDC,
      6
    );
    await sanityChecks.checkIcpTransaction(config.verifyIndices.ICP);

    console.log("=== End Sanity Check ===\n");
  },
};

// ==================== Main Scanner ====================

const scanner = {
  /**
   * Scan ICP transactions
   */
  scanIcp: async (): Promise<number> => {
    console.log(`Scanning ICP for ${config.wallet.accountIdHex} ...`);

    let transactions: IcpTx[] = [];
    const fromISO = config.scanning.startDate.toISOString();
    const toISO = config.scanning.endDate.toISOString();

    // Try Rosetta first if available
    if (endpoints.rosetta.icp) {
      try {
        console.log(`  Trying Rosetta API first...`);
        transactions = await icpTransactions.fetchViaRosetta(
          config.wallet.accountIdHex,
          fromISO,
          toISO,
          config.scanning.pageSize
        );
        console.log(`  -> Rosetta returned ${transactions.length} transactions`);
      } catch (error) {
        console.log(`  Rosetta failed, falling back to Dashboard API...\n${error}`);
      }
    }

    // If Rosetta failed or returned nothing, try Dashboard API
    if (transactions.length === 0) {
      console.log(`  Using Dashboard API...`);

      // Quick smoke test
      try {
        const smokeInbound = await http.getJsonFromBases<any>("/v2/transactions", {
          sort_by: "-block_height",
          limit: 1,
          to_account: config.wallet.accountIdHex,
        });
        const smokeOutbound = await http.getJsonFromBases<any>("/v2/transactions", {
          sort_by: "-block_height",
          limit: 1,
          from_account: config.wallet.accountIdHex,
        });

        const hasInbound = (smokeInbound?.blocks ?? smokeInbound?.data ?? []).length > 0;
        const hasOutbound = (smokeOutbound?.blocks ?? smokeOutbound?.data ?? []).length > 0;
        console.log(
          `  Smoke test: has ANY ICP txs? inbound=${hasInbound}, outbound=${hasOutbound}`
        );
      } catch (error) {
        console.log(`  Smoke test failed:`, error);
      }

      transactions = await icpTransactions.fetchByAccount(
        config.wallet.accountIdHex,
        fromISO,
        toISO,
        config.scanning.pageSize
      );

      if (transactions.length === 0) {
        console.log(`  Account-scoped returned 0, trying global fallback...`);
        transactions = await icpTransactions.fetchGlobalFallback(
          config.wallet.accountIdHex,
          fromISO,
          toISO,
          config.scanning.pageSize
        );
      }
    }

    // Convert to CSV and write
    let count = 0;
    for (const tx of transactions) {
      const row = csvMapping.fromIcpTransaction(tx);
      if (row) {
        csv.appendRow(config.output.csvPath, row);
        count++;
      }
    }

    console.log(`  -> appended ${count} ICP rows\n`);
    return count;
  },

  /**
   * Scan ICRC token transactions
   */
  scanIcrcToken: async (name: string, ledger: string): Promise<number> => {
    console.log(`Scanning ${name} via ICRC API @ ${ledger} for ${config.wallet.principal} ...`);

    const transactions = await icrcTransactions.fetchByAccount(
      ledger,
      config.wallet.principal,
      config.wallet.subaccountHex,
      config.scanning.startDate.toISOString(),
      config.scanning.endDate.toISOString(),
      config.scanning.pageSize
    );

    let count = 0;
    for (const tx of transactions) {
      if (!matching.passesStrictSubaccountFilter(tx, config.wallet.subaccountHex)) continue;

      const row = csvMapping.fromIcrcTransaction(tx);
      if (row) {
        csv.appendRow(config.output.csvPath, row);
        count++;
      }
    }

    console.log(`  -> appended ${count} ${name} rows\n`);
    return count;
  },

  /**
   * Run the complete scan
   */
  run: async () => {
    console.log("ICP Transaction Scanner");
    console.log("=======================");
    console.log(`Wallet Principal: ${config.wallet.principal}`);
    console.log(`ICP Account ID:  ${config.wallet.accountIdHex}`);
    console.log(
      `Date window:     ${config.scanning.startDate.toISOString()} .. ${config.scanning.endDate.toISOString()}`
    );
    console.log(`Strict Subaccount: ${config.scanning.strictSubaccountMatch ? "Yes" : "No"}`);
    console.log("");

    // Note about account ID verification
    console.log("Note: To verify ICP_ACCOUNT_ID_HEX matches your principal, run:");
    console.log(`  dfx ledger account-id --of-principal ${config.wallet.principal}`);
    console.log("");

    // Run sanity checks
    await sanityChecks.runAll();

    // Initialize CSV
    csv.ensureHeader(config.output.csvPath);
    console.log(`CSV file: ${config.output.csvPath} (appending rows as they're found)\n`);

    // Run parallel scans
    const tasks = Object.entries(config.ledgers).map(async ([name, ledger]) => {
      try {
        if (name === "ICP") {
          return await scanner.scanIcp();
        } else {
          return await scanner.scanIcrcToken(name, ledger);
        }
      } catch (error) {
        console.error(`  Error scanning ${name}:`, error, "\n");
        return 0;
      }
    });

    const counts = await Promise.all(tasks);
    const total = counts.reduce((a, b) => a + b, 0);

    console.log(`✅ Scan complete. Appended ${total} rows to ${config.output.csvPath}`);
  },
};

// ==================== Entry Point ====================

if (require.main === module) {
  scanner.run().catch((error) => {
    console.error("Scanner failed:", error);
    process.exit(1);
  });
}
