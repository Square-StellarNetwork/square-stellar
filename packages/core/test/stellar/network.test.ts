import { Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  isStellarNetworkId,
  networkFor,
  networkIdOf,
  networks,
  passphraseOf,
  STELLAR_TESTNET_RPC_URL,
  UnknownNetworkError,
  USDC_TESTNET_ISSUER,
  usdcAsset,
} from "../../src/stellar/index.js";

/**
 * The values docs/decisions/stellar-target.md fixes, as that page prints
 * them. The derived ones (the SAC ids) are asserted against the page's
 * figures, which it got from `stellar contract id asset` and from
 * `@x402/stellar`; two independent derivations agreeing is the point.
 */
describe("the testnet profile", () => {
  const testnet = networkFor("stellar:testnet");

  it("is the one the decision record fixes", () => {
    expect(testnet.networkPassphrase).toBe("Test SDF Network ; September 2015");
    expect(testnet.caip2).toBe("stellar:testnet");
    expect(testnet.rpcUrl).toBe(STELLAR_TESTNET_RPC_URL);
    expect(testnet.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(testnet.friendbotUrl).toBe("https://friendbot.stellar.org");
    expect(testnet.explorerUrl).toBe("https://stellar.expert/explorer/testnet");
  });

  it("derives Circle's USDC SAC from the issuer, landing on the id the record lists", () => {
    expect(testnet.usdc).toEqual({
      code: "USDC",
      issuer: USDC_TESTNET_ISSUER,
      contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      decimals: 7,
    });
  });

  it("derives the pubnet SAC the same way, as the record lists it", () => {
    expect(usdcAsset("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", Networks.PUBLIC).contractId).toBe(
      "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    );
  });
});

describe("the local profile", () => {
  const local = networkFor("stellar:local");

  it("is quickstart --local, with no CAIP-2 id, no explorer and no fixed USDC", () => {
    expect(local.networkPassphrase).toBe("Standalone Network ; February 2017");
    expect(local.caip2).toBeUndefined();
    expect(local.rpcUrl).toBe("http://localhost:8000/rpc");
    expect(local.horizonUrl).toBe("http://localhost:8000");
    expect(local.friendbotUrl).toBe("http://localhost:8000/friendbot");
    expect(local.explorerUrl).toBeUndefined();
    expect(local.usdc).toBeUndefined();
  });
});

describe("lookups", () => {
  it("find a profile by id and by passphrase", () => {
    expect(networkFor(Networks.TESTNET)).toBe(networks["stellar:testnet"]);
    expect(networkFor(Networks.STANDALONE)).toBe(networks["stellar:local"]);
  });

  it("name pubnet but hold no profile for it", () => {
    expect(networkIdOf(Networks.PUBLIC)).toBe("stellar:pubnet");
    expect(passphraseOf("stellar:pubnet")).toBe(Networks.PUBLIC);
    expect(() => networkFor("stellar:pubnet")).toThrow(UnknownNetworkError);
  });

  it("refuse what they do not know", () => {
    expect(networkIdOf("Test SDF Future Network ; October 2022")).toBeUndefined();
    expect(() => networkFor("stellar:futurenet")).toThrow(UnknownNetworkError);
    expect(isStellarNetworkId("stellar:testnet")).toBe(true);
    expect(isStellarNetworkId("eip155:1")).toBe(false);
    expect(isStellarNetworkId(undefined)).toBe(false);
  });
});
