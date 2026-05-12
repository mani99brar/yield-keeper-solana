import { runDueDeposits } from "./scheduler.js";
import { log } from "./logger.js";
import { config } from "./config.js";

const POLL_MS = parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS ?? "60000");

async function tick(): Promise<void> {
  try {
    const results = await runDueDeposits();
    if (results.length === 0) return;

    const succeeded = results.filter((r) => r.status === "success").length;
    const partial = results.filter((r) => r.status === "partial").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    log.info(
      { total: results.length, succeeded, partial, failed, skipped },
      "Scheduler tick complete",
    );
  } catch (err: any) {
    log.error({ err: err.message }, "Scheduler tick threw unexpectedly");
  }
}

async function main(): Promise<void> {
  log.info(
    { cluster: config.cluster, rpcUrl: config.rpcUrl, pollIntervalMs: POLL_MS },
    "Reflect keeper scheduler starting",
  );

  await tick();
  setInterval(tick, POLL_MS);
}

main().catch((e) => {
  log.error({ err: e.message, stack: e.stack }, "Service failed to start");
  process.exit(1);
});
