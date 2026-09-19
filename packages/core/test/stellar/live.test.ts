import { Keypair, nativeToScVal, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  connectSquareClient,
  formatXlm,
  keypairSigner,
  networkFor,
  SquareContractError,
  TrustlineMissingError,
  type SquareDeployment,
} from "../../src/stellar/index.js";

/**
 * The client against Stellar testnet itself, with `STELLAR_LIVE=1`: the
 * endpoint check, a read of the USDC SAC, a refusal decoded, and one real
 * write, `trust`, from an account made for this run and funded by Friendbot.
 * Its secret lives only in this process. No Square contract is deployed yet,
 * so the deployment names the USDC SAC and placeholder ids for the rest.
 */
const live = process.env["STELLAR_LIVE"] === "1";
const testnet = networkFor("stellar:testnet");
const placeholder = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));

const deployment: SquareDeployment = {
  network: "stellar:testnet",
  networkPassphrase: testnet.networkPassphrase,
  squareJob: placeholder(1),
  keeperEvaluator: placeholder(2),
  arbitration: placeholder(3),
  claimMarket: placeholder(4),
  squareHook: placeholder(5),
  policyRegistry: placeholder(6),
  usdc: testnet.usdc!,
  identityRegistry: placeholder(7),
  reputationRegistry: placeholder(8),
  validationRegistry: placeholder(9),
};

describe.skipIf(!live)("Stellar testnet", () => {
  const keypair = Keypair.random();

  it("is the network the deployment is for, and reads the USDC SAC", async () => {
    const square = await connectSquareClient({ deployment });
    expect(await square.latestLedger()).toBeGreaterThan(4_760_000);
    expect(await square.read({ contract: "usdc", method: "decimals" })).toBe(7);
    expect(await square.read({ contract: "usdc", method: "symbol" })).toBe("USDC");
    expect(await square.read({ contract: "usdc", method: "name" })).toBe(`USDC:${testnet.usdc!.issuer}`);
  });

  it("decodes the SAC's refusal of a balance read for an account with no trustline", async () => {
    const square = await connectSquareClient({ deployment });
    const error = await square.read({ contract: "usdc", method: "balance", args: [nativeToScVal(keypair.publicKey(), { type: "address" })] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SquareContractError);
    expect((error as SquareContractError).errorName).toBe("TrustlineMissingError");
    expect((error as SquareContractError).raisedBy).toBe("usdc");
  });

  it("opens a USDC trustline for a fresh account with one signed invocation", async () => {
    const funded = await fetch(`${testnet.friendbotUrl}/?addr=${keypair.publicKey()}`);
    expect(funded.ok).toBe(true);
    const square = await connectSquareClient({ deployment, signer: keypairSigner(keypair, testnet.networkPassphrase) });

    expect(await square.usdcTrustline(keypair.publicKey())).toEqual({ status: "missing" });
    await expect(square.assertUsdcReceivable(keypair.publicKey())).rejects.toThrow(TrustlineMissingError);
    expect(await square.usdcBalance(keypair.publicKey())).toBe(0n);

    const result = await square.trustUsdc();
    expect(result).not.toBeNull();
    expect(result!.ledger).toBeGreaterThan(0);
    expect(result!.feeCharged).toBeGreaterThan(0n);
    expect(result!.events).toEqual([]);
    console.info(`trust: tx ${result!.hash} ledger ${result!.ledger} fee ${formatXlm(result!.feeCharged)} XLM ${testnet.explorerUrl}/tx/${result!.hash}`);

    expect(await square.usdcTrustline(keypair.publicKey())).toMatchObject({ status: "open", balance: 0n, authorized: true });
    await expect(square.assertUsdcReceivable(keypair.publicKey())).resolves.toBeUndefined();
    expect(await square.read({ contract: "usdc", method: "balance", args: [nativeToScVal(keypair.publicKey(), { type: "address" })] })).toBe(0n);
    expect(await square.getTransaction(result!.hash)).toMatchObject({ hash: result!.hash, ledger: result!.ledger });
  }, 120_000);
});
