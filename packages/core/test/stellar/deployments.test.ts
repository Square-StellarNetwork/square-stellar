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
  nativeToken,
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
const XLM = nativeToken(Networks.TESTNET);

/** The MVP record: the kernel, paid in XLM. */
const mvp = {
  network: "stellar:testnet",
  networkPassphrase: Networks.TESTNET,
  ledger: 4760307,
  contracts: { square_job: ids.square_job },
  token: { code: "XLM", contractId: XLM.contractId },
};

/** The full record: every contract, USDC as the token, the registries. */
const record = {
  ...mvp,
  contracts: { ...ids },
  token: { code: "USDC", issuer: USDC_ISSUER, contractId: USDC_SAC, decimals: 7 },
  usdc: { issuer: USDC_ISSUER, contractId: USDC_SAC, decimals: 7 },
  registries: { identity: contractIdFor(20), reputation: contractIdFor(21), validation: contractIdFor(22) },
};

describe("deploymentFromJson", () => {
  it("reads the MVP record: the kernel and native XLM, nothing else required", () => {
    expect(deploymentFromJson(mvp)).toEqual({
      network: "stellar:testnet",
      networkPassphrase: Networks.TESTNET,
      squareJob: ids.square_job,
      token: { code: "XLM", issuer: undefined, contractId: XLM.contractId, decimals: 7, native: true },
      deployLedger: 4760307,
    });
    expect(XLM.contractId).toBe(Asset.native().contractId(Networks.TESTNET));
    // The token's id may be left for the reader to derive.
    expect(deploymentFromJson({ ...mvp, token: { code: "XLM" } }).token).toEqual(XLM);
  });

  it("reads a full record into the deployment shape", () => {
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
      token: { code: "USDC", issuer: USDC_ISSUER, contractId: USDC_SAC, decimals: 7, native: false },
      usdc: { code: "USDC", issuer: USDC_ISSUER, contractId: USDC_SAC, decimals: 7 },
      identityRegistry: record.registries.identity,
      reputationRegistry: record.registries.reputation,
      validationRegistry: record.registries.validation,
      deployLedger: 4760307,
    });
  });

  it("lets any contract but the kernel, USDC and the registries be absent", () => {
    const { compliance_module: _m, groth16_verifier: _v, screening_registry: _s, ...rest } = ids;
    const deployment = deploymentFromJson({ ...record, contracts: rest, ledger: undefined, usdc: undefined, registries: { identity: record.registries.identity } });
    expect(deployment.complianceModule).toBeUndefined();
    expect(deployment.groth16Verifier).toBeUndefined();
    expect(deployment.screeningRegistry).toBeUndefined();
    expect(deployment.deployLedger).toBeUndefined();
    expect(deployment.usdc).toBeUndefined();
    expect(deployment.reputationRegistry).toBeUndefined();
    expect(deployment.identityRegistry).toBe(record.registries.identity);
    expect(contractIdOf(deployment, "compliance_module")).toBeUndefined();
    expect(contractIdOf(deployment, "usdc")).toBeUndefined();
  });

  it.each([
    ["a missing kernel", { ...mvp, contracts: {} }, /contracts\.square_job/],
    ["an account where a contract id belongs", { ...record, contracts: { ...ids, square_hook: USDC_ISSUER } }, /contracts\.square_hook/],
    ["a network it does not know", { ...mvp, network: "eip155:5042002" }, /network/],
    ["a passphrase that is not the network's", { ...mvp, networkPassphrase: Networks.PUBLIC }, /networkPassphrase/],
    ["a missing token", { ...mvp, token: undefined }, /token is missing/],
    ["a token id that is not the asset's SAC", { ...mvp, token: { code: "XLM", contractId: USDC_SAC } }, /token\.contractId/],
    ["an issued token without its issuer", { ...mvp, token: { code: "USDC" } }, /token\.issuer/],
    ["an issued token whose id is another asset's", { ...mvp, token: { code: "USDC", issuer: USDC_ISSUER, contractId: XLM.contractId } }, /token\.contractId/],
    ["a token code that is not one", { ...mvp, token: { code: "not an asset code" } }, /token\.code/],
    ["a USDC id that is not the issuer's SAC", { ...record, usdc: { issuer: USDC_ISSUER, contractId: ids.square_job } }, /usdc\.contractId/],
    ["another issuer on testnet, where USDC is Circle's", { ...record, usdc: { issuer: Keypair.random().publicKey(), contractId: USDC_SAC } }, /usdc/],
    ["six decimals", { ...record, usdc: { ...record.usdc, decimals: 6 } }, /decimals/],
    ["a registry that is not a contract", { ...record, registries: { identity: USDC_ISSUER } }, /registries\.identity/],
    ["a ledger that is not a sequence", { ...mvp, ledger: -1 }, /ledger/],
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
      token: { code: "XLM", contractId: Asset.native().contractId(Networks.STANDALONE) },
      usdc: { issuer, contractId: new Asset("USDC", issuer).contractId(Networks.STANDALONE) },
    });
    expect(local.network).toBe("stellar:local");
    expect(local.usdc?.issuer).toBe(issuer);
    expect(local.token.native).toBe(true);
  });

  it("names every contract by id, the payment token among them", () => {
    const deployment = deploymentFromJson(record);
    const byId = contractsOf(deployment);
    // USDC is the token here, so its one id is named `token`.
    expect(byId.size).toBe(SQUARE_CONTRACTS.length + 1);
    expect(byId.get(ids.square_job)).toBe("square_job");
    expect(byId.get(USDC_SAC)).toBe("token");
    expect(contractIdOf(deployment, "token")).toBe(USDC_SAC);
    expect(contractIdOf(deployment, "usdc")).toBe(USDC_SAC);
    expect(contractIdOf(deployment, "keeper_evaluator")).toBe(ids.keeper_evaluator);

    const xlm = deploymentFromJson({ ...record, token: mvp.token });
    expect(contractsOf(xlm).get(XLM.contractId)).toBe("token");
    expect(contractsOf(xlm).get(USDC_SAC)).toBe("usdc");
    expect(contractsOf(deploymentFromJson(mvp)).size).toBe(2);
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
