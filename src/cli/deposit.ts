import { depositUsdcPlus } from "../reflect";
import { log } from "../logger.js";

async function main() {
  // Parse CLI args:  yarn deposit <amountUsdc> [slippageBps]
  const [amountStr, slippageStr] = process.argv.slice(2);

  if (!amountStr) {
    console.error("Usage: yarn deposit <amountUsdc> [slippageBps]");
    console.error("  amountUsdc   — amount in USDC (e.g. 0.1 = 0.1 USDC)");
    console.error("  slippageBps  — max slippage in basis points (default 100 = 1%)");
    process.exit(1);
  }

  // Convert decimal USDC to raw units (6 decimals)
  const amountUsdcRaw = BigInt(Math.floor(parseFloat(amountStr) * 1_000_000));
  const slippageBps = slippageStr ? parseInt(slippageStr, 10) : 100;

  if (!Number.isFinite(Number(amountUsdcRaw)) || amountUsdcRaw <= 0n) {
    console.error(`Invalid amount: ${amountStr}`);
    process.exit(1);
  }

  const result = await depositUsdcPlus(amountUsdcRaw, slippageBps);

  log.info(
    {
      signature: result.signature,
      explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=mainnet-beta`,
    },
    "Deposit complete",
  );
}

main().catch((e) => {
  log.error({ err: e.message, stack: e.stack }, "Deposit failed");
  process.exit(1);
});
