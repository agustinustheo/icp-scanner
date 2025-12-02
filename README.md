# ICP Transaction Scanner & Flow Analyzer

A comprehensive TypeScript toolkit for tracking and analyzing ICP blockchain transactions across multiple assets:

- ICP (native token)
- ckBTC (chain-key Bitcoin)
- ckUSDC (chain-key USD Coin)
- ckUSDT (chain-key Tether)

## Features

### Transaction Scanner

- Unified scanner for both ICP native ledger and ICRC-3 tokens
- Scans historical transactions with full archive support
- Tracks inflows, outflows, self-transfers, mints, and burns
- Exports all transactions to a single CSV file
- Progress tracking during long scans
- Configurable date window for filtering transactions (default: June 1, 2025 to now)
- Supports both principal and legacy account ID matching
- Safe environment variable handling with sensible defaults

### Rosetta Flow Retriever

- Query transaction flows using the Rosetta API
- Analyze multiple deposit addresses in batch
- Generate detailed transaction reports (JSON and CSV)
- **Counterparty Tracking**: Identify and analyze all addresses that interact with your accounts
- Aggregate transaction statistics by counterparty
- Support for ICP and ICRC tokens (ckBTC, ckUSDC, ckUSDT)

## Prerequisites

- Node.js (v16 or higher)
- pnpm (or npm/yarn)

## Installation

```bash
pnpm install
```

## Configuration

All environment variables have safe defaults, so you can run the scanner without any configuration. However, you can customize behavior with these variables:

### Required for Your Wallet

- `WALLET_PRINCIPAL`: Your ICP wallet principal (default: example principal)
- `ICP_ACCOUNT_ID_HEX`: Your ICP account ID in hex format (default: example account)

### Ledger Canister IDs (defaults to mainnet canisters)

- `ICP_LEDGER`: ICP ledger canister ID (default: `ryjl3-tyaaa-aaaaa-aaaba-cai`)
- `CKBTC_LEDGER`: ckBTC ledger canister ID (default: `mxzaz-hqaaa-aaaar-qaada-cai`)
- `CKUSDC_LEDGER`: ckUSDC ledger canister ID (default: `xevnm-gaaaa-aaaar-qafnq-cai`)
- `CKUSDT_LEDGER`: ckUSDT ledger canister ID (default: `cngnf-vqaaa-aaaar-qag4q-cai`)

### Scanning Parameters

- `START_DATE`: Start of time window to scan (default: `2025-06-01T00:00:00Z`)
- `END_DATE`: End of time window to scan (default: current time)
- `MAX_BLOCKS_PER_LEDGER`: Maximum blocks to scan per ledger (default: `1000000`)
- `PAGE`: Page size for block fetching (default: `1000`)
- `PROGRESS_EVERY`: Show progress every N pages (default: `50`)

### Output

- `IC_HOST`: IC network host (default: `https://ic0.app`)
- `OUT_CSV`: Output CSV filename (default: `flows.csv`)

## Usage

### Quick Start (with your wallet)

```bash
# Replace with your actual wallet principal and account ID
WALLET_PRINCIPAL="your-principal-here" \
ICP_ACCOUNT_ID_HEX="your-account-id-hex" \
pnpm start
```

### Build and Run

```bash
# Build the TypeScript
pnpm build

# Run with default settings
pnpm start

# Or run the compiled JS directly
node dist/scanner.js
```

### Example: Scan Specific Date Range

```bash
# Scan transactions between June 1 and September 30, 2025
START_DATE="2025-06-01T00:00:00Z" \
END_DATE="2025-09-30T23:59:59Z" \
WALLET_PRINCIPAL="your-principal" \
ICP_ACCOUNT_ID_HEX="your-account-id" \
pnpm start
```

### Example: Scan Recent Transactions Only

```bash
# Scan only last 10,000 blocks from June 2025 to now
START_DATE="2025-06-01T00:00:00Z" \
MAX_BLOCKS_PER_LEDGER=10000 \
WALLET_PRINCIPAL="your-principal" \
ICP_ACCOUNT_ID_HEX="your-account-id" \
pnpm start
```

### Example: Verbose Progress Output

```bash
# Show progress every 10 pages instead of every 50
PROGRESS_EVERY=10 \
WALLET_PRINCIPAL="your-principal" \
ICP_ACCOUNT_ID_HEX="your-account-id" \
pnpm start
```

