import { getDepositIxs, getUserLendingPositionByAsset } from "@jup-ag/lend/earn";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { connection } from "./connection.js";
import { loadWallet } from "./wallet.js";
import { log } from "./logger.js";

export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// jlUSDC — the share token received on deposit (exchange-rate appreciating)
export const JL_USDC_MINT = new PublicKey("9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D");

export type DepositResult = {
  signature: string;
  usdcDeposited: bigint;
};

export type Position = {
  jlUsdcShares: bigint;
  usdcValue: bigint;
  usdcBalance: bigint;
};

/**
 * Deposit USDC from the keeper wallet into Jupiter Lend.
 * Returns jlUSDC shares (exchange-rate appreciating — yield accrues via the rate, not rebasing).
 *
 * @param amountUsdc Amount of USDC in raw units (6 decimals — 1 USDC = 1_000_000)
 */
export async function depositJupiterLend(amountUsdc: bigint): Promise<DepositResult> {
  if (amountUsdc <= 0n) throw new Error("amountUsdc must be > 0");

  const wallet = await loadWallet();

  log.info(
    { amountUsdc: amountUsdc.toString(), keeper: wallet.address },
    "Building Jupiter Lend deposit instructions",
  );

  const { ixs } = await getDepositIxs({
    amount: new BN(amountUsdc.toString()),
    asset: USDC_MINT,
    signer: wallet.keypair.publicKey,
    connection,
  });

  log.debug({ instructionCount: ixs.length }, "Jupiter Lend SDK returned instructions");

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.keypair.publicKey });
  tx.add(...ixs);

  log.info("Sending transaction");

  const signature = await sendAndConfirmTransaction(connection, tx, [wallet.keypair], {
    commitment: "confirmed",
    maxRetries: 3,
  });

  log.info(
    {
      signature,
      explorer: `https://explorer.solana.com/tx/${signature}`,
    },
    "Deposit confirmed",
  );

  return { signature, usdcDeposited: amountUsdc };
}

/**
 * Read the keeper's Jupiter Lend USDC position.
 */
export async function getJupiterLendPosition(): Promise<Position> {
  const wallet = await loadWallet();

  const { lendingTokenShares, underlyingAssets, underlyingBalance } =
    await getUserLendingPositionByAsset({
      user: wallet.keypair.publicKey,
      asset: USDC_MINT,
      connection,
    });

  return {
    jlUsdcShares: BigInt(lendingTokenShares.toString()),
    usdcValue: BigInt(underlyingAssets.toString()),
    usdcBalance: BigInt(underlyingBalance.toString()),
  };
}
