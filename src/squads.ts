import * as multisig from "@sqds/multisig";
import { Keypair, PublicKey } from "@solana/web3.js";
import { connection } from "./connection.js";
import { loadWallet } from "./wallet.js";
import { log } from "./logger.js";
import { explorerTxUrl } from "./config.js";

export type CreateWalletResult = {
  /** The Squads multisig account address — reference this for all future multisig operations */
  multisigPda: PublicKey;
  /** The default vault PDA (index 0) — this is where SOL and tokens are actually held */
  vaultPda: PublicKey;
  /** The ephemeral createKey public key — save this if you ever need to re-derive multisigPda */
  createKey: PublicKey;
  signature: string;
};

/**
 * Deploy a new Squads v4 multisig (smart wallet) on-chain.
 *
 * The keeper wallet pays the creation fee and rent. The provided `memberAddress`
 * is set as the sole member with full permissions and a threshold of 1.
 *
 * @param memberAddress - The public key that will own and control the multisig
 */
export async function createSquadsWallet(
  memberAddress: PublicKey,
): Promise<CreateWalletResult> {
  const wallet = await loadWallet();

  // Fresh ephemeral keypair — its public key is the seed for the multisig PDA.
  // Only the public key needs to be saved after creation; the private key is not reused.
  const createKeyKeypair = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKeyKeypair.publicKey,
  });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  // Fetch the Squads program config to get the treasury address (required by the instruction).
  const [programConfigPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda,
  );

  log.info(
    {
      member: memberAddress.toBase58(),
      multisigPda: multisigPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
      creator: wallet.address,
      treasury: programConfig.treasury.toBase58(),
    },
    "Creating Squads multisig",
  );

  const signature = await multisig.rpc.multisigCreateV2({
    connection,
    treasury: programConfig.treasury,
    createKey: createKeyKeypair,
    creator: wallet.keypair,
    multisigPda,
    configAuthority: null,
    timeLock: 0,
    members: [
      {
        key: memberAddress,
        permissions: multisig.types.Permissions.all(),
      },
    ],
    threshold: 1,
    rentCollector: null,
  });

  log.info(
    {
      signature,
      multisigPda: multisigPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
      explorer: explorerTxUrl(signature),
      squadsUrl: `https://app.squads.so/squads/${multisigPda.toBase58()}/treasury/${vaultPda.toBase58()}`,
    },
    "Squads multisig created",
  );

  return {
    multisigPda,
    vaultPda,
    createKey: createKeyKeypair.publicKey,
    signature,
  };
}