### Development Commands

```bash
# Run linting
pnpm lint

# Format code
pnpm format

# Build without running
pnpm build

# Run all checks (lint, format, build)
pnpm check
```

## Rosetta Flow Retriever

The Rosetta Flow Retriever is a specialized tool for querying transaction flows using the Rosetta API with advanced counterparty tracking capabilities.

### Quick Start

```bash
# Run with default address file (new vault subaccounts)
pnpm flow

# Run with specific address files
pnpm flow:new-vault      # New vault subaccounts (25 addresses)
pnpm flow:new-custodian  # New custodian principal (1 address)
pnpm flow:old-vault      # Old vault subaccounts (44 addresses)
pnpm flow:old-custodian  # Old custodian address (1 address)

# Run all address files in sequence
pnpm flow:all

# Or use the shell script directly
./scripts/run-rosetta-flow.sh [address-file.json]
```

### Address Files Configuration

The Rosetta Flow Retriever supports multiple address files through JSON configuration:

#### Available Address Files

- **`addresses-new-vault-subaccounts.json`**: 25 deposit addresses from the new vault
- **`addresses-new-custodian.json`**: 1 new custodian principal address
- **`addresses-old-vault-subaccounts.json`**: 44 deposit addresses from the old vault
- **`addresses-old-custodian.json`**: 1 old custodian address

#### Creating Custom Address Files

Create your own address file with this format:

```json
[
  {
    "address": "313fbe9c45f1644076d3be1a2b83dc46...",
    "asset": "ICP",
    "originalAsset": "ICP"
  },
  {
    "address": "g5nrt-myaaa-aaaap-qhluq-cai-yyuo52q.1e",
    "asset": "CKUSDT",
    "originalAsset": "CKUSDT_ICP"
  }
]
```

### Counterparty Tracking

The Rosetta Flow Retriever includes comprehensive counterparty tracking that identifies and analyzes all addresses interacting with your accounts.

#### Output Files

The script generates three output files:

1. **`rosetta-flows-{timestamp}.json`**: Complete transaction data with embedded counterparty information
2. **`rosetta-flows-{timestamp}.csv`**: Detailed transaction-by-transaction breakdown
3. **`rosetta-counterparties-{timestamp}.csv`**: Aggregated statistics for each counterparty

#### Counterparty Analysis CSV Format

```csv
DepositAddress,Asset,CounterpartyAddress,TotalReceived,TotalSent,NetFlow,TransactionCount
313fbe9c...,ICP,def456...,500.25,200.10,300.15,12
```

#### Using Counterparty Data

```bash
# Find top senders
sort -t, -k4 -rn rosetta-counterparties-*.csv | head -20

# Find top recipients
sort -t, -k5 -rn rosetta-counterparties-*.csv | head -20

# Find most frequent trading partners
sort -t, -k7 -rn rosetta-counterparties-*.csv | head -20
```

#### Advanced Counterparty Analysis

**Import into Spreadsheet:**

- Excel, Google Sheets, or other tools for pivot tables and charts
- Custom filtering and sorting
- Financial reconciliation

**Query with SQL:**

```bash
# Install csvkit
pip install csvkit

# Convert to SQLite database
csvsql --db sqlite:///flows.db --insert rosetta-counterparties-*.csv

# Query with SQL
sqlite3 flows.db "SELECT CounterpartyAddress, SUM(TransactionCount) as Total
                  FROM flows GROUP BY CounterpartyAddress
                  ORDER BY Total DESC LIMIT 10"
```

**Python Analysis:**

```python
import pandas as pd

# Load counterparty data
df = pd.read_csv('rosetta-counterparties-*.csv')

# Get top 10 counterparties by net flow
top_counterparties = df.groupby('CounterpartyAddress')['NetFlow'].sum().sort_values(ascending=False).head(10)

# Get most active counterparties
most_active = df.groupby('CounterpartyAddress')['TransactionCount'].sum().sort_values(ascending=False).head(10)
```

#### Understanding Counterparties

**For Received Transactions (Type: RECEIVE):**

- **Counterparty** = The sender who sent tokens to your deposit address
- **Amount** = Positive value (what you received)

