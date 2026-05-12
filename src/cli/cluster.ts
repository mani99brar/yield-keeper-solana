import { config } from "../config.js";

console.log(`Cluster : ${config.cluster}`);
console.log(`RPC URL : ${config.rpcUrl}`);
console.log(`Keeper  : ${config.keeperKeypairPath}`);
console.log(`Redis   : ${config.redisUrl.replace(/:[^:@]+@/, ":<redacted>@")}`);
