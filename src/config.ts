import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  rpcUrl: required("RPC_URL"),
  cluster: (process.env.CLUSTER ?? "devnet") as "devnet" | "mainnet-beta",
  keeperKeypairPath: path.resolve(required("KEEPER_KEYPAIR_PATH")),
  logLevel: process.env.LOG_LEVEL ?? "info",
  redisUrl: required("REDIS_URL"),
};

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
