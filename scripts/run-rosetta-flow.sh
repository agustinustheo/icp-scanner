#!/bin/bash

# Rosetta Flow Retriever Run Script
# This script retrieves transaction flows using the Rosetta API
#
# Usage: ./run-rosetta-flow.sh [addresses-file.json]
#
# Examples:
#   ./run-rosetta-flow.sh addresses-old-vault-subaccounts.json
#   ./run-rosetta-flow.sh addresses-old-custodian.json

set -e

echo "======================================"
echo "ROSETTA TRANSACTION FLOW RETRIEVER"
echo "======================================"
echo ""

# Show help if requested
if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
    echo "Usage: ./run-rosetta-flow.sh [addresses-file.json]"
    echo ""
    echo "Arguments:"
    echo "  addresses-file.json   Path to JSON file with deposit addresses"
    echo "                        (default: addresses-old-vault-subaccounts.json)"
    echo ""
    echo "Available address files:"
    echo "  addresses-old-vault-subaccounts.json  - 44 addresses (36 ICP, 4 ckUSDC, 2 ckBTC, 2 ckUSDT)"
    echo "  addresses-old-custodian.json  - 1 address (ICP only)"
    echo ""
    echo "Examples:"
    echo "  ./run-rosetta-flow.sh addresses-old-vault-subaccounts.json"
    echo "  ./run-rosetta-flow.sh addresses-old-custodian.json"
    echo ""
    exit 0
fi

# Set default addresses file if not provided
ADDRESSES_FILE="${1:-addresses-old-vault-subaccounts.json}"

echo "Using addresses file: $ADDRESSES_FILE"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Creating .env file with Rosetta endpoints..."
    cat > .env << EOF
# Rosetta API Endpoints (all public)
ICP_ROSETTA_URL=https://rosetta-api.internetcomputer.org
CKBTC_ROSETTA_URL=https://icrc-api.internetcomputer.org/api/v1
CKUSDC_ROSETTA_URL=https://icrc-api.internetcomputer.org/api/v1
CKUSDT_ROSETTA_URL=https://icrc-api.internetcomputer.org/api/v1

# Optional: Add other configuration
# MAX_TRANSACTIONS_PER_ADDRESS=100
# OUTPUT_FORMAT=json,csv
EOF
    echo "Created .env file with default settings."
    echo ""
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

# Create output directory if it doesn't exist
mkdir -p output

# Run the TypeScript script directly with tsx
echo "Starting Rosetta transaction flow retrieval..."
echo ""

npx tsx src/rosetta-flow-retriever.ts "$ADDRESSES_FILE"

echo ""
echo "Script completed successfully!"
echo "Check the output/ directory for results."