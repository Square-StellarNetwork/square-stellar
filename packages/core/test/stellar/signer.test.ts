import { Account, Address, Keypair, Networks, Operation, TransactionBuilder, hash, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { keypairSigner, networkIdHash, SignerNetworkMismatchError } from "../../src/stellar/index.js";

const keypair = Keypair.random();
const signer = keypairSigner(keypair, Networks.TESTNET);

function unsignedTransaction(): string {
  return new TransactionBuilder(new Account(keypair.publicKey(), "7"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeContractFunction({ contract: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", function: "decimals", args: [] }))
    .setTimeout(60)
    .build()
    .toXDR();
}

function authPreimage(passphrase: string): string {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA").toScAddress(),
        functionName: "trust",
        args: [nativeToScVal(keypair.publicKey(), { type: "address" })],
      }),
    ),
    subInvocations: [],
  });
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: networkIdHash(passphrase),
      nonce: xdr.Int64.fromString("1"),
      signatureExpirationLedger: 100,
      invocation,
    }),
  ).toXDR("base64");
}

describe("keypairSigner", () => {
  it("is the keypair's address, bound to its network", () => {
    expect(signer.address).toBe(keypair.publicKey());
    expect(signer.networkPassphrase).toBe(Networks.TESTNET);
  });

  it("signs a transaction for its network with the keypair", async () => {
    const { signedTxXdr, signerAddress } = await signer.signTransaction(unsignedTransaction(), { networkPassphrase: Networks.TESTNET });
    expect(signerAddress).toBe(keypair.publicKey());
    const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
    expect(signed.signatures).toHaveLength(1);
    expect(keypair.verify(signed.hash(), signed.signatures[0]!.signature())).toBe(true);
  });

  it("signs for its own network when the caller names none", async () => {
    const { signedTxXdr } = await signer.signTransaction(unsignedTransaction());
    const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
    expect(keypair.verify(signed.hash(), signed.signatures[0]!.signature())).toBe(true);
  });

  it("refuses to sign a transaction for another network", async () => {
    await expect(signer.signTransaction(unsignedTransaction(), { networkPassphrase: Networks.PUBLIC })).rejects.toThrow(SignerNetworkMismatchError);
  });

  it("signs an authorization entry whose preimage carries its network id", async () => {
    const preimage = authPreimage(Networks.TESTNET);
    const { signedAuthEntry, signerAddress } = await signer.signAuthEntry!(preimage, { networkPassphrase: Networks.TESTNET });
    expect(signerAddress).toBe(keypair.publicKey());
    expect(keypair.verify(hash(Buffer.from(preimage, "base64")), Buffer.from(signedAuthEntry, "base64"))).toBe(true);
  });

  it("refuses an authorization entry for another network, whatever the caller claims", async () => {
    await expect(signer.signAuthEntry!(authPreimage(Networks.PUBLIC), { networkPassphrase: Networks.TESTNET })).rejects.toThrow(SignerNetworkMismatchError);
    await expect(signer.signAuthEntry!(authPreimage(Networks.TESTNET), { networkPassphrase: Networks.PUBLIC })).rejects.toThrow(SignerNetworkMismatchError);
  });

  it("refuses a preimage that is not an authorization entry", async () => {
    const other = xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({
        networkId: networkIdHash(Networks.TESTNET),
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(xdr.Asset.assetTypeNative()),
      }),
    ).toXDR("base64");
    await expect(signer.signAuthEntry!(other)).rejects.toThrow(/not.*authorization|refusing/);
  });
});
