import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export type Cluster = "devnet" | "mainnet-beta";

const CLUSTER_DEFAULT_RPC: Record<Cluster, string> = {
  devnet: "https://api.devnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

const cluster = ((process.env.CLUSTER ?? "devnet") as Cluster);
if (cluster !== "devnet" && cluster !== "mainnet-beta") {
  throw new Error(`Invalid CLUSTER "${cluster}" — must be "devnet" or "mainnet-beta"`);
}

export const config = {
  cluster,
  /** Custom RPC if set, otherwise the public endpoint for the chosen cluster. */
  rpcUrl: process.env.RPC_URL ?? CLUSTER_DEFAULT_RPC[cluster],
  keeperKeypairPath: path.resolve(required("KEEPER_KEYPAIR_PATH")),
  logLevel: process.env.LOG_LEVEL ?? "info",
  redisUrl: required("REDIS_URL"),
  /** Telegram bot token for sending notifications. Optional — notifications are skipped if absent. */
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
};

/**
 * Build a Solana Explorer URL pointing at the active cluster.
 * Mainnet uses the default explorer view; devnet appends `?cluster=devnet`.
 */
export function explorerTxUrl(signature: string): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  return config.cluster === "devnet" ? `${base}?cluster=devnet` : base;
}

export function loadKeypairBytes(): Uint8Array {
  const raw = readFileSync(config.keeperKeypairPath, "utf-8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(
      `Keypair file ${config.keeperKeypairPath} is not a valid Solana keypair JSON (expected 64-byte array)`,
    );
  }
  return new Uint8Array(arr);
}
