import { PublicKey } from "@solana/web3.js";
import { createSquadsWallet } from "../squads.js";
import { log } from "../logger.js";

async function main() {
  const [addressArg] = process.argv.slice(2);

  if (!addressArg) {
    console.error("Usage: yarn squads:create <member-address>");
    console.error("  member-address — public key of the wallet owner/signer");
    process.exit(1);
  }

  let memberAddress: PublicKey;
  try {
    memberAddress = new PublicKey(addressArg);
  } catch {
    console.error(`Invalid public key: ${addressArg}`);
    process.exit(1);
  }

  const result = await createSquadsWallet(memberAddress);

  log.info(
    {
      multisigPda: result.multisigPda.toBase58(),
      vaultPda: result.vaultPda.toBase58(),
      createKey: result.createKey.toBase58(),
      signature: result.signature,
      squadsUrl: `https://app.squads.so/squads/${result.multisigPda.toBase58()}/treasury/${result.vaultPda.toBase58()}`,
    },
    "Done",
  );
}

main().catch((e) => {
  log.error({ err: e.message, stack: e.stack }, "Failed to create Squads wallet");
  process.exit(1);
});