**For Sent Transactions (Type: SEND):**

- **Counterparty** = The recipient who received tokens from your deposit address
- **Amount** = Negative value (what you sent)

### Address File Usage

The Rosetta Flow Retriever supports running with different address file sets:

```bash
# Using pnpm scripts (recommended)
pnpm flow                    # Uses new vault by default
pnpm flow:new-vault          # New vault subaccounts
pnpm flow:new-custodian      # New custodian principal
pnpm flow:old-vault          # Old vault subaccounts
pnpm flow:old-custodian      # Old custodian address
pnpm flow:all                # Run all address files in sequence

# Using the shell script directly
./scripts/run-rosetta-flow.sh addresses-new-vault-subaccounts.json
./scripts/run-rosetta-flow.sh addresses-new-custodian.json
./scripts/run-rosetta-flow.sh addresses-old-vault-subaccounts.json
./scripts/run-rosetta-flow.sh addresses-old-custodian.json

# Show help
./scripts/run-rosetta-flow.sh --help

# Using tsx directly
npx tsx src/scripts/rosetta-flow-retriever.ts addresses-custom.json
```

**Address File Fields:**

- **address**: The actual blockchain address (hex for ICP, principal.subaccount for ICRC)
- **asset**: The token type (`ICP`, `CKBTC`, `CKUSDC`, `CKUSDT`)
- **originalAsset**: The original asset name from your system (used for tracking/reference)

**Supported Address Formats:**

1. **Account IDs** (64-character hex): `313fbe9c45f1644076d3be1a2b83dc46...`
2. **Principal IDs**: `qvn3w-rqaaa-aaaam-qd4kq-cai`
3. **Principal + Subaccount**: `g5nrt-myaaa-aaaap-qhluq-cai-yyuo52q.1e`

### API Endpoints

The Rosetta Flow Retriever uses public endpoints by default:

- **ICP**: `https://rosetta-api.internetcomputer.org`
- **ICRC Tokens**: `https://icrc-api.internetcomputer.org/api/v1`

No configuration required - all endpoints are publicly accessible!

#### What Changed (Public API Update)

The project now uses the **public ICRC Rosetta API** endpoint, eliminating the need for self-hosted ICRC Rosetta instances.

**Before:**

- ❌ ICRC tokens (ckBTC, ckUSDC, ckUSDT) required self-hosted Rosetta instances
- ❌ Users had to run Docker containers or build from source
- ❌ Empty endpoint URLs caused ICRC queries to be skipped by default

**After:**

- ✅ Public ICRC Rosetta API endpoint available
- ✅ All ICRC tokens work out of the box with no additional setup
- ✅ Script now queries ICP and all ICRC tokens by default

**Self-Hosted Alternative:**
If you still want to run your own ICRC Rosetta instance (for performance, privacy, or offline usage), you can override the default URLs in your `.env` file. See [ICRC_ROSETTA_SETUP.md](docs/ICRC_ROSETTA_SETUP.md) for instructions.

## Output

The scanner generates a CSV file with the following columns:

- `date_iso`: Transaction timestamp in ISO format
- `token`: Token symbol (ICP, ckBTC, ckUSDC, ckUSDT)
- `direction`: Transaction type (inflow, outflow, self, mint, burn)
- `amount`: Formatted amount with proper decimals
- `from_principal`: Sender's principal ID (for ICRC) or account ID (for ICP)
- `from_subaccount`: Sender's subaccount in hex format (empty for default subaccount, blank for ICP)
- `to_principal`: Recipient's principal ID (for ICRC) or account ID (for ICP)
- `to_subaccount`: Recipient's subaccount in hex format (empty for default subaccount, blank for ICP)
- `block_index`: Block number
- `memo`: Transaction memo in hex format

### Example CSV Output

