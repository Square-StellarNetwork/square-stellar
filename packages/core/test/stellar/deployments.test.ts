import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  contractIdOf,
  contractsOf,
  deploymentFileName,
  deploymentFor,
  deploymentFromJson,
  deployments,
  InvalidDeploymentError,
  SQUARE_CONTRACTS,
  UnknownDeploymentError,
  type StellarNetworkId,
} from "../../src/stellar/index.js";

/** Nine distinct, valid contract ids, made rather than copied from anywhere. */
const ids = Object.fromEntries(SQUARE_CONTRACTS.map((name, index) => [name, contractIdFor(index)])) as Record<(typeof SQUARE_CONTRACTS)[number], string>;

function contractIdFor(index: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, index + 1));
}

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const record = {
  network: "stellar:testnet",
  networkPassphrase: Networks.TESTNET,
  ledger: 4760307,
  contracts: { ...ids },
  usdc: { issuer: USDC_ISSUER, contractId: USDC_SAC, decimals: 7 },
  registries: { identity: contractIdFor(20), reputation: contractIdFor(21), validation: contractIdFor(22) },
};

describe("deploymentFromJson", () => {
  it("reads a record into the deployment shape", () => {
    const deployment = deploymentFromJson(record);
    expect(deployment).toEqual({
      network: "stellar:testnet",
      networkPassphrase: Networks.TESTNET,
      squareJob: ids.square_job,
      keeperEvaluator: ids.keeper_evaluator,
      arbitration: ids.arbitration,
      claimMarket: ids.claim_market,
      squareHook: ids.square_hook,
      policyRegistry: ids.policy_registry,
      complianceModule: ids.compliance_module,
      screeningRegistry: ids.screening_registry,
      groth16Verifier: ids.groth16_verifier,
      usdc: { code: "USDC", issuer: USDC_ISSUER, contractId: USDC_SAC, decimals: 7 },
      identityRegistry: record.registries.identity,
      reputationRegistry: record.registries.reputation,
      validationRegistry: record.registries.validation,
      deployLedger: 4760307,
    });
  });

  it("lets the compliance slot, its verifier and the screening registry be absent", () => {
    const { compliance_module: _m, groth16_verifier: _v, screening_registry: _s, ...required } = ids;
    const deployment = deploymentFromJson({ ...record, contracts: required, ledger: undefined });
    expect(deployment.complianceModule).toBeUndefined();
    expect(deployment.groth16Verifier).toBeUndefined();
    expect(deployment.screeningRegistry).toBeUndefined();
    expect(deployment.deployLedger).toBeUndefined();
    expect(contractIdOf(deployment, "compliance_module")).toBeUndefined();
  });

  it.each([
    ["a missing kernel", { ...record, contracts: { ...ids, square_job: undefined } }, /contracts\.square_job/],
    ["an account where a contract id belongs", { ...record, contracts: { ...ids, square_hook: USDC_ISSUER } }, /contracts\.square_hook/],
    ["a network it does not know", { ...record, network: "eip155:5042002" }, /network/],
    ["a passphrase that is not the network's", { ...record, networkPassphrase: Networks.PUBLIC }, /networkPassphrase/],
    ["a USDC id that is not the issuer's SAC", { ...record, usdc: { issuer: USDC_ISSUER, contractId: ids.square_job } }, /usdc\.contractId/],
    ["another issuer on testnet, where USDC is Circle's", { ...record, usdc: { issuer: Keypair.random().publicKey(), contractId: USDC_SAC } }, /usdc/],
    ["six decimals", { ...record, usdc: { ...record.usdc, decimals: 6 } }, /decimals/],
    ["a missing registry", { ...record, registries: { identity: record.registries.identity } }, /registries\.reputation/],
    ["a ledger that is not a sequence", { ...record, ledger: -1 }, /ledger/],
    ["not an object", "stellar:testnet", /not an object/],
  ])("refuses %s", (_what, json, message) => {
    expect(() => deploymentFromJson(json)).toThrow(InvalidDeploymentError);
    expect(() => deploymentFromJson(json)).toThrow(message);
  });

  it("accepts a local record with its own USDC issuer, derived on the local passphrase", () => {
    const issuer = Keypair.random().publicKey();
    const local = deploymentFromJson({
      ...record,
      network: "stellar:local",
      networkPassphrase: Networks.STANDALONE,
      usdc: { issuer, contractId: new Asset("USDC", issuer).contractId(Networks.STANDALONE) },
    });
    expect(local.network).toBe("stellar:local");
    expect(local.usdc.issuer).toBe(issuer);
  });

  it("names every contract by id, the payment token among them", () => {
    const deployment = deploymentFromJson(record);
    const byId = contractsOf(deployment);
    expect(byId.size).toBe(SQUARE_CONTRACTS.length + 1);
    expect(byId.get(ids.square_job)).toBe("square_job");
    expect(byId.get(USDC_SAC)).toBe("usdc");
    expect(contractIdOf(deployment, "usdc")).toBe(USDC_SAC);
    expect(contractIdOf(deployment, "keeper_evaluator")).toBe(ids.keeper_evaluator);
  });
});

/**
 * The compiled registry is empty until the stacks are deployed (#43, #45).
 * Whatever it holds has to agree with contracts/deployments/<network>.json,
 * the record the deploy scripts write, the way the EVM copy is checked
 * against its file: a copy nobody compares drifts.
 */
describe("the compiled registry", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const file = (network: StellarNetworkId) => join(repoRoot, "contracts", "deployments", deploymentFileName(network));

  it("names its files after the network", () => {
    expect(deploymentFileName("stellar:testnet")).toBe("testnet.json");
    expect(deploymentFileName("stellar:local")).toBe("local.json");
  });

  it("refuses a network it holds nothing for", () => {
    for (const network of ["stellar:testnet", "stellar:pubnet", "stellar:local"] as const) {
      if (deployments[network]) continue;
      expect(() => deploymentFor(network)).toThrow(UnknownDeploymentError);
    }
  });

  it.each(["stellar:testnet", "stellar:local"] as const)("agrees with %s's record on disk, when both exist", (network) => {
    const compiled = deployments[network];
    const onDisk = existsSync(file(network)) ? deploymentFromJson(JSON.parse(readFileSync(file(network), "utf8"))) : undefined;
    if (compiled === undefined && onDisk === undefined) {
      console.warn(`no compiled deployment and no ${file(network)}: nothing to compare for ${network}`);
      return;
    }
    if (network === "stellar:testnet") {
      // A testnet record is committed; the compiled copy has to follow it.
      expect(compiled).toEqual(onDisk);
      return;
    }
    // A local record is written by a local deploy and gitignored; only when it is there is the copy checked.
    if (onDisk !== undefined) expect(compiled).toEqual(onDisk);
  });
});
