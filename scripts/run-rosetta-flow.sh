#!/bin/bash

# Rosetta Flow Retriever Run Script
# This script retrieves transaction flows using the Rosetta API

set -e

echo "======================================"
echo "ROSETTA TRANSACTION FLOW RETRIEVER"
echo "======================================"
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

npx tsx src/scripts/rosetta-flow-retriever.ts "$@"

echo ""
echo "Script completed successfully!"
echo "Check the output/ directory for results."