```csv
date_iso,token,direction,amount,from_principal,from_subaccount,to_principal,to_subaccount,block_index,memo
2025-07-23T07:55:03.000Z,ICP,outflow,0.0171,e71fb5d09ec4082185c469d95ea1628e1fd5a6b3302cc7ed001df577995e9297,,8585fdac56c2733021c57ae9cab6fb57bd67edc6ceb75dc3f75116e8031bc1f5,,25906544,
2025-07-17T05:26:17.000Z,ICP,outflow,0.02,e71fb5d09ec4082185c469d95ea1628e1fd5a6b3302cc7ed001df577995e9297,,ac801181c724872270475e1ab0d74fda7b60cc0163534f95512cc3a4f9a0880d,,25719349,
2025-07-14T23:27:19.000Z,ICP,inflow,0.3709,8b57f932fa624a9214afc2e2fda6e3d4bbc77cafec755249cb4279eee7089b70,,e71fb5d09ec4082185c469d95ea1628e1fd5a6b3302cc7ed001df577995e9297,,25652617,
2025-07-23T08:04:18.852Z,ckBTC,outflow,0.000001,ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe,,g5nrt-myaaa-aaaap-qhluq-cai-tewwnyq.39,0x0000000000000000000000000000000000000000000000000000000000000027,2821412,
2025-07-17T04:18:05.333Z,ckBTC,outflow,0.000001,ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe,,g5nrt-myaaa-aaaap-qhluq-cai-tzakf6y.35,0x0000000000000000000000000000000000000000000000000000000000000023,2783712,
2025-07-15T04:19:27.155Z,ckBTC,outflow,0.0000031,ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe,,uiz2m-baaaa-aaaal-qjbxq-cai-jr377uq.109,0x000000000000000000000000000000000000000000000000000000000000006d,2767933,
2025-07-14T23:26:39.567Z,ckBTC,inflow,0.00002191,6izkb-536f7-eib6o-anvgi-ob4rq-httn6-cqfqr-7yxg2-kxupl-sgar2-qqe,,ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe,,2766063,
2025-07-23T07:16:00.486Z,ckUSDC,outflow,0.1,ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe,,g5nrt-myaaa-aaaap-qhluq-cai-5yvfm5a.38,0x0000000000000000000000000000000000000000000000000000000000000026,408821,
2025-07-16T10:35:20.174Z,ckUSDC,outflow,0.1,ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe,,uiz2m-baaaa-aaaal-qjbxq-cai-3teoeqy.98,0x0000000000000000000000000000000000000000000000000000000000000062,402083,
2025-07-14T23:25:37.718Z,ckUSDC,inflow,3.027622,6izkb-536f7-eib6o-anvgi-ob4rq-httn6-cqfqr-7yxg2-kxupl-sgar2-qqe,,ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe,,400920,
2025-07-23T07:43:04.183Z,ckUSDT,outflow,0.1,ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe,,g5nrt-myaaa-aaaap-qhluq-cai-bgjhw4y.40,0x0000000000000000000000000000000000000000000000000000000000000028,585442,
2025-07-14T23:27:00.444Z,ckUSDT,inflow,3.026306,6izkb-536f7-eib6o-anvgi-ob4rq-httn6-cqfqr-7yxg2-kxupl-sgar2-qqe,,ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe,,554863,
```

### Notes on Subaccounts

- **ICRC tokens** (ckBTC, ckUSDC, ckUSDT):
  - `from_principal` and `to_principal` now show human-readable ICRC account format: `<principal>-<tag>.<subaccount>`
  - Subaccount suffixes are shown as decimal numbers for small values (e.g., `.26` for subaccount 26)
  - Large subaccounts are shown in hex format (e.g., `.0xfedcba0987654321`)
  - Default subaccounts (all zeros) are omitted from the principal text
  - Raw hex subaccounts are still available in `from_subaccount` and `to_subaccount` columns
- **ICP transactions**:
  - Shows 64-character hex account identifiers in both principal columns
  - Subaccount fields are always empty because the ICP ledger API only provides account ID hashes
  - These account IDs are one-way hashes of the principal and subaccount, so the original subaccount cannot be recovered

## Technical Details

The scanner implements multiple APIs for comprehensive transaction tracking:

- **ICP Native Token**: Uses Rosetta API as primary method with Dashboard API fallback
- **ICRC Tokens**: Uses ICRC-3 block log standard for ckBTC, ckUSDC, and ckUSDT
- **Archive Support**: Full support for historical data through archive canisters
- **Date Filtering**: Efficiently filters transactions within specified date ranges

## Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant Scanner
    participant CSV
    participant Rosetta API
    participant Dashboard API
    participant ICRC-3 API
    participant Archive

    User->>Scanner: Start scan with config
    Scanner->>Scanner: Load environment variables
    Scanner->>Scanner: Initialize CSV writer

    %% ICP Scanning
    Scanner->>Scanner: Start ICP scan
    Scanner->>Rosetta API: POST /account/transactions
    alt Rosetta Success
        Rosetta API-->>Scanner: Return transactions
        Scanner->>CSV: Write ICP transactions
    else Rosetta Fails (422/404)
        Scanner->>Dashboard API: GET /v2/accounts/{account}/transactions
        alt v2 API Success
            Dashboard API-->>Scanner: Return transactions
            Scanner->>CSV: Write ICP transactions
        else v2 API Fails
            Scanner->>Dashboard API: GET /v1/accounts/{account}/transactions
            Dashboard API-->>Scanner: Return transactions
            Scanner->>CSV: Write ICP transactions
        end
    end

    %% ICRC Token Scanning
    loop For each ICRC token (ckBTC, ckUSDC, ckUSDT)
        Scanner->>Scanner: Start token scan
        Scanner->>ICRC-3 API: icrc3_get_blocks({start, length})
        alt Blocks in main canister
            ICRC-3 API-->>Scanner: Return blocks
        else Blocks archived
            ICRC-3 API-->>Scanner: Return archive info
            Scanner->>Archive: get_blocks({start, length})
            Archive-->>Scanner: Return archived blocks
        end
        Scanner->>Scanner: Parse and filter transactions
        Scanner->>CSV: Write token transactions
    end

    Scanner->>Scanner: Close CSV writer
    Scanner->>User: Display summary and statistics
```

### API Flow Details

1. **ICP Token Scanning**:
   - Primary: Rosetta API for standardized blockchain data
   - Fallback 1: Dashboard API v2 (newer format)
   - Fallback 2: Dashboard API v1 (legacy format)

2. **ICRC Token Scanning**:
   - Uses ICRC-3 standard `icrc3_get_blocks` method
   - Automatically handles archive canister redirects
   - Parses generic Value types for transaction data

3. **Transaction Processing**:
   - Filters by date range (START_DATE to END_DATE)
   - Matches principal or account ID (with optional subaccount)
   - Categorizes as inflow, outflow, self, mint, or burn
   - Formats amounts with proper decimals

## Features Detail

### Multi-API Support

The scanner implements a robust fallback system to ensure maximum compatibility:

- Rosetta API: Industry-standard blockchain API used by many exchanges
- Dashboard APIs: ICP-specific APIs with different response formats
- ICRC-3: Standard interface for token transaction history

### Transaction Classification

- **Inflow**: Tokens received by your wallet
- **Outflow**: Tokens sent from your wallet
- **Self**: Transfers between your own subaccounts
- **Mint**: Token creation events (from minting account)
- **Burn**: Token destruction events (to minting account)

## Scanner Summary

This scanner provides a unified interface for tracking token flows across the ICP ecosystem:

- **ICP Native Token**: Uses Rosetta API (primary) or Dashboard API (fallback)
- **Chain-key Tokens**: Uses ICRC-3 standard for ckBTC, ckUSDC, and ckUSDT
- **Unified Output**: All transactions exported to a single CSV file
- **Performance**: Efficient parallel fetching and streaming CSV writes
- **Reliability**: Multiple API fallbacks ensure maximum uptime

The scanner automatically handles API differences, archive redirects, and various response formats to provide a seamless experience for tracking your ICP ecosystem transactions.

## Transaction Flow Analysis

When you are finished, you can use the CSV to make a cool flow chart like the following:

### Wallet Flow Chart

```mermaid
flowchart LR
    A["e71fb5d...9297"]
    B["8585fdac...1f5<br/>+0.0511 ICP"]
    C["ac801181...880d<br/>+0.04 ICP"]
    D["73bb002a...44eb<br/>+0.12 ICP"]
    E["8b57f932...9b70<br/>+0.2424 ICP"]
    F["ijsei-nrxkc...aqe<br/>+0.00001081 ckBTC<br/>+10.664462 ckUSDC<br/>+2.295287 ckUSDT"]
    G["g5nrt-myaaa...39<br/>+0.000001 ckBTC"]
    H["g5nrt-myaaa...35<br/>+0.000001 ckBTC"]
    I["uiz2m-baaaa...109<br/>+0.0000101 ckBTC"]
    J["6izkb-536f7...qqe"]
    K["g5nrt-myaaa...38<br/>+0.1 ckUSDC"]
    L["g5nrt-myaaa...36<br/>+0.3 ckUSDC"]
    M["g5nrt-myaaa...34<br/>+0.6 ckUSDC"]
    N["uiz2m-baaaa...98<br/>+11.9 ckUSDC<br/>+0.85 ckUSDT"]
    O["gf3g2-eaeha...qqe<br/>+0.5 ckUSDC"]
    P["g5nrt-myaaa...40<br/>+0.1 ckUSDT"]
    Q["uiz2m-baaaa...103<br/>+0.85 ckUSDT"]
    R["uiz2m-baaaa...99<br/>+1 ckUSDT"]

    %% ICP flows
    A -- "ICP 0.0511" --> B
    A -- "ICP 0.04" --> C
    A -- "ICP 0.12" --> D
    E -- "ICP 0.2425" --> A

    %% ckBTC flows
    F -- "ckBTC 0.000001" --> G
    F -- "ckBTC 0.000001" --> H
    F -- "ckBTC 0.0000101" --> I
    J -- "ckBTC 0.00002191" --> F

    %% ckUSDC flows
    J -- "ckUSDC 10.664462" --> F
    F -- "ckUSDC 0.1" --> K
    F -- "ckUSDC 0.3" --> L
    F -- "ckUSDC 0.6" --> M
    F -- "ckUSDC 11.9" --> N
    F -- "ckUSDC 0.5" --> O

    %% ckUSDT flows
    J -- "ckUSDT 2.676306" --> F
    F -- "ckUSDT 0.1" --> P
    F -- "ckUSDT 0.85" --> Q
    F -- "ckUSDT 1" --> R
