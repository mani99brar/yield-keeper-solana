import { loadWallet } from "../wallet.js";
import { connection } from "../connection.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const wallet = await loadWallet();
  const sol = await connection.getBalance(wallet.keypair.publicKey);

  console.log(`Address : ${wallet.address}`);
  console.log(`Balance : ${(sol / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
