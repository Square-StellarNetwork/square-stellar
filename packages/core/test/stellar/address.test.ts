import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addressField, addressKind, InvalidAddressError, isAccountAddress, isContractAddress, isStellarAddress } from "../../src/stellar/index.js";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

describe("strkeys", () => {
  it("tell accounts and contracts apart", () => {
    expect(isAccountAddress(ISSUER)).toBe(true);
    expect(isContractAddress(ISSUER)).toBe(false);
    expect(isContractAddress(SAC)).toBe(true);
    expect(isAccountAddress(SAC)).toBe(false);
    expect(addressKind(ISSUER)).toBe("account");
    expect(addressKind(SAC)).toBe("contract");
  });

  it("refuse a muxed account, a lower-cased key and an EVM address", () => {
    const muxed = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAAAA";
    expect(isStellarAddress(muxed)).toBe(false);
    expect(isStellarAddress(ISSUER.toLowerCase())).toBe(false);
    expect(isStellarAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e")).toBe(false);
    expect(() => addressKind(muxed, "recipient")).toThrow(InvalidAddressError);
    expect(() => addressKind(muxed, "recipient")).toThrow(/recipient/);
  });
});

/**
 * The four vectors of docs/decisions/address-field-mapping.md, and the
 * probe's vectors.json when the workspace holding it is checked out: the
 * contract computes the same bytes from the same addresses.
 */
describe("f, the circuit's field element for an address", () => {
  const vectors = [
    ["usdc_issuer_testnet", ISSUER, "0038622f1b6bed4428f007d87a0699c11bd471da6079d3bd54389565e67ca04c"],
    ["usdc_sac_testnet", SAC, "00f3f621aaa28a2f21130f183b450020ee2016bb79edd9fdaf15bf5ecba4f002"],
    ["usdc_issuer_pubnet", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", "0057eb773202bd4b5e3528a821ff15a929aa379bf9b7e2943818c97ba7416e9a"],
    ["usdc_sac_pubnet", "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", "006dab8a377286236a25f018858be3b5d64045f87af64269d10dac584f6cf5ef"],
  ] as const;

  it.each(vectors)("%s", (_name, address, signal) => {
    const field = addressField(address);
    expect(field.hex).toBe(`0x${signal}`);
    expect(Buffer.from(field.bytes).toString("hex")).toBe(signal);
    expect(field.value).toBe(BigInt(`0x${signal}`));
    expect(field.bytes[0]).toBe(0);
  });

  it("stays under the BN254 scalar field, so the verifier never sees a reduction", () => {
    const r = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    for (const [, address] of vectors) expect(addressField(address).value).toBeLessThan(r);
  });

  it("refuses anything but an address", () => {
    expect(() => addressField("MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAAAA")).toThrow(InvalidAddressError);
  });

  const probeVectors = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "contracts", "probes", "address_field_probe", "vectors.json");

  it.skipIf(!existsSync(probeVectors))("agrees with the probe's vectors.json, which the contract is tested against", () => {
    const file = JSON.parse(readFileSync(probeVectors, "utf8")) as { vectors: Array<{ name: string; address: string; signal: string; decimal: string }> };
    expect(file.vectors.length).toBeGreaterThan(0);
    for (const vector of file.vectors) {
      const field = addressField(vector.address);
      expect(Buffer.from(field.bytes).toString("hex")).toBe(vector.signal);
      expect(field.value.toString()).toBe(vector.decimal);
    }
  });
});
