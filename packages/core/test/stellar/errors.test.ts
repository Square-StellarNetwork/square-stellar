import { rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  contractErrorCodeIn,
  contractErrorsIn,
  decodeContractError,
  decodeDiagnostics,
  describeContractError,
  SAC_ERRORS,
  SquareContractError,
  SimulationFailedError,
  type ContractErrorContext,
} from "../../src/stellar/index.js";
import { fixture } from "./rpcMock.js";

const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const context: ContractErrorContext = {
  nameOf: (id) => (id === USDC_SAC ? "usdc" : undefined),
  tableOf: (name) => (name === "usdc" ? SAC_ERRORS : undefined),
};

/** A real refusal: `balance` of an account with no USDC trustline, as testnet simulated it. */
const refusal = rpc.parseRawSimulation(fixture<rpc.Api.RawSimulateTransactionResponse>("simulateTransaction.trustline-missing.json"));

describe("a contract error in a simulation", () => {
  if (!rpc.Api.isSimulationError(refusal)) throw new Error("the fixture is not a simulation error");
  const diagnostics = decodeDiagnostics(refusal.events);

  it("has its code in the host's message", () => {
    expect(refusal.error.startsWith("HostError: Error(Contract, #13)")).toBe(true);
    expect(contractErrorCodeIn(refusal.error)).toBe(13);
    expect(contractErrorCodeIn("HostError: Error(Budget, ExceededLimit)")).toBeUndefined();
  });

  it("is logged by the contract that raised it, with the message it logged", () => {
    expect(diagnostics).toHaveLength(2);
    expect(contractErrorsIn(diagnostics)).toEqual([
      { contractId: USDC_SAC, code: 13, detail: "trustline entry is missing for account" },
    ]);
  });

  it("decodes to the contract's name and the code's name", () => {
    const decoded = decodeContractError(refusal.error, diagnostics, context);
    expect(decoded).toEqual({
      contract: "usdc",
      contractId: USDC_SAC,
      code: 13,
      errorName: "TrustlineMissingError",
      detail: "trustline entry is missing for account",
    });
    expect(describeContractError(decoded!)).toBe("usdc refused with TrustlineMissingError (#13): trustline entry is missing for account");
  });

  it("still decodes the code with no diagnostics, and names the contract when it cannot be told", () => {
    const decoded = decodeContractError(refusal.error, [], context);
    expect(decoded).toEqual({ contract: "unknown contract", contractId: undefined, code: 13, errorName: undefined, detail: undefined });
    expect(describeContractError(decoded!)).toBe("unknown contract refused with error #13");
  });

  it("leaves a code the table does not name as a number", () => {
    const decoded = decodeContractError(refusal.error, diagnostics, { ...context, tableOf: () => undefined });
    expect(decoded?.errorName).toBeUndefined();
    expect(describeContractError(decoded!)).toBe("usdc refused with error #13: trustline entry is missing for account");
  });

  it("is not a contract error when the host itself refused", () => {
    expect(decodeContractError("HostError: Error(Budget, ExceededLimit)", [], context)).toBeUndefined();
  });

  it("is thrown as a SquareContractError that is also a SimulationFailedError", () => {
    const decoded = decodeContractError(refusal.error, diagnostics, context)!;
    const error = new SquareContractError("usdc", "balance", refusal.error, diagnostics, decoded);
    expect(error).toBeInstanceOf(SimulationFailedError);
    expect(error.code).toBe(13);
    expect(error.errorName).toBe("TrustlineMissingError");
    expect(error.raisedBy).toBe("usdc");
    expect(error.method).toBe("balance");
    expect(error.message).toBe("usdc.balance: usdc refused with TrustlineMissingError (#13): trustline entry is missing for account");
    expect(error.reason.split("\n")[0]).toBe("HostError: Error(Contract, #13)");
  });
});

describe("the SAC error table", () => {
  it("names the trustline error the SDK acts on, and reserves code 1 as the host does", () => {
    expect(SAC_ERRORS[13]).toBe("TrustlineMissingError");
    expect(SAC_ERRORS[1]).toBeUndefined();
    expect(Object.keys(SAC_ERRORS)).toHaveLength(14);
  });
});
