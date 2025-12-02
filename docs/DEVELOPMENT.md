# ICP Flows - Development Documentation

This document contains technical reference information for developers working on the ICP Flows codebase.

## Table of Contents

- [Quick Reference](#quick-reference)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Key Utilities](#key-utilities)
- [Configuration System](#configuration-system)
- [Technical Details](#technical-details)
- [Known Issues & Fixes](#known-issues--fixes)

## Quick Reference

### Commands

```bash
pnpm start                              # Run scanner with defaults
pnpm verify                             # Verify holdings
pnpm build                              # Build TypeScript
pnpm dev                                # Run with ts-node (development)
pnpm lint                               # Check code quality
pnpm format                             # Format code
pnpm typecheck                          # Type checking only
pnpm check                              # Full check (lint+format+build)
./run.sh [BLOCKS]                       # Compile and run (e.g., ./run.sh 50000)

# Rosetta Flow Retriever
pnpm flow                    # Run with default address file
pnpm flow:new-vault          # New vault subaccounts
pnpm flow:new-custodian      # New custodian principal
pnpm flow:old-vault          # Old vault subaccounts
pnpm flow:old-custodian      # Old custodian address
pnpm flow:all                # Run all address files in sequence
```

### Configuration Quick Reference

| Variable                  | Default              | Description                 |
| ------------------------- | -------------------- | --------------------------- |
| `WALLET_PRINCIPAL`        | Example principal    | Your ICP wallet principal   |
| `ICP_ACCOUNT_ID_HEX`      | Example account      | Your ICP account ID (hex)   |
| `WALLET_SUBACCOUNT_HEX`   | Empty                | Optional subaccount         |
| `START_DATE`              | 2025-06-01T00:00:00Z | Start of scan window        |
| `END_DATE`                | Current time         | End of scan window          |
| `PAGE`                    | 1000                 | Page size (max 100)         |
| `STRICT_SUBACCOUNT_MATCH` | 0                    | 0=owner-only, 1=exact match |
| `OUT_CSV`                 | flows.csv            | Output filename             |

### Transaction Types

- `inflow` - Tokens received by wallet
- `outflow` - Tokens sent from wallet
- `self` - Transfer between own accounts/subaccounts
- `mint` - Token creation (from minting account)
- `burn` - Token destruction (to minting account)

## Project Structure

```
icp-flows/
├── src/
│   ├── scanner.ts                 # Main transaction scanner (1,298 lines)
│   ├── verify.ts                  # Balance verification tool (290 lines)
│   └── rosetta-flow-retriever.ts  # Rosetta API flow retriever
├── scripts/
│   ├── run.sh                     # Build and execution wrapper
│   └── run-rosetta-flow.sh        # Rosetta flow wrapper
├── docs/
│   ├── DEVELOPMENT.md             # This file
│   ├── ICRC_ROSETTA_SETUP.md     # ICRC Rosetta setup guide
│   └── [other docs]
├── output/                        # Generated reports directory
├── dist/                          # Compiled JavaScript output
├── package.json                   # NPM dependencies
├── tsconfig.json                  # TypeScript configuration
└── README.md                      # User documentation
```

### Main Components

#### scanner.ts

- **Purpose**: Main transaction scanner
- **Lines**: ~1,298
- **Features**:
  - Scans ICP + ckBTC + ckUSDC + ckUSDT
  - Multi-API fallback: Rosetta → Dashboard v2 → Dashboard v1 → Global fallback
  - Outputs CSV with complete transaction metadata

#### verify.ts

- **Purpose**: Balance verification tool
- **Lines**: ~290
- **Features**:
  - Checks live balances via Rosetta + ICRC API
  - Compares against expected totals
  - Per-address balance reporting

#### rosetta-flow-retriever.ts

- **Purpose**: Rosetta API transaction flow analysis
- **Features**:
  - Batch processing of multiple addresses
  - Counterparty tracking and analysis
  - JSON and CSV report generation

## API Endpoints

### ICP Transactions (Priority Order)

1. **Rosetta API**

   ```
   POST https://rosetta-api.internetcomputer.org/search/transactions
   ```

2. **Dashboard API v2** (cursor pagination)

   ```
   GET https://ledger-api.internetcomputer.org/api/v2/accounts/{hex}/transactions
   GET https://ledger-api.internetcomputer.org/api/v2/transactions?from_account={hex}
   ```

3. **Dashboard API v1** (offset pagination)
   ```
   GET https://ledger-api.internetcomputer.org/api/v1/accounts/{hex}/transactions
   GET https://ledger-api.internetcomputer.org/api/v1/transactions?from_account={hex}
   ```

### ICRC Transactions

```
GET https://icrc-api.internetcomputer.org/api/v2/ledgers/{ledger}/transactions
```

Parameters:

- `limit`: 1-100 (paginated)
- `sort_by`: "-index" (newest first)
- `start`: epoch seconds (inclusive)
- `end`: epoch seconds (inclusive)
- `query`: principal to match
- `include_kind`: "transfer"
- `after`: cursor for pagination

### Ledger Canister IDs

- **ICP**: `ryjl3-tyaaa-aaaaa-aaaba-cai`
- **ckBTC**: `mxzaz-hqaaa-aaaar-qaada-cai`
- **ckUSDC**: `xevnm-gaaaa-aaaar-qafnq-cai`
- **ckUSDT**: `cngnf-vqaaa-aaaar-qag4q-cai`

## Key Utilities

### Conversion Functions

```typescript
formatAmount(raw, decimals); // Format amounts with decimals
toISO(timestamp); // Auto-detect & convert timestamps
icrcAccountText(owner, subaccount); // Readable ICRC account format
hexToBytes(hex); // Hex string to Uint8Array
```

### Processing Functions

```typescript
normalizeSubaccount(sub); // Normalize hex subaccounts
subaccountSuffix(subHex); // Decimal or hex suffix display
equalSubaccounts(a, b); // Compare subaccounts
matchesIcrcAccount(account, owner); // Check account match
```

### HTTP Utilities

```typescript
buildQueryString(params); // Build URL query strings
getJson<T>(url, params); // Fetch JSON with fallback
getJsonFromBases<T>(path, params); // Try multiple base URLs
postRosetta<T>(endpoint, body); // POST to Rosetta
```

## Configuration System

### Environment Variables

#### Wallet Configuration

- `WALLET_PRINCIPAL` - Principal ID (default: example)
- `ICP_ACCOUNT_ID_HEX` - Hex account ID (default: example)
- `WALLET_SUBACCOUNT_HEX` - Optional subaccount

#### Scanning Parameters

- `START_DATE` - Start of time window (default: 2025-06-01T00:00:00Z)
- `END_DATE` - End of time window (default: current time)
- `PAGE` - Page size for fetching (default: 1000, max: 100)
- `STRICT_SUBACCOUNT_MATCH` - 0=owner-only, 1=exact match (default: 0)
- `MAX_BLOCKS_PER_LEDGER` - Maximum blocks to scan (default: 1000000)
- `PROGRESS_EVERY` - Show progress every N pages (default: 50)

#### API Endpoints

- `ICP_ROSETTA_URL` - ICP Rosetta endpoint
- `ICRC_ROSETTA_URL` - Optional ICRC Rosetta endpoint
- `CKBTC_ROSETTA_URL` - ckBTC Rosetta endpoint
- `CKUSDC_ROSETTA_URL` - ckUSDC Rosetta endpoint
- `CKUSDT_ROSETTA_URL` - ckUSDT Rosetta endpoint

## Technical Details

### CSV Output Columns

| Column            | Description                                   |
| ----------------- | --------------------------------------------- |
| `date_iso`        | ISO 8601 timestamp                            |
| `token`           | ICP, ckBTC, ckUSDC, ckUSDT                    |
| `direction`       | inflow, outflow, self, mint, burn             |
| `amount`          | Formatted with decimal places                 |
| `from_principal`  | Sender principal/account (readable format)    |
| `from_subaccount` | Sender subaccount (0x hex or empty)           |
| `to_principal`    | Recipient principal/account (readable format) |
| `to_subaccount`   | Recipient subaccount (0x hex or empty)        |
| `block_index`     | Block/transaction number                      |
| `memo`            | Transaction memo (hex)                        |

### Smart Features

- ✅ Multi-API fallback with intelligent retry
- ✅ Automatic timestamp precision detection (ns/μs/ms/s)
- ✅ Smart subaccount display (decimal for small, hex for large)
- ✅ Dashboard-style ICRC account formatting (principal-tag.subaccount)
- ✅ Parallel token scanning (ICP + 3 ICRC tokens concurrently)
- ✅ Cursor-based pagination for efficient data retrieval
- ✅ Safe environment variables with sensible defaults
- ✅ Sanity checks for known transactions on startup
- ✅ Type-safe TypeScript with strict mode

### Data Types

#### ICP Transaction

```typescript
{
  block_height: string;
  block_hash: string;
  transaction_hash: string;
  transfer_type: "transfer" | "mint" | "burn" | "approve";
  amount: string;
  fee?: string;
  from_account_identifier?: string;
  to_account_identifier?: string;
  created_at: number;
  memo?: string;
}
```

#### ICRC Transaction

```typescript
{
  id: string;
  timestamp: string;
  op: string;
  from?: {
    owner: string;
    subaccount?: string;
  };
  to?: {
    owner: string;
    subaccount?: string;
  };
  amount?: string;
  symbol?: string;
  decimals?: number;
  memo_hex?: string;
}
```

## Known Issues & Fixes

### Counterparty Detection Fix

**Problem**: ICP transactions were showing "unknown" as counterparty address.

**Root Cause**: The Rosetta API uses different operation types:

- ICP Rosetta: Uses `"TRANSACTION"` as operation type
- ICRC Rosetta: Uses `"TRANSFER"` as operation type

**Fix**: Updated code to check for both operation types:

```typescript
// ICP uses "TRANSACTION" type, ICRC uses "TRANSFER" type
const isTransferOp = otherOp.type === "TRANSFER" || otherOp.type === "TRANSACTION";
```

### Notable Quirks

- ⚠️ **ICP subaccounts**: Not available in ledger responses (account ID is hash)
- ⚠️ **No built-in rate limiting**: Use 60ms sleep in verify.ts
- ⚠️ **Archive support is implicit**: API handles redirects
- ⚠️ **Date filtering is approximate**: Happens after fetch, not at API level

## Dependencies

### Runtime Dependencies

- `@dfinity/agent@3.2.6` - ICP agent for canister interactions
- `@dfinity/candid@3.2.6` - Candid type serialization
- `@dfinity/ledger-icrc@4.0.1` - ICRC ledger utilities
- `@dfinity/principal@3.2.6` - Principal type support
- Node.js built-in fetch API (Node 16+)

### Development Dependencies

- TypeScript, ESLint, Prettier
- Type definitions for Node.js

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "module": "commonjs",
    "target": "ES2020",
    "types": ["node"],
    "sourceMap": true,
    "declaration": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Testing & Verification

### Sanity Checks

The scanner performs sanity checks on startup with known transaction indices:

- `VERIFY_CKBTC_INDEX`: 2783712
- `VERIFY_CKUSDC_INDEX`: 408821
- `VERIFY_ICP_INDEX`: 25906544

### Verify Holdings

```bash
pnpm verify
```

This will check live balances against expected totals for all configured addresses.

## Performance Considerations

- **Rate Limiting**: 500ms delay between API calls in Rosetta flow retriever
- **Batch Processing**: Addresses grouped by asset type for efficiency
- **Memory Usage**: Large result sets streamed to files to avoid memory issues
- **Parallel Scanning**: ICP and ICRC tokens scanned concurrently

## Rosetta Flow Retriever (Comprehensive)

### Overview

The Rosetta Flow Retriever is a specialized script that queries transaction flows for deposit addresses using the ICP Rosetta API.

**Features:**

- Multi-asset support (ICP, ckBTC, ckUSDC, ckUSDT)
- Batch processing of multiple addresses grouped by asset type
- Flow analysis (total received, sent, net balances)
- Multiple output formats (JSON and CSV reports)
- Transaction visualization with top addresses by activity
- Built-in rate limiting (500ms between requests)

### Output Files

The script generates three output files in the `output/` directory:

1. **JSON Report** (`rosetta-flows-{timestamp}.json`):
   - Complete transaction data with metadata and summary
   - Embedded counterparty information
   - Transaction flows for each address

2. **CSV Report** (`rosetta-flows-{timestamp}.csv`):
   - Tabular format for spreadsheet analysis
   - Transaction-by-transaction breakdown
   - Columns: Address, Asset, Type, BlockHeight, TxHash, Counterparty, Amount, Fee

3. **Counterparty Analysis** (`rosetta-counterparties-{timestamp}.csv`):
   - Aggregated statistics for each counterparty
   - Columns: DepositAddress, Asset, CounterpartyAddress, TotalReceived, TotalSent, NetFlow, TransactionCount

### Customization

**Modifying Addresses:**

Edit the address file or create a custom one:

```json
[
  {
    "address": "your-address-here",
    "asset": "ICP",
    "originalAsset": "ICP"
  }
]
```

**Adjusting Rate Limits:**

Modify the delay in the main loop (default: 500ms):

```typescript
await new Promise((resolve) => setTimeout(resolve, 500));
```

**Transaction Limit:**

Adjust the limit parameter in `searchTransactions`:

```typescript
async function searchTransactions(
  address: string,
  asset: string,
  limit: number = 100 // Change default limit here
);
```

### Error Handling

- **404 Errors**: Addresses with no transactions are logged but don't stop execution
- **Network Errors**: Logged with details, processing continues for other addresses
- **Invalid Assets**: Unknown assets are skipped with a warning

### Troubleshooting

**No Transactions Found:**

1. Verify the address format is correct
2. Check if the address has activity on the specified network
3. Ensure the correct asset type is assigned to the address

**API Connection Issues:**

1. Check your internet connection
2. Verify the Rosetta endpoints are accessible
3. Try reducing the request rate (increase delay)
4. Check if the endpoints in `.env` are correct

**Memory Issues (for large datasets):**

1. Reduce the transaction limit per address
2. Process addresses in smaller batches
3. Increase Node.js memory: `node --max-old-space-size=4096`

## Codebase Architecture

### Environment Helpers

```typescript
// Safe environment variable reading with defaults
env.getString(name, defaultValue); // Read string
env.getNumber(name, defaultValue, min); // Read number with bounds
env.getDate(name, defaultISO); // Parse ISO date
env.getHex(name, defaultValue); // Normalize hex (0x prefix optional)
```

### Format & Conversion Utilities

```typescript
formatAmount(raw, decimals)          // Format with decimal places
toISO(timestamp)                     // Auto-detect precision & convert to ISO
normalizeSubaccount(sub?)            // Normalize hex subaccounts
hexToBytes(hex?)                     // Convert hex string to Uint8Array
subaccountSuffix(subHex?, maxBits=64) // Get decimal or hex suffix
icrcAccountText(owner?, subHex?)     // Build readable account string
subaccountForCsv(sub?)               // CSV-safe subaccount format
```

**Timestamp Handling:**

- Auto-detects precision (nanoseconds, microseconds, milliseconds, seconds)
- Handles ISO strings
- Converts to ISO 8601 format

**Subaccount Features:**

- Normalizes with 0x prefix handling
- Detects all-zero subaccounts
- Converts to decimal for display when < 2^64
- Uses DFINITY's encodeIcrcAccount for canonical format

### Transaction Processing

**CSV Output Format:**

```
date_iso                - ISO timestamp
token                   - Symbol (ICP, ckBTC, ckUSDC, ckUSDT)
direction               - inflow|outflow|self|mint|burn
amount                  - Formatted with decimals
from_principal          - Sender principal/account (readable format)
from_subaccount         - Sender subaccount (0x hex or empty)
to_principal            - Recipient principal/account (readable format)
to_subaccount           - Recipient subaccount (0x hex or empty)
block_index             - Transaction block/index number
memo                    - Transaction memo (hex)
```

**Transaction Classification:**

- **inflow**: Tokens received
- **outflow**: Tokens sent
- **self**: Transfer between own accounts
- **mint**: Token creation
- **burn**: Token destruction

### Account Matching Logic

```typescript
matchesIcrcAccount(account, walletOwner, walletSubHex?)  // Check ICRC account match
equalSubaccounts(a?, b?)                                 // Compare subaccounts
passesStrictSubaccountFilter(tx, walletSubHex?)          // Apply subaccount filter
```

**Modes:**

- **Owner-only** (default): Match principal only, ignore subaccount
- **Strict match**: Match both principal and subaccount exactly

## API Implementation Details

### ICP Ledger APIs

**Rosetta (Primary):**

- Base: `https://rosetta-api.internetcomputer.org`
- Methods:
  - `POST /search/transactions`
  - `POST /block`
  - `POST /account/balance`

**Dashboard API:**

- Bases:
  - `https://ledger-api.internetcomputer.org/api`
  - `https://ledger-api.internetcomputer.org`
- Methods:
  - `GET /v2/accounts/{hex}/transactions`
  - `GET /v2/transactions?from_account={hex}&to_account={hex}`
  - `GET /v1/accounts/{hex}/transactions`
  - `GET /v1/transactions?from_account={hex}`

### ICRC Ledger APIs

**ICRC API:**

- Base v1: `https://icrc-api.internetcomputer.org/api/v1`
- Base v2: `https://icrc-api.internetcomputer.org/api/v2`
- Methods:
  - `GET /ledgers/{ledger}/transactions` (v2, with cursor)
  - `GET /ledgers/{ledger}/transactions/{index}` (v1, get specific)
  - `GET /ledgers/{ledger}/accounts/{encoded_account}` (v1, balance)

**Rosetta (Optional):**

- Base: Configurable via `ICRC_ROSETTA_URL`
- Method: `POST /block`

### Multi-API Fallback Strategy

**ICP Transaction Fetching (Priority Order):**

1. **Rosetta API** - Industry-standard, most reliable
2. **Dashboard API v2** - Cursor-based pagination, modern format
3. **Dashboard API v1** - Offset-based pagination, legacy support
4. **Global Fallback** - Queries all transactions globally when account-scoped returns 0

**Response Normalization:**

- Handles multiple response shape variations
- Extracts: block_height, transaction_hash, amount, from/to addresses, timestamp, memo
- Converts timestamps from epoch seconds to ISO format

**Filtering:**

- Date range filtering (START_DATE to END_DATE)
- Account identifier matching
- Transaction type detection (transfer, mint, burn, approve)

### ICRC Token Fetching

**API Used:**

```
GET /api/v2/ledgers/{ledger}/transactions
Query parameters:
  - limit: 1-100 (paginated)
  - sort_by: "-index" (newest first)
  - start: epoch seconds (inclusive)
  - end: epoch seconds (inclusive)
  - query: principal to match
  - include_kind: "transfer"
  - after: cursor for pagination
```

**Transaction Extraction:**

- Parses owner + subaccount from from/to fields
- Supports both principal-only and principal.subaccount addresses
- Handles dashboard-style notation (e.g., "principal-tag.subaccount")
- Extracts amount, decimals, timestamp, memo

## Further Reading

- [ICRC Rosetta Setup Guide](./ICRC_ROSETTA_SETUP.md) - For running self-hosted ICRC Rosetta instances
- [ICP Rosetta API Documentation](https://internetcomputer.org/docs/defi/rosetta/)
- [ICRC Token Standards](https://github.com/dfinity/ICRC-1)
- [Internet Computer Documentation](https://internetcomputer.org/docs)
