import { PublicKey } from "@solana/web3.js";
import { transferJlUsdc, getJlUsdcBalance } from "../jupiter-lend.js";
import { loadWallet } from "../wallet.js";

async function main() {
  const [recipientStr] = process.argv.slice(2);
  if (!recipientStr) {
    console.error("Usage: yarn tsx src/cli/transfer-stuck-jlusdc.ts <recipient>");
    process.exit(1);
  }

  const wallet = await loadWallet();
  const bal = await getJlUsdcBalance(wallet.keypair.publicKey);
  console.log("Keeper jlUSDC balance (raw):", bal.toString());

  if (bal <= 0n) {
    console.log("Nothing to transfer.");
    return;
  }

  const recipient = new PublicKey(recipientStr);
  console.log("Recipient :", recipient.toBase58());
  console.log("Sending …");

  try {
    const sig = await transferJlUsdc(recipient, bal);
    console.log("OK signature:", sig);
  } catch (e: any) {
    console.log("FAILED");
    console.log("  name              :", e?.name);
    console.log("  message           :", JSON.stringify(e?.message));
    console.log("  transactionMessage:", e?.transactionMessage);
    console.log("  logs              :", JSON.stringify(e?.logs, null, 2));
    console.log("  signature         :", e?.signature);
    console.log("  full stringified  :", JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
