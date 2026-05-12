import Redis from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, { lazyConnect: false });

// --- Types ---

export type Frequency = "daily" | "weekly" | "monthly";
export type SavingsStrategy = "reflect" | "jupiter";

export type UserSettings = {
  /** Original savings setup chosen by the user */
  savingsFrequency: Frequency;
  savingsAmountUsd: number;
  savingsStrategy: SavingsStrategy;
  /** SPL Approve signature granting the keeper delegate rights on the user's USDC ATA */
  delegationTxSignature: string;
  /** ISO timestamp when the delegation was set */
  delegationSetAt: string;
  /** Funding config — what the keeper actually pulls each cycle */
  fundingFrequency: Frequency;
  fundingAmountUsd: number;
  /** ISO timestamp when the funding flow was confirmed by the user */
  fundingConfiguredAt: string;
  /** ISO timestamp of the last successful keeper-driven deposit (added by us) */
  lastRunAt?: string;
};

export type UserWallet = {
  walletType?: string;
  walletId: string;
  /** Privy-managed signer wallet — the user's transaction-signing identity */
  walletAddress: string;
  /** Squads multisig vault — destination for keeper-driven yield deposits, if set */
  vaultAddress?: string;
  privyUserId: string;
};

/**
 * Resolve the on-chain recipient for the user's yield tokens.
 * Prefers the Squads vault; falls back to the Privy signer wallet if the vault is unset.
 */
export function getDepositRecipient(wallet: UserWallet): string {
  return wallet.vaultAddress ?? wallet.walletAddress;
}

export type SavingsTxLog = {
  /** Deposit transaction signature (USDC → Jupiter Lend) */
  depositSignature: string;
  /** Transfer transaction signature (jlUSDC → recipient). Absent if status is "partial". */
  transferSignature?: string;
  /** ISO timestamp when the keeper recorded this transaction */
  timestamp: string;
  /** Address that received the yield tokens (Squads vault if available, else Privy signer) */
  recipientAddress: string;
  /** Privy signer wallet of the user — for cross-reference with `wallet:telegram:<id>` */
  signerWallet: string;
  /** USD value as configured by the user */
  amountUsd: number;
  /** Raw USDC units deposited (6 decimals) */
  amountUsdcRaw: string;
  /** Raw jlUSDC shares minted by Jupiter Lend on this deposit */
  jlUsdcReceived: string;
  /** Yield platform used */
  platform: "jupiter" | "reflect";
  /** "success" = full flow; "partial" = deposit confirmed but transfer to user failed */
  status: "success" | "partial";
  /** Error message — only set when status is "partial" */
  error?: string;
};

// --- Key helpers ---

const settingsKey = (telegramId: string) => `settings:telegram:${telegramId}`;
const walletKey = (telegramId: string) => `wallet:telegram:${telegramId}`;
const txLogKey = (telegramId: string) => `savings:tx:telegram:${telegramId}`;

// --- Frequency → ms ---

const FREQUENCY_MS: Record<Frequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

// --- Reads ---

/**
 * List every Telegram user in the system, enumerated by `wallet:telegram:*`.
 * Wallets are the canonical "user exists" marker — settings may or may not exist.
 *
 * NOTE: ignores `settings:pending:telegram:*` (drafts) by deriving the ID from wallets.
 */
export async function getAllTelegramIds(): Promise<string[]> {
  const keys = await redis.keys("wallet:telegram:*");
  return keys.map((k) => k.replace("wallet:telegram:", ""));
}

export async function getUserSettings(telegramId: string): Promise<UserSettings | null> {
  const raw = await redis.get(settingsKey(telegramId));
  return raw ? (JSON.parse(raw) as UserSettings) : null;
}

export async function getUserWallet(telegramId: string): Promise<UserWallet | null> {
  const raw = await redis.get(walletKey(telegramId));
  return raw ? (JSON.parse(raw) as UserWallet) : null;
}

// --- Writes ---

/** Persist the last-run timestamp by merging into the existing settings JSON. */
export async function setLastRunAt(
  telegramId: string,
  when: Date = new Date(),
): Promise<void> {
  const settings = await getUserSettings(telegramId);
  if (!settings) return;
  const updated: UserSettings = { ...settings, lastRunAt: when.toISOString() };
  await redis.set(settingsKey(telegramId), JSON.stringify(updated));
}

// --- Scheduling logic ---

/**
 * True if this user is due for another keeper deposit.
 *
 * Reference point: `lastRunAt` if present, otherwise `fundingConfiguredAt`.
 * A user is due once `frequency` has elapsed since that reference.
 */
export function isDue(settings: UserSettings, now: number = Date.now()): boolean {
  const nextDueMs = nextDueAt(settings);
  return nextDueMs !== null && now >= nextDueMs;
}

/**
 * When the user is next due for a deposit, in epoch-ms.
 *
 * - First-ever run (no `lastRunAt`): due immediately at `fundingConfiguredAt`.
 *   The keeper fires the first deposit on the next tick after the user configures.
 * - Subsequent runs: due `fundingFrequency` after the previous `lastRunAt`.
 *
 * Returns null when settings are incomplete (missing timestamps or frequency).
 */
export function nextDueAt(settings: UserSettings): number | null {
  if (!settings.lastRunAt) {
    if (!settings.fundingConfiguredAt) return null;
    const configuredMs = new Date(settings.fundingConfiguredAt).getTime();
    return Number.isNaN(configuredMs) ? null : configuredMs;
  }
  const lastRunMs = new Date(settings.lastRunAt).getTime();
  if (Number.isNaN(lastRunMs)) return null;
  const intervalMs = FREQUENCY_MS[settings.fundingFrequency];
  if (!intervalMs) return null;
  return lastRunMs + intervalMs;
}

/** USD (pegged) → raw USDC units (6 decimals). */
export function usdToRawUsdc(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

// --- Savings transaction log ---

/**
 * Append a transaction record to the user's history.
 * Stored newest-first via LPUSH so `LRANGE 0 N-1` returns the most recent N.
 */
export async function logSavingsTransaction(
  telegramId: string,
  tx: SavingsTxLog,
): Promise<void> {
  await redis.lpush(txLogKey(telegramId), JSON.stringify(tx));
}

/**
 * Read the user's savings transaction history (newest first).
 * Pass `limit = -1` to fetch the entire log.
 */
export async function getSavingsTransactions(
  telegramId: string,
  limit: number = 50,
): Promise<SavingsTxLog[]> {
  const stop = limit === -1 ? -1 : limit - 1;
  const items = await redis.lrange(txLogKey(telegramId), 0, stop);
  return items.map((s) => JSON.parse(s) as SavingsTxLog);
}
