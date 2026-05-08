import Redis from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, { lazyConnect: false });

// --- Types ---

export type Protocol = "jupiter";

export type SavingsConfig = {
  id: string;
  /** User's Solana wallet address — the beneficiary of the deposit */
  userWallet: string;
  /** Amount of USDC to deposit per execution, in raw units (6 decimals) */
  amountUsdc: string;
  /** Yield protocol to use */
  protocol: Protocol;
  /** How often to run, in seconds (e.g. 86400 = daily, 604800 = weekly) */
  intervalSeconds: number;
  /** Unix timestamp (ms) when this schedule should next execute */
  nextRunAt: number;
  /** Whether this schedule is active */
  active: boolean;
  createdAt: number;
};

// --- Key helpers ---

const configKey = (id: string) => `savings:config:${id}`;
const SCHEDULE_KEY = "savings:schedule";

// --- CRUD ---

export async function getSavingsConfig(id: string): Promise<SavingsConfig | null> {
  const raw = await redis.get(configKey(id));
  return raw ? (JSON.parse(raw) as SavingsConfig) : null;
}

export async function upsertSavingsConfig(cfg: SavingsConfig): Promise<void> {
  await Promise.all([
    redis.set(configKey(cfg.id), JSON.stringify(cfg)),
    redis.zadd(SCHEDULE_KEY, cfg.nextRunAt, cfg.id),
  ]);
}

export async function deleteSavingsConfig(id: string): Promise<void> {
  await Promise.all([
    redis.del(configKey(id)),
    redis.zrem(SCHEDULE_KEY, id),
  ]);
}

/**
 * Return all config IDs whose nextRunAt <= now and are due for execution.
 */
export async function getDueConfigIds(now = Date.now()): Promise<string[]> {
  return redis.zrangebyscore(SCHEDULE_KEY, 0, now);
}

/**
 * Advance nextRunAt by one interval after a successful deposit.
 */
export async function markExecuted(id: string, now = Date.now()): Promise<void> {
  const cfg = await getSavingsConfig(id);
  if (!cfg) return;
  const updated: SavingsConfig = {
    ...cfg,
    nextRunAt: now + cfg.intervalSeconds * 1000,
  };
  await upsertSavingsConfig(updated);
}
