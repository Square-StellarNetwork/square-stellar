import { hash, Keypair, xdr } from "@stellar/stellar-sdk";
import { KeypairSigner, type SignAuthEntry, type Signer as SdkSigner, type SignTransaction } from "@stellar/stellar-sdk/contract";

/**
 * What a write needs: an address and the two SEP-43 signing callbacks, as
 * `@stellar/stellar-sdk/contract` defines them. A `Keypair` in a service or the
 * CLI, a Stellar Wallets Kit connection in the app (#39) and a smart-account
 * signer (#27) all fit; `keypairSigner` makes the first, the others wrap what
 * their kit hands them and add `address`.
 *
 * `signAuthEntry` is only needed when the signer is not the account that
 * submits the transaction (fee sponsorship, #27): a signer that submits its
 * own transactions authorizes through the envelope signature alone.
 */
export type Signer = SdkSigner & {
  /**
   * The network the signer is bound to, when it is bound to one, as
   * `keypairSigner`'s is. A client checks it against its deployment at
   * construction (`DeploymentNetworkMismatchError`, source `declared`).
   */
  readonly networkPassphrase?: string;
};
export type { SignAuthEntry, SignTransaction };

export class WalletRequiredError extends Error {
  constructor() {
    super("this operation sends a transaction and needs a signer");
    this.name = "WalletRequiredError";
  }
}

/**
 * The signer was asked to sign for a network it is not bound to. A signer is
 * made for one network so that a client or a wallet pointed at the wrong one
 * cannot borrow a testnet key for pubnet, or the reverse.
 */
export class SignerNetworkMismatchError extends Error {
  constructor(
    readonly signerPassphrase: string,
    readonly requestedPassphrase: string,
  ) {
    super(`the signer is bound to "${signerPassphrase}" and was asked to sign for "${requestedPassphrase}"`);
    this.name = "SignerNetworkMismatchError";
  }
}

/** sha256 of the passphrase: the network id an auth entry preimage carries. */
export function networkIdHash(passphrase: string): Buffer {
  return hash(Buffer.from(passphrase, "utf8"));
}

/**
 * A `Signer` over a local `Keypair`, bound to one network. It refuses a
 * transaction whose caller names another passphrase, and an auth entry whose
 * preimage carries another network id; the SDK's own `KeypairSigner` would
 * sign both. The secret never leaves the keypair.
 */
export function keypairSigner(keypair: Keypair, networkPassphrase: string): Signer {
  const inner = new KeypairSigner(keypair, networkPassphrase);
  const networkId = networkIdHash(networkPassphrase);
  return {
    address: keypair.publicKey(),
    networkPassphrase,
    signTransaction: async (transactionXdr, opts) => {
      if (opts?.networkPassphrase !== undefined && opts.networkPassphrase !== networkPassphrase) {
        throw new SignerNetworkMismatchError(networkPassphrase, opts.networkPassphrase);
      }
      return inner.signTransaction(transactionXdr, { ...opts, networkPassphrase });
    },
    signAuthEntry: async (preimageXdr, opts) => {
      if (opts?.networkPassphrase !== undefined && opts.networkPassphrase !== networkPassphrase) {
        throw new SignerNetworkMismatchError(networkPassphrase, opts.networkPassphrase);
      }
      const preimage = xdr.HashIdPreimage.fromXDR(preimageXdr, "base64");
      if (preimage.switch() !== xdr.EnvelopeType.envelopeTypeSorobanAuthorization()) {
        throw new Error(`refusing to sign a ${preimage.switch().name} preimage as an authorization entry`);
      }
      const carried = preimage.sorobanAuthorization().networkId();
      if (!carried.equals(networkId)) {
        throw new SignerNetworkMismatchError(networkPassphrase, `network id ${carried.toString("hex")}`);
      }
      return inner.signAuthEntry(preimageXdr, opts);
    },
  };
}
