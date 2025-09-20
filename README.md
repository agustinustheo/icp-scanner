# ICP Transaction Scanner

A unified TypeScript scanner for tracking ICP blockchain transactions across multiple assets:

- ICP (native token)
- ckBTC (chain-key Bitcoin)
- ckUSDC (chain-key USD Coin)
- ckUSDT (chain-key Tether)

## Features

- Unified scanner for both ICP native ledger and ICRC-3 tokens
- Scans historical transactions with archive support
- Tracks inflows, outflows, self-transfers, mints, and burns
- Exports all transactions to a single CSV file
- Configurable date cutoff (default: June 2025)
- Supports both principal and legacy account ID matching

## Prerequisites

- Node.js (v16 or higher)
- pnpm or npm

## Installation

```bash
pnpm install
```

## Configuration

The scanner uses environment variables for configuration:

- `WALLET_PRINCIPAL`: Your ICP wallet principal (default provided)
- `CKBTC_LEDGER`: ckBTC ledger canister ID
- `CKUSDC_LEDGER`: ckUSDC ledger canister ID
- `CKUSDT_LEDGER`: ckUSDT ledger canister ID
- `MAX_BLOCKS_PER_LEDGER`: Maximum blocks to scan per ledger (default: 1000)
- `IC_HOST`: IC network host (default: https://ic0.app)
- `OUT_CSV`: Output CSV filename (default: icrc3_flows.csv)

## Usage

### Test Run

Run a quick test with 50 blocks:

```bash
./test-scanner.sh
```

### Full Scan

Run with custom parameters:

```bash
MAX_BLOCKS_PER_LEDGER=5000 WALLET_PRINCIPAL=your-principal node dist/scan_transactions.js
```

### Compile Only

```bash
pnpm tsc scan_transactions.ts --noEmit false --outDir dist --target ES2020 --module commonjs
```

## Output

The scanner generates a CSV file with the following columns:

- `date_iso`: Transaction timestamp in ISO format
- `token`: Token symbol (ckBTC, ckUSDC, ckUSDT)
- `direction`: Transaction type (inflow, outflow, self, mint, burn)
- `amount`: Formatted amount with proper decimals
- `from_principal`: Sender's principal ID
- `to_principal`: Recipient's principal ID
- `block_index`: Block number
- `memo`: Transaction memo in hex format

## Technical Details

The scanner implements the ICRC-3 block log standard, which provides:

- Access to historical transaction blocks
- Support for archived blocks
- Generic Value type for flexible block data representation

## Scanner Summary

This scanner was created to help track token flows across the ICP ecosystem. It handles the different standards used by various ledgers:

- ICP uses the older `query_blocks` API with account identifiers
- Chain-key tokens (ckBTC, ckUSDC, ckUSDT) use the ICRC-3 standard

The scanner automatically routes to the appropriate method based on the token type and includes full archive support for historical data.
