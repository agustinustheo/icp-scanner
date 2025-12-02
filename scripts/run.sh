#!/bin/bash

echo "🚀 Unified ICP Transaction Scanner"
echo ""

# Compile
echo "🔧 Compiling TypeScript..."
pnpm tsc src/scanner.ts --noEmit false --outDir dist --target ES2020 --module commonjs

if [ $? -ne 0 ]; then
    echo "❌ Compilation failed"
    exit 1
fi

echo "✅ Compilation successful"
echo ""

# Run with configurable blocks
BLOCKS=${1:-100000}  # Default 100k blocks
echo "📊 Scanning up to $BLOCKS blocks per ledger..."
echo ""

MAX_BLOCKS_PER_LEDGER=$BLOCKS node dist/scanner.js

# Show results summary
if [ -f "flows.csv" ]; then
    echo ""
    LINES=$(wc -l < flows.csv)
    if [ "$LINES" -gt 1 ]; then
        echo "📄 Results summary:"
        echo "Total transactions: $((LINES - 1))"
        echo ""
        echo "Transaction breakdown by token:"
        tail -n +2 flows.csv | cut -d',' -f2 | tr -d '"' | sort | uniq -c | while read count token; do
            echo "  $token: $count transactions"
        done
    fi
fi