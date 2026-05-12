import {
  getAllTelegramIds,
  getDepositRecipient,
  getUserSettings,
  getUserWallet,
  isDue,
  logSavingsTransaction,
  nextDueAt,
  setLastRunAt,
  usdToRawUsdc,
} from "./db.js";
import { depositJupiterLend, getUsdcBalance, transferJlUsdc } from "./jupiter-lend.js";
import { log } from "./logger.js";
import { PublicKey } from "@solana/web3.js";
import { connection } from "./connection.js";
import { loadWallet } from "./wallet.js";
import { buildSuccessMessage, sendTelegramMessage } from "./telegram.js";

/** Minimum SOL keeper should retain for transaction fees: 0.005 SOL = 5_000_000 lamports. */
const KEEPER_MIN_SOL_LAMPORTS = 5_000_000n;

type RunResult = {
  telegramId: string;
  recipient?: string;
  signerWallet?: string;
  status: "success" | "skipped" | "failed" | "partial";
  reason?: string;
  depositSignature?: string;
  transferSignature?: string;
  jlUsdcSent?: string;
  error?: string;
};

/**
 * Fetch every user with a savings config, run any that are due.
 * Failures are isolated — one user's error does not stop the others.
 */
export async function runDueDeposits(): Promise<RunResult[]> {
  const ids = await getAllTelegramIds();

  if (ids.length === 0) {
    log.info("No user settings found in Redis");
    return [];
  }

  log.info({ users: ids.length }, "Scanning users for due deposits");

  const results: RunResult[] = [];

  for (const telegramId of ids) {
    const wallet = await getUserWallet(telegramId);
    const settings = await getUserSettings(telegramId);

    if (!wallet) {
      log.info({ telegramId }, "Skipping user — no wallet record");
      results.push({ telegramId, status: "skipped", reason: "no-wallet" });
      continue;
    }

    if (!settings) {
      log.info(
        { telegramId, signerWallet: wallet.walletAddress },
        "Skipping user — savings not configured yet (no settings:telegram:<id>)",
      );
      results.push({ telegramId, status: "skipped", reason: "no-settings" });
      continue;
    }

    if (!settings.fundingConfiguredAt || !settings.fundingAmountUsd) {
      log.info(
        {
          telegramId,
          signerWallet: wallet.walletAddress,
          fundingConfiguredAt: settings.fundingConfiguredAt,
          fundingAmountUsd: settings.fundingAmountUsd,
        },
        "Skipping user — funding not configured",
      );
      results.push({ telegramId, status: "skipped", reason: "funding-not-configured" });
      continue;
    }

    if (!isDue(settings)) {
      const dueMs = nextDueAt(settings);
      log.info(
        {
          telegramId,
          signerWallet: wallet.walletAddress,
          fundingFrequency: settings.fundingFrequency,
          lastRunAt: settings.lastRunAt ?? null,
          fundingConfiguredAt: settings.fundingConfiguredAt,
          nextDueAt: dueMs ? new Date(dueMs).toISOString() : null,
          inMs: dueMs ? dueMs - Date.now() : null,
        },
        "Skipping user — not due yet",
      );
      results.push({ telegramId, status: "skipped", reason: "not-due" });
      continue;
    }

    const amountRaw = usdToRawUsdc(settings.fundingAmountUsd);
    const recipientAddress = getDepositRecipient(wallet);

    let recipient: PublicKey;
    try {
      recipient = new PublicKey(recipientAddress);
    } catch {
      log.warn(
        { telegramId, recipientAddress },
        "Recipient address is not a valid Solana pubkey — skipping",
      );
      results.push({ telegramId, status: "skipped", reason: "invalid-recipient-address" });
      continue;
    }

    log.info(
      {
        telegramId,
        recipient: recipientAddress,
        recipientType: wallet.vaultAddress ? "squads-vault" : "signer-wallet",
        signerWallet: wallet.walletAddress,
        amountUsd: settings.fundingAmountUsd,
        amountRaw: amountRaw.toString(),
        frequency: settings.fundingFrequency,
        strategy: settings.savingsStrategy,
      },
      "Executing scheduled deposit",
    );

    // Pre-flight: verify the keeper can cover this deposit + tx fees.
    // If not, skip with an explicit reason. lastRunAt is NOT advanced, so the
    // user remains "due" and we retry on the next polling tick.
    const keeperWallet = await loadWallet();
    const keeperSol = BigInt(await connection.getBalance(keeperWallet.keypair.publicKey));
    const keeperUsdc = await getUsdcBalance(keeperWallet.keypair.publicKey);

    if (keeperUsdc < amountRaw) {
      log.warn(
        {
          telegramId,
          keeper: keeperWallet.address,
          neededUsdcRaw: amountRaw.toString(),
          haveUsdcRaw: keeperUsdc.toString(),
        },
        "Skipping — keeper has insufficient USDC; will retry next cycle",
      );
      results.push({
        telegramId,
        recipient: recipientAddress,
        signerWallet: wallet.walletAddress,
        status: "skipped",
        reason: "keeper-insufficient-usdc",
      });
      continue;
    }

    if (keeperSol < KEEPER_MIN_SOL_LAMPORTS) {
      log.warn(
        {
          telegramId,
          keeper: keeperWallet.address,
          neededSolLamports: KEEPER_MIN_SOL_LAMPORTS.toString(),
          haveSolLamports: keeperSol.toString(),
        },
        "Skipping — keeper has insufficient SOL for fees; will retry next cycle",
      );
      results.push({
        telegramId,
        recipient: recipientAddress,
        signerWallet: wallet.walletAddress,
        status: "skipped",
        reason: "keeper-insufficient-sol",
      });
      continue;
    }

    // 1. Deposit USDC → keeper receives jlUSDC.
    // Phase 1 uses the keeper's own USDC; delegate-based pull from the user's
    // ATA (settings.delegationTxSignature) is on the roadmap.
    let deposit;
    try {
      deposit = await depositJupiterLend(amountRaw);
    } catch (err: any) {
      const errMsg = err?.message || err?.name || String(err);
      log.error(
        { telegramId, recipient: recipientAddress, err: errMsg, stack: err?.stack },
        "Deposit failed — lastRunAt not advanced",
      );
      results.push({
        telegramId,
        recipient: recipientAddress,
        signerWallet: wallet.walletAddress,
        status: "failed",
        error: errMsg,
      });
      continue;
    }

    // 2. Forward the freshly minted jlUSDC to the user's wallet.
    // If this fails after the deposit succeeded, advance lastRunAt anyway so
    // we don't double-deposit; the jlUSDC sits in the keeper for manual recovery.
    try {
      const transferSignature = await transferJlUsdc(recipient, deposit.jlUsdcReceived);
      const now = new Date();
      await setLastRunAt(telegramId, now);
      await logSavingsTransaction(telegramId, {
        depositSignature: deposit.signature,
        transferSignature,
        timestamp: now.toISOString(),
        recipientAddress,
        signerWallet: wallet.walletAddress,
        amountUsd: settings.fundingAmountUsd,
        amountUsdcRaw: amountRaw.toString(),
        jlUsdcReceived: deposit.jlUsdcReceived.toString(),
        platform: "jupiter",
        status: "success",
      });

      log.info(
        {
          telegramId,
          recipient: recipientAddress,
          depositSignature: deposit.signature,
          transferSignature,
          jlUsdcSent: deposit.jlUsdcReceived.toString(),
        },
        "Scheduled deposit + transfer succeeded",
      );

      await sendTelegramMessage(
        telegramId,
        buildSuccessMessage({
          amountUsd: settings.fundingAmountUsd,
          jlUsdcReceived: deposit.jlUsdcReceived.toString(),
          recipientAddress,
          transferSignature,
        }),
      );

      results.push({
        telegramId,
        recipient: recipientAddress,
        signerWallet: wallet.walletAddress,
        status: "success",
        depositSignature: deposit.signature,
        transferSignature,
        jlUsdcSent: deposit.jlUsdcReceived.toString(),
      });
    } catch (err: any) {
      const errMsg = err?.message || err?.name || String(err);

      // Policy: "no saving done → no DB update". The deposit landed on-chain
      // but the user never received their tokens, so we do NOT advance lastRunAt,
      // do NOT write a tx log entry, and do NOT notify the user.
      //
      // Side effect: next tick will deposit AGAIN, leaving more jlUSDC stuck
      // in the keeper. Fix the underlying transfer issue and use
      // `yarn tsx src/cli/transfer-stuck-jlusdc.ts <recipient>` to drain the
      // accumulated balance.
      log.error(
        {
          telegramId,
          recipient: recipientAddress,
          depositSignature: deposit.signature,
          jlUsdcHeldByKeeper: deposit.jlUsdcReceived.toString(),
          err: errMsg,
          stack: err?.stack,
        },
        "DEPOSIT OK BUT TRANSFER FAILED — keeper now holds extra jlUSDC; lastRunAt NOT advanced, deposit will retry next tick",
      );

      results.push({
        telegramId,
        recipient: recipientAddress,
        signerWallet: wallet.walletAddress,
        status: "partial",
        depositSignature: deposit.signature,
        jlUsdcSent: deposit.jlUsdcReceived.toString(),
        error: errMsg,
      });
    }
  }

  return results;
}
