#!/usr/bin/env npx tsx
/**
 * Rosetta Transaction Flow Retriever
 *
 * This script retrieves transaction flows for specified deposit addresses
 * using the Rosetta API for ICP and ICRC tokens (ckBTC, ckUSDC, ckUSDT)
 */

import axios from "axios";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

// Types
interface DepositAddress {
  address: string;
  asset: string;
  originalAsset: string;
}

interface RosettaTransaction {
  block_identifier: {
    index: number;
    hash: string;
  };
  transaction: {
    transaction_identifier: {
      hash: string;
    };
    operations: Array<{
      operation_identifier: { index: number };
      type: string;
      status: string;
      account: {
        address: string;
        sub_account?: { address: string };
      };
      amount?: {
        value: string;
        currency: {
          symbol: string;
          decimals: number;
        };
      };
    }>;
    metadata?: unknown;
  };
}

interface TransactionFlow {
  address: string;
  asset: string;
  transactions: Array<{
    blockHeight: number;
    txHash: string;
    timestamp?: number;
    type: "SEND" | "RECEIVE";
    counterparty: string;
    counterpartySubaccount?: string;
    amount: string;
    fee?: string;
  }>;
  totalReceived: bigint;
  totalSent: bigint;
  netBalance: bigint;
  counterparties: Map<
    string,
    {
      totalReceived: bigint;
      totalSent: bigint;
      transactionCount: number;
    }
  >;
}

// Configuration
const ROSETTA_CONFIGS = {
  ICP: {
    url: process.env.ICP_ROSETTA_URL || "https://rosetta-api.internetcomputer.org",
    network: "00000000000000020101",
    symbol: "ICP",
    decimals: 8,
  },
  CKBTC: {
    url: process.env.CKBTC_ROSETTA_URL || "https://icrc-api.internetcomputer.org/api/v1",
    network: "mxzaz-hqaaa-aaaar-qaada-cai",
    symbol: "ckBTC",
    decimals: 8,
  },
  CKUSDC: {
    url: process.env.CKUSDC_ROSETTA_URL || "https://icrc-api.internetcomputer.org/api/v1",
    network: "xevnm-gaaaa-aaaar-qafnq-cai",
    symbol: "ckUSDC",
    decimals: 6,
  },
  CKUSDT: {
    url: process.env.CKUSDT_ROSETTA_URL || "https://icrc-api.internetcomputer.org/api/v1",
    network: "cngnf-vqaaa-aaaar-qag4q-cai",
    symbol: "ckUSDT",
    decimals: 6,
  },
};

// Load deposit addresses from JSON file
function loadDepositAddresses(filePath: string): DepositAddress[] {
  try {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

    console.log(`Loading addresses from: ${absolutePath}`);
    const fileContent = fs.readFileSync(absolutePath, "utf-8");
    const addresses = JSON.parse(fileContent) as DepositAddress[];

    if (!Array.isArray(addresses)) {
      throw new Error("Addresses file must contain an array");
    }

    return addresses;
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error(`Error loading addresses file: ${err.message || String(error)}`);
    process.exit(1);
  }
}

// Utility functions
function parseAddress(address: string): { principal: string; subaccount?: string } {
  // Check if it's a principal with subaccount (format: principal-xxx.hex)
  const match = address.match(/^([a-z0-9-]+)(?:-([a-z0-9]+))?\.([\da-f]+)$/);
  if (match) {
    const result: { principal: string; subaccount?: string } = {
      principal: match[1] + (match[2] ? `-${match[2]}` : ""),
    };
    if (match[3]) {
      result.subaccount = match[3];
    }
    return result;
  }

  // Check if it's just a principal
  if (address.includes("-") && address.split("-").length >= 5) {
    return { principal: address };
  }

  // Otherwise it's an account ID (hex)
  return { principal: address };
}

function formatAmount(value: string, decimals: number): string {
  const absValue = value.startsWith("-") ? value.slice(1) : value;
  const paddedValue = absValue.padStart(decimals + 1, "0");
  const integerPart = paddedValue.slice(0, -decimals) || "0";
  const fractionalPart = paddedValue.slice(-decimals);
  const trimmedFractional = fractionalPart.replace(/0+$/, "");

  const formatted = trimmedFractional ? `${integerPart}.${trimmedFractional}` : integerPart;
  return value.startsWith("-") ? `-${formatted}` : formatted;
}

