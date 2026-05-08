import { connection } from "../connection.js";
import { loadWallet } from "../wallet.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "../config.js";

async function main() {
  if (config.cluster !== "devnet") {
    console.error(`Refusing to airdrop on cluster: ${config.cluster}`);
    process.exit(1);
  }
  const wallet = await loadWallet();
  console.log(`Requesting 1 SOL airdrop to ${wallet.address}...`);
  const sig = await connection.requestAirdrop(wallet.keypair.publicKey, 1 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
  const sol = await connection.getBalance(wallet.keypair.publicKey);
  console.log(`Done. New balance: ${(sol / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`If this fails repeatedly, use https://faucet.solana.com instead.`);
}

main().catch((e) => {
  console.error(`Airdrop failed: ${e.message}`);
  console.error(`Devnet airdrops are rate-limited. Try https://faucet.solana.com.`);
  process.exit(1);
});
