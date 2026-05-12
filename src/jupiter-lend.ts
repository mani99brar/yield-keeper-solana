import { getDepositIxs, getUserLendingPositionByAsset } from "@jup-ag/lend/earn";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import BN from "bn.js";
import { connection } from "./connection.js";
import { loadWallet } from "./wallet.js";
import { log } from "./logger.js";
import { explorerTxUrl } from "./config.js";

export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// jlUSDC — the share token received on deposit (exchange-rate appreciating)
export const JL_USDC_MINT = new PublicKey("9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D");

export type DepositResult = {
  signature: string;
  usdcDeposited: bigint;
  jlUsdcReceived: bigint;
};

export type Position = {
  jlUsdcShares: bigint;
  usdcValue: bigint;
  usdcBalance: bigint;
};

/** Read the token program that owns a given mint (handles both Token and Token-2022). */
async function getTokenProgramForMint(mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint ${mint.toBase58()} not found on chain`);
  return info.owner;
}

/** Keeper's current jlUSDC ATA balance; returns 0 if the ATA does not exist. */
export async function getJlUsdcBalance(owner: PublicKey): Promise<bigint> {
  const tokenProgram = await getTokenProgramForMint(JL_USDC_MINT);
  const ata = await getAssociatedTokenAddress(JL_USDC_MINT, owner, false, tokenProgram);
  try {
    const acc = await getAccount(connection, ata, "confirmed", tokenProgram);
    return acc.amount;
  } catch {
    return 0n;
  }
}

/** USDC balance in the owner's ATA, in raw units (6 decimals). 0 if the ATA does not exist. */
export async function getUsdcBalance(owner: PublicKey): Promise<bigint> {
  const tokenProgram = await getTokenProgramForMint(USDC_MINT);
  const ata = await getAssociatedTokenAddress(USDC_MINT, owner, false, tokenProgram);
  try {
    const acc = await getAccount(connection, ata, "confirmed", tokenProgram);
    return acc.amount;
  } catch {
    return 0n;
  }
}

/**
 * Deposit USDC from the keeper wallet into Jupiter Lend.
 * Returns jlUSDC shares minted to the keeper (exchange-rate appreciating).
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

  const sharesBefore = await getJlUsdcBalance(wallet.keypair.publicKey);

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.keypair.publicKey });
  tx.add(...ixs);

  log.info("Sending deposit transaction");

  const signature = await sendAndConfirmTransaction(connection, tx, [wallet.keypair], {
    commitment: "confirmed",
    maxRetries: 3,
  });

  const sharesAfter = await getJlUsdcBalance(wallet.keypair.publicKey);
  const jlUsdcReceived = sharesAfter - sharesBefore;

  log.info(
    {
      signature,
      jlUsdcReceived: jlUsdcReceived.toString(),
      explorer: explorerTxUrl(signature),
    },
    "Deposit confirmed",
  );

  return { signature, usdcDeposited: amountUsdc, jlUsdcReceived };
}

/**
 * Transfer jlUSDC from the keeper to a recipient.
 * Creates the recipient's ATA idempotently — safe to call for first-time users.
 */
export async function transferJlUsdc(recipient: PublicKey, amount: bigint): Promise<string> {
  if (amount <= 0n) throw new Error("amount must be > 0");

  const wallet = await loadWallet();
  const tokenProgram = await getTokenProgramForMint(JL_USDC_MINT);

  const fromAta = await getAssociatedTokenAddress(
    JL_USDC_MINT,
    wallet.keypair.publicKey,
    false,
    tokenProgram,
  );
  // Pass allowOwnerOffCurve=true so PDAs (e.g. Squads vaults) work as recipients.
  const toAta = await getAssociatedTokenAddress(JL_USDC_MINT, recipient, true, tokenProgram);

  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    wallet.keypair.publicKey,
    toAta,
    recipient,
    JL_USDC_MINT,
    tokenProgram,
  );

  const transferIx = createTransferInstruction(
    fromAta,
    toAta,
    wallet.keypair.publicKey,
    amount,
    [],
    tokenProgram,
  );

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.keypair.publicKey });
  tx.add(createAtaIx, transferIx);

  log.info(
    { recipient: recipient.toBase58(), amount: amount.toString() },
    "Sending jlUSDC transfer",
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [wallet.keypair], {
    commitment: "confirmed",
    maxRetries: 3,
  });

  log.info(
    { signature, explorer: explorerTxUrl(signature) },
    "jlUSDC transfer confirmed",
  );

  return signature;
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
