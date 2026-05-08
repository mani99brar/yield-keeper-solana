import { runDueDeposits } from "../scheduler.js";
import { log } from "../logger.js";

async function main() {
  log.info("Starting scheduled deposit run");

  const results = await runDueDeposits();

  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  log.info({ total: results.length, succeeded, failed, skipped }, "Scheduled run complete");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  log.error({ err: e.message, stack: e.stack }, "Scheduler crashed");
  process.exit(1);
});