// Rosetta API functions
async function searchTransactions(
  address: string,
  asset: string,
  limit: number = 100
): Promise<RosettaTransaction[]> {
  const config = ROSETTA_CONFIGS[asset as keyof typeof ROSETTA_CONFIGS];
  if (!config) {
    console.error(`Unknown asset: ${asset}`);
    return [];
  }

  const parsedAddress = parseAddress(address);
  const url = `${config.url}/search/transactions`;

  interface RosettaSearchRequest {
    network_identifier: {
      blockchain: string;
      network: string;
    };
    account_identifier: {
      address: string;
      sub_account?: {
        address: string;
      };
    };
    limit: number;
  }

  const requestData: RosettaSearchRequest = {
    network_identifier: {
      blockchain: "Internet Computer",
      network: config.network,
    },
    account_identifier: {
      address: parsedAddress.principal,
    },
    limit: limit,
  };

  // Add subaccount if present
  if (parsedAddress.subaccount) {
    requestData.account_identifier.sub_account = {
      address: parsedAddress.subaccount.padStart(64, "0"),
    };
  }

  try {
    console.log(`Fetching transactions for ${address} (${asset})...`);
    const response = await axios.post(url, requestData, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });

    return response.data.transactions || [];
  } catch (error: unknown) {
    const err = error as { response?: { status?: number }; message?: string };
    if (err.response?.status === 404) {
      console.log(`No transactions found for ${address} (${asset})`);
    } else {
      console.error(
        `Error fetching transactions for ${address} (${asset}):`,
        err.message || String(error)
      );
    }
    return [];
  }
}

// Analyze transaction flow
function analyzeTransactionFlow(
  address: string,
  asset: string,
  transactions: RosettaTransaction[]
): TransactionFlow {
  const config = ROSETTA_CONFIGS[asset as keyof typeof ROSETTA_CONFIGS];
  const parsedAddress = parseAddress(address);
  const flow: TransactionFlow = {
    address,
    asset,
    transactions: [],
    totalReceived: BigInt(0),
    totalSent: BigInt(0),
    netBalance: BigInt(0),
    counterparties: new Map(),
  };

  for (const tx of transactions) {
    const blockHeight = tx.block_identifier.index;
    const txHash = tx.transaction.transaction_identifier.hash;

    for (const op of tx.transaction.operations) {
      if (!op.amount || op.type === "FEE") continue;

      const isOurAddress =
        op.account.address === parsedAddress.principal || op.account.address === address;

      if (isOurAddress) {
        const amount = BigInt(op.amount.value);
        const isReceive = amount > 0;

        // Find counterparty and their subaccount
        // Look for the OTHER TRANSFER operation that's not our address
        let counterparty = "unknown";
        let counterpartySubaccount: string | undefined;

        for (const otherOp of tx.transaction.operations) {
          // ICP uses "TRANSACTION" type, ICRC uses "TRANSFER" type
          const isTransferOp = otherOp.type === "TRANSFER" || otherOp.type === "TRANSACTION";

          if (
            isTransferOp &&
            otherOp.operation_identifier.index !== op.operation_identifier.index
          ) {
            const otherAddress = otherOp.account.address;
            // Make sure this is actually a different address
            if (
              otherAddress !== parsedAddress.principal &&
              otherAddress !== address &&
              otherAddress !== op.account.address
            ) {
              counterparty = otherAddress;
              counterpartySubaccount = otherOp.account.sub_account?.address;
              break;
            }
          }
        }

        const feeOp = tx.transaction.operations.find((o) => o.type === "FEE");
        const txData: {
          blockHeight: number;
          txHash: string;
          type: "SEND" | "RECEIVE";
          counterparty: string;
          counterpartySubaccount?: string;
          amount: string;
          fee?: string;
        } = {
          blockHeight,
          txHash,
          type: isReceive ? "RECEIVE" : "SEND",
          counterparty,
          amount: formatAmount(op.amount.value, config.decimals),
        };

        if (counterpartySubaccount) {
          txData.counterpartySubaccount = counterpartySubaccount;
        }

        if (feeOp?.amount?.value) {
          txData.fee = formatAmount(feeOp.amount.value, config.decimals);
        }

        flow.transactions.push(txData);

        // Track counterparty statistics
        if (counterparty !== "unknown") {
          const cpStats = flow.counterparties.get(counterparty) || {
            totalReceived: BigInt(0),
            totalSent: BigInt(0),
            transactionCount: 0,
          };

          if (isReceive) {
            cpStats.totalReceived += amount;
          } else {
            cpStats.totalSent += amount < 0 ? -amount : amount;
          }
          cpStats.transactionCount += 1;

          flow.counterparties.set(counterparty, cpStats);
        }

        if (isReceive) {
          flow.totalReceived += amount;
        } else {
          flow.totalSent += amount < 0 ? -amount : amount;
        }
      }
    }
  }

  flow.netBalance = flow.totalReceived - flow.totalSent;

  return flow;
}

