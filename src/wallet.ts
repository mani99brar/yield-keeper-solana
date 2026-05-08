import { Keypair } from "@solana/web3.js";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";
import { loadKeypairBytes } from "./config.js";

export interface Wallet {
  keypair: Keypair;
  address: string;
  signer: KeyPairSigner;
}

export async function loadWallet(): Promise<Wallet> {
  const bytes = loadKeypairBytes();
  const keypair = Keypair.fromSecretKey(bytes);
  const signer = await createKeyPairSignerFromBytes(bytes);
  return {
    keypair,
    address: keypair.publicKey.toBase58(),
    signer,
  };
}
