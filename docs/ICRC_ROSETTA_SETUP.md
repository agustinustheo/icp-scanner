# ICRC Rosetta Setup Guide

## Overview

The Rosetta flow retriever script supports querying transactions for ICRC tokens (ckBTC, ckUSDC, ckUSDT) using the public ICRC Rosetta API endpoint.

## Public Endpoint

A public ICRC Rosetta API is available at:

```
https://icrc-api.internetcomputer.org/api/v1
```

This endpoint supports all ICRC tokens by using different network identifiers (canister IDs) in your requests. The script is pre-configured to use this endpoint, so no additional setup is required for basic usage.

## Self-Hosted Alternative

If you prefer to run your own ICRC Rosetta instance (for better performance, reliability, or offline usage), you can deploy one yourself. Each ICRC token ledger requires its own Rosetta instance.

## Setup Instructions

### 1. Clone the IC Repository

```bash
git clone https://github.com/dfinity/ic.git
cd ic/rs/rosetta-api/icrc1/rosetta
```

### 2. Build ICRC Rosetta

```bash
cargo build --release
```

### 3. Run Rosetta Instances

You need to run separate instances for each token:

#### ckBTC Rosetta (Port 8082)

```bash
./target/release/ic-icrc-rosetta-api \
  --network-url https://ic0.app \
  --ledger-id mxzaz-hqaaa-aaaar-qaada-cai \
  --port 8082
```

#### ckUSDC Rosetta (Port 8083)

```bash
./target/release/ic-icrc-rosetta-api \
  --network-url https://ic0.app \
  --ledger-id xevnm-gaaaa-aaaar-qafnq-cai \
  --port 8083
```

#### ckUSDT Rosetta (Port 8084)

```bash
./target/release/ic-icrc-rosetta-api \
  --network-url https://ic0.app \
  --ledger-id cngnf-vqaaa-aaaar-qag4q-cai \
  --port 8084
```

### 4. Configure Environment Variables

If running self-hosted instances, update your `.env` file:

```env
# ICP Rosetta API (public endpoint)
ICP_ROSETTA_URL=https://rosetta-api.internetcomputer.org

# ICRC Token Rosetta Endpoints (self-hosted local instances)
CKBTC_ROSETTA_URL=http://localhost:8082
CKUSDC_ROSETTA_URL=http://localhost:8083
CKUSDT_ROSETTA_URL=http://localhost:8084
```

Otherwise, the script will use the public endpoint by default:

```env
# Public endpoints (default - no configuration needed)
ICP_ROSETTA_URL=https://rosetta-api.internetcomputer.org
CKBTC_ROSETTA_URL=https://icrc-api.internetcomputer.org/api/v1
CKUSDC_ROSETTA_URL=https://icrc-api.internetcomputer.org/api/v1
CKUSDT_ROSETTA_URL=https://icrc-api.internetcomputer.org/api/v1
```

### 5. Run the Script

```bash
npm run rosetta-flow
```

## Token Canister IDs

For reference, here are the canister IDs for each ICRC token:

- **ckBTC**: `mxzaz-hqaaa-aaaar-qaada-cai`
- **ckUSDC**: `xevnm-gaaaa-aaaar-qafnq-cai`
- **ckUSDT**: `cngnf-vqaaa-aaaar-qag4q-cai`

## Using Docker (Alternative)

You can also run ICRC Rosetta in Docker containers:

```bash
# ckBTC
docker run -d \
  --name icrc-rosetta-ckbtc \
  -p 8082:8080 \
  dfinity/ic-icrc-rosetta-api:latest \
  --network-url https://ic0.app \
  --ledger-id mxzaz-hqaaa-aaaar-qaada-cai

# ckUSDC
docker run -d \
  --name icrc-rosetta-ckusdc \
  -p 8083:8080 \
  dfinity/ic-icrc-rosetta-api:latest \
  --network-url https://ic0.app \
  --ledger-id xevnm-gaaaa-aaaar-qafnq-cai

# ckUSDT
docker run -d \
  --name icrc-rosetta-ckusdt \
  -p 8084:8080 \
  dfinity/ic-icrc-rosetta-api:latest \
  --network-url https://ic0.app \
  --ledger-id cngnf-vqaaa-aaaar-qag4q-cai
```

## Default Behavior

The script now queries both ICP and ICRC tokens by default using public endpoints:

- **ICP**: Uses `https://rosetta-api.internetcomputer.org`
- **ICRC tokens (ckBTC, ckUSDC, ckUSDT)**: Uses `https://icrc-api.internetcomputer.org/api/v1`

No additional configuration is required. Simply run:

```bash
npm run rosetta-flow
```

## Resources

- [ICRC Rosetta Documentation](https://internetcomputer.org/docs/defi/rosetta/icrc_rosetta)
- [ICRC Rosetta GitHub](https://github.com/dfinity/ic/tree/master/rs/rosetta-api/icrc1/rosetta)
- [Rosetta API Standard](https://www.rosetta-api.org/)

## Troubleshooting

### Connection Refused

If you get `ECONNREFUSED` errors:

1. Ensure the Rosetta instance is running on the correct port
2. Check firewall settings
3. Verify the port in `.env` matches your running instance

### Slow Initial Sync

ICRC Rosetta nodes need to sync with the ledger on first run. This can take time depending on:

- The size of the ledger
- Your network speed
- The number of transactions

Be patient during initial sync. Subsequent runs will be faster.

### Memory Issues

ICRC Rosetta can be memory-intensive for large ledgers. If you experience issues:

- Allocate more memory to the process
- Use a machine with adequate RAM (4GB+ recommended)
- Consider running instances on separate machines
