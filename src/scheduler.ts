import { getDueConfigIds, getSavingsConfig, markExecuted } from "./db.js";
import { depositJupiterLend } from "./jupiter-lend.js";
import { log } from "./logger.js";

type RunResult = {
  id: string;
  userWallet: string;
  status: "success" | "skipped" | "failed";
  signature?: string;
  error?: string;
};

/**
 * Fetch all due savings configs and execute their yield deposits.
 * Each config runs independently — a failure on one does not stop the others.
 *
 * Returns a summary of every config that was processed.
 */
export async function runDueDeposits(): Promise<RunResult[]> {
  const now = Date.now();
  const dueIds = await getDueConfigIds(now);

  if (dueIds.length === 0) {
    log.info("No savings configs due for execution");
    return [];
  }

  log.info({ count: dueIds.length }, "Found due savings configs");

  const results: RunResult[] = [];

  for (const id of dueIds) {
    const cfg = await getSavingsConfig(id);

    if (!cfg) {
      log.warn({ id }, "Config ID in schedule but not found in DB — skipping");
      results.push({ id, userWallet: "unknown", status: "skipped" });
      continue;
    }

    if (!cfg.active) {
      log.info({ id, userWallet: cfg.userWallet }, "Config is inactive — skipping");
      results.push({ id, userWallet: cfg.userWallet, status: "skipped" });
      continue;
    }

    try {
      log.info(
        { id, userWallet: cfg.userWallet, amountUsdc: cfg.amountUsdc, protocol: cfg.protocol },
        "Executing scheduled deposit",
      );

      const result = await depositJupiterLend(BigInt(cfg.amountUsdc));

      await markExecuted(id, now);

      log.info(
        { id, userWallet: cfg.userWallet, signature: result.signature },
        "Scheduled deposit succeeded",
      );

      results.push({ id, userWallet: cfg.userWallet, status: "success", signature: result.signature });
    } catch (err: any) {
      log.error(
        { id, userWallet: cfg.userWallet, err: err.message },
        "Scheduled deposit failed — config nextRunAt not advanced",
      );
      results.push({ id, userWallet: cfg.userWallet, status: "failed", error: err.message });
    }
  }

  return results;
}
