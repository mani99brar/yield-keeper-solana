import { Connection } from "@solana/web3.js";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { config } from "./config.js";

// web3.js (legacy SDK) — needed for SPL Token helpers and balance queries
export const connection = new Connection(config.rpcUrl, "confirmed");

// @solana/kit (newer) — required by Reflect SDK
export const rpc = createSolanaRpc(config.rpcUrl);

// WebSocket URL for kit subscriptions (used during sendAndConfirm)
const wsUrl = config.rpcUrl.replace(/^http/, "ws");
export const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
