import { depositJupiterLend } from "../jupiter-lend.js";
import { log } from "../logger.js";

async function main() {
  const [amountStr] = process.argv.slice(2);

  if (!amountStr) {
    console.error("Usage: yarn jupiter:deposit <amountUsdc>");
    console.error("  amountUsdc — amount in USDC (e.g. 0.1 = 0.1 USDC)");
    process.exit(1);
  }

  const amountUsdcRaw = BigInt(Math.floor(parseFloat(amountStr) * 1_000_000));

  if (amountUsdcRaw <= 0n) {
    console.error(`Invalid amount: ${amountStr}`);
    process.exit(1);
  }

  const result = await depositJupiterLend(amountUsdcRaw);

  log.info(
    {
      signature: result.signature,
      usdcDeposited: result.usdcDeposited.toString(),
      explorer: `https://explorer.solana.com/tx/${result.signature}`,
    },
    "Jupiter Lend deposit complete",
  );
}

main().catch((e) => {
  log.error({ err: e.message, stack: e.stack }, "Deposit failed");
  process.exit(1);
});