// Main function
async function main(addressesFilePath: string) {
  // Load deposit addresses from JSON file
  const DEPOSIT_ADDRESSES = loadDepositAddresses(addressesFilePath);

  console.log("=".repeat(80));
  console.log("ROSETTA TRANSACTION FLOW RETRIEVER");
  console.log("=".repeat(80));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Total addresses to process: ${DEPOSIT_ADDRESSES.length}`);
  console.log();

  const results: TransactionFlow[] = [];
  const summary = {
    totalAddresses: DEPOSIT_ADDRESSES.length,
    addressesWithTransactions: 0,
    totalTransactions: 0,
    byAsset: {} as Record<string, { count: number; totalReceived: string; totalSent: string }>,
  };

  // Group addresses by asset for efficient processing
  const addressesByAsset = DEPOSIT_ADDRESSES.reduce(
    (acc, addr) => {
      if (!acc[addr.asset]) {
        acc[addr.asset] = [];
      }
      acc[addr.asset]!.push(addr);
      return acc;
    },
    {} as Record<string, DepositAddress[]>
  );

  // Process each asset type
  for (const [asset, addresses] of Object.entries(addressesByAsset)) {
    console.log(`\nProcessing ${asset} addresses (${addresses.length} total)...`);
    console.log("-".repeat(60));

    const config = ROSETTA_CONFIGS[asset as keyof typeof ROSETTA_CONFIGS];
    if (!config) {
      console.error(`Skipping unknown asset: ${asset}`);
      continue;
    }

    if (!summary.byAsset[asset]) {
      summary.byAsset[asset] = {
        count: 0,
        totalReceived: "0",
        totalSent: "0",
      };
    }

    for (const addr of addresses) {
      const transactions = await searchTransactions(addr.address, asset);

      if (transactions.length > 0) {
        const flow = analyzeTransactionFlow(addr.address, asset, transactions);
        results.push(flow);

        summary.addressesWithTransactions++;
        summary.totalTransactions += flow.transactions.length;

        const assetStats = summary.byAsset[asset]!;
        assetStats.count += flow.transactions.length;

        // Update asset totals
        const currentReceived = BigInt(assetStats.totalReceived.replace(".", ""));
        const currentSent = BigInt(assetStats.totalSent.replace(".", ""));
        assetStats.totalReceived = formatAmount(
          (currentReceived + flow.totalReceived).toString(),
          config.decimals
        );
        assetStats.totalSent = formatAmount(
          (currentSent + flow.totalSent).toString(),
          config.decimals
        );

        console.log(`✓ ${addr.address.substring(0, 20)}... - ${flow.transactions.length} txs`);
      } else {
        console.log(`○ ${addr.address.substring(0, 20)}... - No transactions`);
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Generate reports
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total addresses processed: ${summary.totalAddresses}`);
  console.log(`Addresses with transactions: ${summary.addressesWithTransactions}`);
  console.log(`Total transactions found: ${summary.totalTransactions}`);
  console.log();

  console.log("By Asset:");
  console.log("-".repeat(60));
  for (const [asset, stats] of Object.entries(summary.byAsset)) {
    if (stats.count > 0) {
      console.log(`${asset}:`);
      console.log(`  Transactions: ${stats.count}`);
      console.log(`  Total Received: ${stats.totalReceived} ${asset}`);
      console.log(`  Total Sent: ${stats.totalSent} ${asset}`);
    }
  }

  // Save detailed results to JSON
  const outputDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const outputFile = path.join(outputDir, `rosetta-flows-${timestamp}.json`);

  // Custom JSON serializer to handle BigInt values and Maps
  const jsonOutput = JSON.stringify(
    {
      metadata: {
        timestamp: new Date().toISOString(),
        addresses: DEPOSIT_ADDRESSES,
      },
      summary,
      flows: results.map((flow) => ({
        ...flow,
        totalReceived: flow.totalReceived.toString(),
        totalSent: flow.totalSent.toString(),
        netBalance: flow.netBalance.toString(),
        counterparties: Array.from(flow.counterparties.entries()).map(([address, stats]) => ({
          address,
          totalReceived: stats.totalReceived.toString(),
          totalSent: stats.totalSent.toString(),
          transactionCount: stats.transactionCount,
        })),
      })),
    },
    null,
    2
  );

  fs.writeFileSync(outputFile, jsonOutput);

  console.log(`\nDetailed results saved to: ${outputFile}`);

  // Generate CSV report
  const csvFile = path.join(outputDir, `rosetta-flows-${timestamp}.csv`);
  const csvHeader =
    "Address,Asset,Type,BlockHeight,TxHash,Counterparty,CounterpartySubaccount,Amount,Fee\n";
  const csvRows = results.flatMap((flow) =>
    flow.transactions.map(
      (tx) =>
        `${flow.address},${flow.asset},${tx.type},${tx.blockHeight},${tx.txHash},${tx.counterparty},${tx.counterpartySubaccount || ""},${tx.amount},${tx.fee || ""}`
    )
  );

  fs.writeFileSync(csvFile, csvHeader + csvRows.join("\n"));
  console.log(`CSV report saved to: ${csvFile}`);

  // Generate Counterparty Summary CSV
  const counterpartyFile = path.join(outputDir, `rosetta-counterparties-${timestamp}.csv`);
  const counterpartyHeader =
    "DepositAddress,Asset,CounterpartyAddress,TotalReceived,TotalSent,NetFlow,TransactionCount\n";
  const counterpartyRows = results.flatMap((flow) => {
    const config = ROSETTA_CONFIGS[flow.asset as keyof typeof ROSETTA_CONFIGS];
    return Array.from(flow.counterparties.entries()).map(([cpAddress, stats]) => {
      const netFlow = stats.totalReceived - stats.totalSent;
      return `${flow.address},${flow.asset},${cpAddress},${formatAmount(stats.totalReceived.toString(), config.decimals)},${formatAmount(stats.totalSent.toString(), config.decimals)},${formatAmount(netFlow.toString(), config.decimals)},${stats.transactionCount}`;
    });
  });

  fs.writeFileSync(counterpartyFile, counterpartyHeader + counterpartyRows.join("\n"));
  console.log(`Counterparty analysis saved to: ${counterpartyFile}`);

  // Generate transaction flow visualization
  console.log("\n" + "=".repeat(80));
  console.log("TRANSACTION FLOWS (Top 10 by activity)");
  console.log("=".repeat(80));

  const topFlows = results
    .sort((a, b) => b.transactions.length - a.transactions.length)
    .slice(0, 10);

  for (const flow of topFlows) {
    const config = ROSETTA_CONFIGS[flow.asset as keyof typeof ROSETTA_CONFIGS];
    console.log(`\n${flow.address.substring(0, 30)}... (${flow.asset})`);
    console.log(`  Transactions: ${flow.transactions.length}`);
    console.log(
      `  Total Received: ${formatAmount(flow.totalReceived.toString(), config.decimals)} ${flow.asset}`
    );
    console.log(
      `  Total Sent: ${formatAmount(flow.totalSent.toString(), config.decimals)} ${flow.asset}`
    );
    console.log(
      `  Net Balance: ${formatAmount(flow.netBalance.toString(), config.decimals)} ${flow.asset}`
    );

    // Show recent transactions
    const recentTxs = flow.transactions.slice(0, 3);
    if (recentTxs.length > 0) {
      console.log("  Recent transactions:");
      for (const tx of recentTxs) {
        const arrow = tx.type === "RECEIVE" ? "→" : "←";
        console.log(
          `    ${arrow} Block ${tx.blockHeight}: ${tx.amount} ${flow.asset} ${tx.type === "RECEIVE" ? "from" : "to"} ${tx.counterparty.substring(0, 20)}...`
        );
      }
    }
  }

  // Show top counterparties by transaction volume
  console.log("\n" + "=".repeat(80));
  console.log("TOP COUNTERPARTIES BY VOLUME");
  console.log("=".repeat(80));

  // Collect all unique counterparties across all flows
  const globalCounterparties = new Map<
    string,
    {
      addresses: Set<string>;
      totalVolume: bigint;
      transactionCount: number;
      assets: Set<string>;
    }
  >();

  for (const flow of results) {
    const counterpartyEntries = Array.from(flow.counterparties.entries());
    for (const [cpAddress, stats] of counterpartyEntries) {
      const existing = globalCounterparties.get(cpAddress) || {
        addresses: new Set<string>(),
        totalVolume: BigInt(0),
        transactionCount: 0,
        assets: new Set<string>(),
      };

      existing.addresses.add(flow.address);
      existing.totalVolume += stats.totalReceived + stats.totalSent;
      existing.transactionCount += stats.transactionCount;
      existing.assets.add(flow.asset);

      globalCounterparties.set(cpAddress, existing);
    }
  }

  // Sort by total volume and show top 10
  const topCounterparties = Array.from(globalCounterparties.entries())
    .sort((a, b) => {
      const volA = a[1].totalVolume;
      const volB = b[1].totalVolume;
      return volA > volB ? -1 : volA < volB ? 1 : 0;
    })
    .slice(0, 10);

  for (const [cpAddress, stats] of topCounterparties) {
    console.log(`\n${cpAddress.substring(0, 50)}${cpAddress.length > 50 ? "..." : ""}`);
    console.log(`  Interacted with ${stats.addresses.size} deposit address(es)`);
    console.log(`  Total transactions: ${stats.transactionCount}`);
    console.log(`  Assets involved: ${Array.from(stats.assets).join(", ")}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("SCRIPT COMPLETED");
  console.log("=".repeat(80));
}

// Run the script
if (require.main === module) {
  const args = process.argv.slice(2);
  const addressesFile = args[0] || "addresses-new-vault-subaccounts.json";

  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: tsx rosetta-flow-retriever.ts [addresses-file.json]");
    console.log("");
    console.log("Arguments:");
    console.log("  addresses-file.json   Path to JSON file with deposit addresses");
    console.log("                        (default: addresses-new-vault-subaccounts.json)");
    console.log("");
    console.log("Available address files:");
    console.log(
      "  addresses-new-vault-subaccounts.json  - 25 addresses (10 ICP, 2 ckUSDC, 4 ckBTC, 9 ckUSDT)"
    );
    console.log("  addresses-new-custodian.json          - 1 address (new custodian principal)");
    console.log(
      "  addresses-old-vault-subaccounts.json  - 44 addresses (36 ICP, 4 ckUSDC, 2 ckBTC, 2 ckUSDT)"
    );
    console.log("  addresses-old-custodian.json          - 1 address (old custodian for testing)");
    console.log("");
    console.log("Examples:");
    console.log("  tsx rosetta-flow-retriever.ts addresses-new-vault-subaccounts.json");
    console.log("  tsx rosetta-flow-retriever.ts addresses-new-custodian.json");
    console.log("  tsx rosetta-flow-retriever.ts addresses-old-vault-subaccounts.json");
    console.log("  tsx rosetta-flow-retriever.ts addresses-old-custodian.json");
    process.exit(0);
  }

  main(addressesFile).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { searchTransactions, analyzeTransactionFlow };
export type { TransactionFlow };
