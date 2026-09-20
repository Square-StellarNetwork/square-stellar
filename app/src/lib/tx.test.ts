import {
  ArchivedStateError,
  NeedsMoreSignaturesError,
  SimulationFailedError,
  SquareContractError,
  TransactionFailedError,
  TransactionPendingError,
  TrustlineMissingError,
  WalletRequiredError,
} from "@squaresdk/core/stellar";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { describeError, switchNetworkGuidance } from "./tx";

const hash = "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8";

describe("describeError", () => {
  it("gives a refused call the contract's own error name", () => {
    const decoded = { contract: "square_job", contractId: undefined, code: 2, errorName: "WrongStatus", detail: undefined };
    const error = new SquareContractError("square_job", "fund", "HostError: Error(Contract, #2)", [], decoded);
    expect(describeError(error)).toContain("WrongStatus");
    expect(describeError(error)).toContain("square_job");
  });

  it("names the call and the reason when the simulation failed without a contract error", () => {
    expect(describeError(new SimulationFailedError("keeper_evaluator", "finalize", "Error(Budget, ExceededLimit)", [], undefined))).toBe(
      "keeper_evaluator.finalize was refused: Error(Budget, ExceededLimit)",
    );
  });

  it("says an archived entry has to be restored before the call works", () => {
    expect(describeError(new ArchivedStateError("square_job", "get_job_record"))).toContain("restored");
  });

  it("names the signers a call still needs", () => {
    const missing = Keypair.random().publicKey();
    expect(describeError(new NeedsMoreSignaturesError("square_job", "fund", [missing]))).toContain(missing);
  });

  it("explains a missing trustline in terms of what it stops", () => {
    const account = Keypair.random().publicKey();
    expect(describeError(new TrustlineMissingError(account, "USDC"))).toContain("cannot receive");
  });

  it("points at a transaction that landed and applied nothing", () => {
    const message = describeError(new TransactionFailedError(hash, 4_760_307, "AAAAAAAAAAAAAGT/////", [], undefined));
    expect(message).toContain("1c8aff9506");
    expect(message).toContain("4760307");
  });

  it("says a pending transaction may still land", () => {
    expect(describeError(new TransactionPendingError(hash, 60))).toContain("still pending");
  });

  it("asks for a wallet when the call would send one", () => {
    expect(describeError(new WalletRequiredError())).toContain("Connect a wallet");
  });

  it("falls back to the message of a plain error", () => {
    expect(describeError(new Error("the wallet rejected the request"))).toBe("the wallet rejected the request");
  });
});

describe("switchNetworkGuidance", () => {
  it("says where the switch happens, because on Stellar it is not the app's to make", () => {
    const notice = switchNetworkGuidance("Stellar Testnet", "Public Global Stellar Network ; September 2015");
    expect(notice).toContain("Public Global Stellar Network");
    expect(notice).toContain("Stellar Testnet");
    expect(notice).toContain("in the wallet itself");
  });
});
