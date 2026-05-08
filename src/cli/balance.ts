import { connection } from "../connection.js";
import { loadWallet } from "../wallet.js";
import { config } from "../config.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getJupiterLendPosition, USDC_MINT, JL_USDC_MINT } from "../jupiter-lend.js";

const DISPLAY_USDC_MINT =
  config.cluster === "devnet"
    ? new PublicKey("8zGuJQqwhZafTah7Uc7Z4tXRnguqkn5KLFAP8oV6PHe2")
    : USDC_MINT;

async function readTokenBalance(owner: PublicKey, mint: PublicKey, label: string) {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  try {
    const account = await getAccount(connection, ata);
    const human = Number(account.amount) / 1_000_000;
    console.log(`  ${label.padEnd(10)}: ${human.toFixed(6)}  (raw: ${account.amount})`);
  } catch {
    console.log(`  ${label.padEnd(10)}: ATA not yet initialized`);
  }
}

async function main() {
  const wallet = await loadWallet();
  const sol = await connection.getBalance(wallet.keypair.publicKey);

  console.log(`Wallet : ${wallet.address}`);
  console.log(`SOL    : ${(sol / LAMPORTS_PER_SOL).toFixed(4)}\n`);

  console.log("Token balances:");
  await readTokenBalance(wallet.keypair.publicKey, DISPLAY_USDC_MINT, "USDC");
  await readTokenBalance(wallet.keypair.publicKey, JL_USDC_MINT, "jlUSDC");

  if (config.cluster === "mainnet-beta") {
    console.log("\nJupiter Lend position:");
    try {
      const pos = await getJupiterLendPosition();
      const shares = (Number(pos.jlUsdcShares) / 1_000_000).toFixed(6);
      const value = (Number(pos.usdcValue) / 1_000_000).toFixed(6);
      console.log(`  ${"jlUSDC".padEnd(10)}: ${shares} shares (~${value} USDC)`);
    } catch {
      console.log("  No position found");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
