import { UsdtPlusStablecoin } from "@reflectmoney/stable.ts";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  fetchAddressesForLookupTables,
  compressTransactionMessageUsingAddressLookupTables,
} from "@solana/kit";
import { rpc, rpcSubscriptions } from "./connection.js";
import { loadWallet } from "./wallet.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

let cachedClient: UsdtPlusStablecoin | null = null;

async function getReflectClient(): Promise<UsdtPlusStablecoin> {
  if (cachedClient) return cachedClient;
  const isDevnet = config.cluster === "devnet";
  const client = new UsdtPlusStablecoin(rpc as any, undefined, isDevnet);
  await client.load();
  cachedClient = client;
  log.info(
    {
      stablecoinMint: client.stablecoinMint!.toString(),
      controller: client.controllerKey!.toString(),
      lookupTable: client.lookupTable.toString(),
    },
    "Reflect SDK loaded",
  );
  return client;
}

export type DepositResult = {
  signature: string;
  usdcDeposited: bigint;
  minReceiptReceive: bigint;
};

/**
 * Deposit USDC from the keeper wallet into Reflect's USDC+ vault.
 *
 * This is the simplest possible deposit path — keeper deposits its OWN USDC
 * and receives USDC+ back into its OWN ATA. To deposit on behalf of a user,
 * we'd extend this to first do an SPL Transfer (using delegate auth) from
 * the user's USDC ATA into the keeper's, then call this. Doing that is the
 * next step once this works.
 *
 * @param amountUsdc Amount of USDC in raw units (6 decimals — 1 USDC = 1_000_000)
 * @param slippageBps Maximum slippage in basis points (100 = 1%). Used to compute minReceiptReceive.
 */
export async function depositUsdcPlus(
  amountUsdc: bigint,
  slippageBps: number = 100,
): Promise<DepositResult> {
  if (amountUsdc <= 0n) throw new Error("amountUsdc must be > 0");
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new Error("slippageBps must be in [0, 10000]");
  }

  const reflect = await getReflectClient();
  const wallet = await loadWallet();

  // Compute minReceiptReceive from slippage. USDC+ is a 1:~1 token (rate ≥ 1.0
  // and slowly increasing), so for a worst-case deposit, the receipt amount
  // is roughly equal to the USDC amount. We accept up to `slippageBps` less.
  const minReceiptReceive =
    (amountUsdc * BigInt(10_000 - slippageBps)) / 10_000n;

  log.info(
    {
      amountUsdc: amountUsdc.toString(),
      minReceiptReceive: minReceiptReceive.toString(),
      slippageBps,
      keeper: wallet.address,
    },
    "Building Reflect mint instruction",
  );
    
    const usdcPlusMintPk = new PublicKey(reflect.stablecoinMint!.toString());
    const ownerPk = new PublicKey(wallet.address);
    const usdcPlusAta = getAssociatedTokenAddressSync(usdcPlusMintPk, ownerPk);

    const ataIxLegacy = createAssociatedTokenAccountIdempotentInstruction(
      ownerPk, // payer
      usdcPlusAta, // ata to create
      ownerPk, // owner
      usdcPlusMintPk, // mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Convert the web3.js instruction into a kit-compatible Instruction.
    // kit Instructions use { programAddress, accounts: [{ address, role }], data }.
    const ataIxKit = {
      programAddress: ataIxLegacy.programId.toBase58() as any,
      accounts: ataIxLegacy.keys.map((k) => ({
        address: k.pubkey.toBase58() as any,
        role: (k.isSigner
          ? k.isWritable
            ? 3
            : 2
          : k.isWritable
          ? 1
          : 0) as any,
      })),
      data: ataIxLegacy.data,
    };

  // Build the mint instruction. Returns one or more kit Instructions
  // including the long list of Drift / Jupiter / Kamino remaining accounts.
  const instructions = await reflect.mint(
    wallet.signer,
    amountUsdc,
    minReceiptReceive,
  );
  log.debug(
    { instructionCount: instructions.length },
    "Reflect SDK returned instructions",
  );

  // Fetch the lookup table — required to fit ~50 accounts in a single tx
  const lookupTables = await fetchAddressesForLookupTables(
    [reflect.lookupTable],
    rpc,
  );

  // Get a recent blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Compose v0 transaction with LUT compression
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(wallet.signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([ataIxKit, ...instructions], m),
    (m) => compressTransactionMessageUsingAddressLookupTables(m, lookupTables),
  );

  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const signature = getSignatureFromTransaction(signedTx);

  // Simulate first so we can show real program logs on failure
  const { getBase64EncodedWireTransaction } = await import("@solana/kit");
  const wireTx = getBase64EncodedWireTransaction(signedTx);
  const sim = await rpc
    .simulateTransaction(wireTx, {
      encoding: "base64",
      replaceRecentBlockhash: false,
      sigVerify: false,
    })
    .send();

  if (sim.value.err) {
    log.error({ err: sim.value.err }, "Simulation failed — program logs:");
    sim.value.logs?.forEach((line) => console.error("  " + line));
    throw new Error(
      `Reflect mint simulation failed: ${sim.value.err.toString()}`,
    );
  }

  log.info(
    { signature, units: sim.value.unitsConsumed },
    "Simulation OK; sending",
  );

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signedTx as any, { commitment: "confirmed" });

  log.info({ signature }, "Deposit confirmed");

  return {
    signature,
    usdcDeposited: amountUsdc,
    minReceiptReceive,
  };
}

/**
 * Read the keeper's USDC+ balance and convert to underlying USDC value
 * using Reflect's current exchange rate.
 *
 * NOTE: this returns shares + a rough USDC value. For an exact "redeem now"
 * value (including any redemption fees), simulate a redeem instead.
 */
export async function getKeeperPosition(): Promise<{
  usdcPlusShares: bigint;
  usdcPlusMint: string;
}> {
  const reflect = await getReflectClient();
  const wallet = await loadWallet();

  // The keeper's USDC+ ATA. We could derive it ourselves, but the SDK
  // already does this via getAta(). We'll just look up via the mint
  // and let the caller fetch the balance with web3.js if they want USD value.
  return {
    usdcPlusShares: 0n, // placeholder — fill in when wiring balance.ts CLI
    usdcPlusMint: reflect.stablecoinMint!.toString(),
  };
}