```

### Final Wallet Balances (Positive Only)

**ICP Token:**

- `8585fdac56c2733021c57ae9cab6fb57bd67edc6ceb75dc3f75116e8031bc1f5`: **+0.0511 ICP**
- `ac801181c724872270475e1ab0d74fda7b60cc0163534f95512cc3a4f9a0880d`: **+0.04 ICP**
- `73bb002a5ca69d63e692d99383353082e591bacd439ef25eb22e8078904344eb`: **+0.12 ICP**
- `8b57f932fa624a9214afc2e2fda6e3d4bbc77cafec755249cb4279eee7089b70`: **+0.2424 ICP**

**ckBTC Token:**

- `ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe`: **+0.00001081 ckBTC**
- `g5nrt-myaaa-aaaap-qhluq-cai-tewwnyq.39`: **+0.000001 ckBTC**
- `g5nrt-myaaa-aaaap-qhluq-cai-tzakf6y.35`: **+0.000001 ckBTC**
- `uiz2m-baaaa-aaaal-qjbxq-cai-jr377uq.109`: **+0.0000101 ckBTC**

**ckUSDC Token:**

- `ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe`: **+10.664462 ckUSDC**
- `g5nrt-myaaa-aaaap-qhluq-cai-5yvfm5a.38`: **+0.1 ckUSDC**
- `g5nrt-myaaa-aaaap-qhluq-cai-aasdowa.36`: **+0.3 ckUSDC**
- `g5nrt-myaaa-aaaap-qhluq-cai-5fdze3i.34`: **+0.6 ckUSDC**
- `uiz2m-baaaa-aaaal-qjbxq-cai-3teoeqy.98`: **+11.9 ckUSDC**
- `gf3g2-eaeha-ii22q-ij5tb-bep3w-xxwgx-h4roh-6c2sm-cx2sw-tppv4-qqe`: **+0.5 ckUSDC**

**ckUSDT Token:**

- `ijsei-nrxkc-26l5m-cj5ki-tkdti-7befc-6lhjr-ofope-4szgt-hmnvc-aqe`: **+2.295287 ckUSDT**
- `g5nrt-myaaa-aaaap-qhluq-cai-bgjhw4y.40`: **+0.1 ckUSDT**
- `uiz2m-baaaa-aaaal-qjbxq-cai-vsrbnta.103`: **+0.85 ckUSDT**
- `uiz2m-baaaa-aaaal-qjbxq-cai-vph5fvi.99`: **+1 ckUSDT**
