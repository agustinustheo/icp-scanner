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
    echo "Creating .env file with default Rosetta endpoints..."
    cat > .env << EOF
# Rosetta API Endpoints
ICP_ROSETTA_URL=https://rosetta-api.internetcomputer.org
CKBTC_ROSETTA_URL=https://icrc-rosetta-api.internetcomputer.org
CKUSDC_ROSETTA_URL=https://icrc-rosetta-api.internetcomputer.org
CKUSDT_ROSETTA_URL=https://icrc-rosetta-api.internetcomputer.org

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