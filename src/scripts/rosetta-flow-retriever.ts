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
    amount: string;
    fee?: string;
  }>;
  totalReceived: bigint;
  totalSent: bigint;
  netBalance: bigint;
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

// Parse deposit addresses
const DEPOSIT_ADDRESSES: DepositAddress[] = [
  // ICP addresses
  {
    address: "313fbe9c45f1644076d3be1a2b83dc46238edb4a5b8185807d4e774f6cc409d8",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "bfe0d99601c21aa1446c0351c4ae2c93e58612766b110a2c9c721a2529d392e6",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "27a1c92afd3e434a45b6e0389878ff550f6ec4113294af000581ee31da8ee8bd",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "213a2329282ec742684af76dfa9219ce3e76696bc58a685848036a1f95c483a3",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "03d5313b595283a03e796a1cb552a66a3b664b50c9b8f41c4ee9e92694d8f7df",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "8213138d185465036ef26b68aefef367abc8aa98358b6f4529290685dc29b054",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "51587e7c204274e97cb99354fbe90ad4fc7095d6265aaf0e67baf2891720beba",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "fa7c17b564f81a23e93e0ff7050afc5712071489e72a8dd9a826cf776ec9f727",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "7468b4401470a7d70286cb7b846aa4cf2e9d60fc0f34b15040b62f748c6c295e",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "2bb79745f2508149bc2b5223c493390ea0b676d77418e72097ab0ba3489be007",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "4d40732a10a86db16f047f85344a0a2c3ab7f29e58e3274ce185760a4e287a11",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "94d96d856258ccdf7caa405d854cc43516846bee7a9945c6a22572c05f395122",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "efbf1c300e931cccb86a7692a8304cc1c10b7cc9101ceddddf0c37fe2d8955bd",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "0213b16c7b9690f00870f3743655a31da24e90d63e91f7acbb462f7dd72efde4",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "b5cab95cb7175b68c61927dda853bc73c6904c0a636267a6ca94f5574df77b93",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "782d9e39859edbb706d6bc67e05a89183f3f810f0f867865f5d259656ebe2382",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "76dabaa0623d610a52beb0f7eb83b49cab6385f9be1e56f6499028a3804464e7",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "0a5920b6f942388885e83a4526150a996bcd59aa45ab7b42c93a527763e4c8ab",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "0cbcfb369235915c22b097b2971cb2baaac8505bbaa850dbfd010429b4e345a2",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "73bc1a9270533e97a4c26af5c4d914d144b11653719e2b11032ae885a87bc4de",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "1da4b1a9bcd903cf4d976eba66c5c2e964d26614f05782567cd42b6d49c8d84c",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "c93554f9fdc70b9157cb3669840f0195ea0b3c9a03fb3c4c9f91067575d6534b",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "aae540f33a31079b6d1390d1d341459c6831f2494b4710bf8142b1c3f684df77",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "9e9530875d810a1ecc82ed9300f688dfe7acc021db49ebc8e2a0a39f9da7b2c3",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "4e5747ce8681ab72e17adfa9143bc041626e34f24a499f415efd9565226637d6",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "b97e5e72a4ba885e3e3c09ea765ab6a991ab04f9034a67fd1e846ea18fb09634",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "204eaf5049b46bcf5b273695a219acce4c8f4c17d75c7f5401bc4422ebe782d7",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "64415e195a880e1933aa18447675fcc97e75bf126978dc8e2b8c9f729b95dd55",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "751f76f9b5b86883d59d60851064e5a28b42dc8a4825166b1523681b99176f58",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "e060a06f984c91b3d75ecdfc73d99ad473a603bbffbb6a1d57690962f3472282",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "8585fdac56c2733021c57ae9cab6fb57bd67edc6ceb75dc3f75116e8031bc1f5",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "536142247b3b739f3d0e29366417cdcb8821a8528585f3db85ded6de687ebe1f",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "20d08ba18445b6f7e97029f87ff99c606737bba48b748d0a673c2e0aea687fca",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "d50b0aa8b3c504083fe6ebd33588d3e2b9abf5b3f0eb1a3a138616356c671de5",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "7dfe9c41b6b92f871ce4cddfecb01afd09908f48407af0f7cfe52731f672b8dc",
    asset: "ICP",
    originalAsset: "ICP",
  },
  {
    address: "1982b36efb63c463d0a64160f939acc151dbdbeb4032febdfa57992d619a5a7f",
    asset: "ICP",
    originalAsset: "ICP",
  },

  // ICRC token addresses with principal format
  {
    address: "g5nrt-myaaa-aaaap-qhluq-cai-yyuo52q.1e",
    asset: "CKUSDT",
    originalAsset: "CKUSDT_ICP_2",
  },
  {
    address: "g5nrt-myaaa-aaaap-qhluq-cai-wex547a.1f",
    asset: "CKUSDC",
    originalAsset: "CKUSDC_ICP_2",
  },
  {
    address: "g5nrt-myaaa-aaaap-qhluq-cai-5fdze3i.22",
    asset: "CKUSDC",
    originalAsset: "CKUSDC_ICP_2",
  },
  {
    address: "g5nrt-myaaa-aaaap-qhluq-cai-tzakf6y.23",
    asset: "CKBTC",
    originalAsset: "CKBTC_ICP_2",
  },
  {
    address: "g5nrt-myaaa-aaaap-qhluq-cai-aasdowa.24",
    asset: "CKUSDC",
    originalAsset: "CKUSDC_ICP_2",
  },
  {
    address: "g5nrt-myaaa-aaaap-qhluq-cai-5yvfm5a.26",
    asset: "CKUSDC",
    originalAsset: "CKUSDC_ICP",
  },
  { address: "g5nrt-myaaa-aaaap-qhluq-cai-tewwnyq.27", asset: "CKBTC", originalAsset: "CKBTC_ICP" },
  {
    address: "g5nrt-myaaa-aaaap-qhluq-cai-bgjhw4y.28",
    asset: "CKUSDT",
    originalAsset: "CKUSDT_ICP",
  },
];

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

        // Find counterparty
        let counterparty = "unknown";
        for (const otherOp of tx.transaction.operations) {
          if (otherOp.type === "TRANSFER" && otherOp.account.address !== op.account.address) {
            counterparty = otherOp.account.address;
            break;
          }
        }

        const feeOp = tx.transaction.operations.find((o) => o.type === "FEE");
        const txData: {
          blockHeight: number;
          txHash: string;
          type: "SEND" | "RECEIVE";
          counterparty: string;
          amount: string;
          fee?: string;
        } = {
          blockHeight,
          txHash,
          type: isReceive ? "RECEIVE" : "SEND",
          counterparty,
          amount: formatAmount(op.amount.value, config.decimals),
        };

        if (feeOp?.amount?.value) {
          txData.fee = formatAmount(feeOp.amount.value, config.decimals);
        }

        flow.transactions.push(txData);

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
async function main() {
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

  // Custom JSON serializer to handle BigInt values
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
      })),
    },
    null,
    2
  );

  fs.writeFileSync(outputFile, jsonOutput);

  console.log(`\nDetailed results saved to: ${outputFile}`);

  // Generate CSV report
  const csvFile = path.join(outputDir, `rosetta-flows-${timestamp}.csv`);
  const csvHeader = "Address,Asset,Type,BlockHeight,TxHash,Counterparty,Amount,Fee\n";
  const csvRows = results.flatMap((flow) =>
    flow.transactions.map(
      (tx) =>
        `${flow.address},${flow.asset},${tx.type},${tx.blockHeight},${tx.txHash},${tx.counterparty},${tx.amount},${tx.fee || ""}`
    )
  );

  fs.writeFileSync(csvFile, csvHeader + csvRows.join("\n"));
  console.log(`CSV report saved to: ${csvFile}`);

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

  console.log("\n" + "=".repeat(80));
  console.log("SCRIPT COMPLETED");
  console.log("=".repeat(80));
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { searchTransactions, analyzeTransactionFlow };
export type { TransactionFlow };
