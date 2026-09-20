import type { SquareClient, TransactionResult } from "@squaresdk/core/stellar";

import {
  address,
  asBigInt,
  asBoolean,
  asHex,
  asNumber,
  asOptional,
  asRecord,
  asString,
  asVariant,
  bytesN,
  i128,
  option,
  str,
  struct,
  u32,
  u64,
} from "./scval";

/**
 * The contracts' calls, typed (#39). Every function names the contract, the
 * method and the argument widths the Soroban interfaces fix
 * (contracts/common/src/interfaces.rs, docs/decisions/auth-and-token-flow.md):
 * the signer comes first, amounts are `i128` at the boundary, job ids are
 * `u64`, and reading a job never sends a transaction.
 *
 * Reads go through `client.read`, which simulates; writes through
 * `client.write`, which simulates, signs, sends and waits, and throws the
 * contract's own error when the simulation refuses.
 */

export type JobStatusName = "Open" | "Funded" | "Submitted" | "Completed" | "Rejected" | "Expired";

export const JOB_STATUSES: readonly JobStatusName[] = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

export interface JobRecord {
  client: string;
  createdAt: number;
  expiredAt: number;
  provider: string | null;
  fundedAt: number;
  submittedAt: number;
  evaluator: string;
  /** Base units of the payment token, as the record stores them (`u64`). */
  budget: bigint;
  status: JobStatusName;
  hook: string | null;
  platformFeeBp: number;
  evaluatorFeeBp: number;
  providerBps: number;
  hookResolvesPayout: boolean;
  payee: string | null;
  deliverable: `0x${string}`;
  description: string;
  settlementHorizon: number;
  commitmentAtFund: `0x${string}` | null;
}

export interface KeeperWindow {
  effectiveFrom: number;
  challengeWindow: number;
  disputeWindow: number;
  finalizeGrace: number;
}

export interface SubmitParams {
  /** The 8004 agent the provider submits as, when it has one. */
  agentId: number | null;
  /** The validation request the hook should answer, when there is one. */
  requestHash: Uint8Array | null;
}

function jobRecord(value: unknown): JobRecord {
  const record = asRecord(value, "the job record");
  const at = (key: string): number => asNumber(record[key], `job.${key}`);
  return {
    client: asString(record["client"], "job.client"),
    createdAt: at("created_at"),
    expiredAt: at("expired_at"),
    provider: asOptional(record["provider"], (v) => asString(v, "job.provider")),
    fundedAt: at("funded_at"),
    submittedAt: at("submitted_at"),
    evaluator: asString(record["evaluator"], "job.evaluator"),
    budget: asBigInt(record["budget"], "job.budget"),
    status: jobStatus(record["status"]),
    hook: asOptional(record["hook"], (v) => asString(v, "job.hook")),
    platformFeeBp: at("platform_fee_bp"),
    evaluatorFeeBp: at("evaluator_fee_bp"),
    providerBps: at("provider_bps"),
    hookResolvesPayout: asBoolean(record["hook_resolves_payout"], "job.hook_resolves_payout"),
    payee: asOptional(record["payee"], (v) => asString(v, "job.payee")),
    deliverable: asHex(record["deliverable"], "job.deliverable"),
    description: asString(record["description"], "job.description"),
    settlementHorizon: at("settlement_horizon"),
    commitmentAtFund: asOptional(record["commitment_at_fund"], (v) => asHex(v, "job.commitment_at_fund")),
  };
}

function jobStatus(value: unknown): JobStatusName {
  const name = asVariant(value, "job.status");
  const known = JOB_STATUSES.find((status) => status === name);
  if (known === undefined) throw new Error(`unknown job status: ${name}`);
  return known;
}

function window(value: unknown): KeeperWindow {
  const record = asRecord(value, "the window");
  return {
    effectiveFrom: asNumber(record["effective_from"], "window.effective_from"),
    challengeWindow: asNumber(record["challenge_window"], "window.challenge_window"),
    disputeWindow: asNumber(record["dispute_window"], "window.dispute_window"),
    finalizeGrace: asNumber(record["finalize_grace"], "window.finalize_grace"),
  };
}

// ---------------------------------------------------------------- the kernel

export const jobCounter = (client: SquareClient): Promise<bigint> =>
  client.read({ contract: "square_job", method: "job_counter", parse: (v) => asBigInt(v, "the job counter") });

export const getJobRecord = (client: SquareClient, jobId: bigint): Promise<JobRecord> =>
  client.read({ contract: "square_job", method: "get_job_record", args: [u64(jobId)], parse: jobRecord });

export const netPayout = (client: SquareClient, jobId: bigint): Promise<bigint> =>
  client.read({ contract: "square_job", method: "net_payout", args: [u64(jobId)], parse: (v) => asBigInt(v, "the net payout") });

export const withdrawable = (client: SquareClient, account: string): Promise<bigint> =>
  client.read({ contract: "square_job", method: "withdrawable", args: [address(account)], parse: (v) => asBigInt(v, "the withdrawable balance") });

/**
 * What a holder has of the token a contract id names, in its base units. Every
 * Stellar Asset Contract answers `balance`, so this is the same read for XLM
 * through the native SAC as for USDC through Circle's.
 */
export const tokenBalance = (client: SquareClient, token: string, holder: string): Promise<bigint> =>
  client.read({
    contract: { id: token, name: "payment token" },
    method: "balance",
    args: [address(holder)],
    parse: (v) => asBigInt(v, "the token balance"),
  });

export const paymentToken = (client: SquareClient): Promise<string> =>
  client.read({ contract: "square_job", method: "payment_token", parse: (v) => asString(v, "the payment token") });

export const platformFeeBp = (client: SquareClient): Promise<number> =>
  client.read({ contract: "square_job", method: "platform_fee_bp", parse: (v) => asNumber(v, "the platform fee") });

export const evaluatorFeeBp = (client: SquareClient): Promise<number> =>
  client.read({ contract: "square_job", method: "evaluator_fee_bp", parse: (v) => asNumber(v, "the evaluator fee") });

export const treasury = (client: SquareClient): Promise<string> =>
  client.read({ contract: "square_job", method: "treasury", parse: (v) => asString(v, "the treasury") });

export const totalWithdrawable = (client: SquareClient): Promise<bigint> =>
  client.read({ contract: "square_job", method: "total_withdrawable", parse: (v) => asBigInt(v, "the withdrawable total") });

export interface CreateJob {
  client: string;
  provider: string | null;
  evaluator: string;
  expiredAt: number;
  description: string;
  hook: string | null;
}

export const createJob = (client: SquareClient, job: CreateJob): Promise<TransactionResult<bigint>> =>
  client.write({
    contract: "square_job",
    method: "create_job",
    args: [
      address(job.client),
      option(job.provider === null ? null : address(job.provider)),
      address(job.evaluator),
      u64(job.expiredAt),
      str(job.description),
      option(job.hook === null ? null : address(job.hook)),
    ],
    parse: (v) => asBigInt(v, "the new job id"),
  });

export const setProvider = (client: SquareClient, caller: string, jobId: bigint, provider: string): Promise<TransactionResult> =>
  client.write({ contract: "square_job", method: "set_provider", args: [address(caller), u64(jobId), address(provider)] });

export const setBudget = (client: SquareClient, caller: string, jobId: bigint, amount: bigint): Promise<TransactionResult> =>
  client.write({ contract: "square_job", method: "set_budget", args: [address(caller), u64(jobId), i128(amount)] });

/**
 * No approval step: the token moves inside the client's own authorization
 * tree (docs/decisions/auth-and-token-flow.md), so funding is one signature.
 */
export const fund = (client: SquareClient, caller: string, jobId: bigint, expectedBudget: bigint): Promise<TransactionResult> =>
  client.write({ contract: "square_job", method: "fund", args: [address(caller), u64(jobId), i128(expectedBudget)] });

export const submit = (
  client: SquareClient,
  provider: string,
  jobId: bigint,
  deliverable: Uint8Array,
  params: SubmitParams,
): Promise<TransactionResult> =>
  client.write({
    contract: "square_job",
    method: "submit",
    args: [
      address(provider),
      u64(jobId),
      bytesN(deliverable),
      struct({
        agent_id: option(params.agentId === null ? null : u32(params.agentId)),
        request_hash: option(params.requestHash === null ? null : bytesN(params.requestHash)),
      }),
    ],
  });

export const reject = (client: SquareClient, caller: string, jobId: bigint, reason: Uint8Array): Promise<TransactionResult> =>
  client.write({ contract: "square_job", method: "reject", args: [address(caller), u64(jobId), bytesN(reason)] });

export const claimRefund = (client: SquareClient, jobId: bigint): Promise<TransactionResult> =>
  client.write({ contract: "square_job", method: "claim_refund", args: [u64(jobId)] });

export const withdrawTo = (client: SquareClient, account: string, to: string, amount: bigint): Promise<TransactionResult> =>
  client.write({ contract: "square_job", method: "withdraw_to", args: [address(account), address(to), i128(amount)] });

// -------------------------------------------------------- the keeper evaluator

export const settlementHorizon = (client: SquareClient): Promise<number> =>
  client.read({ contract: "keeper_evaluator", method: "settlement_horizon", parse: (v) => asNumber(v, "the settlement horizon") });

export const isDisputed = (client: SquareClient, jobId: bigint): Promise<boolean> =>
  client.read({ contract: "keeper_evaluator", method: "is_disputed", args: [u64(jobId)], parse: (v) => asBoolean(v, "the dispute flag") });

export const challengeEnd = (client: SquareClient, jobId: bigint): Promise<number> =>
  client.read({ contract: "keeper_evaluator", method: "challenge_end", args: [u64(jobId)], parse: (v) => asNumber(v, "the challenge end") });

export const currentWindow = (client: SquareClient): Promise<KeeperWindow> =>
  client.read({ contract: "keeper_evaluator", method: "current_window", parse: window });

export const finalize = (client: SquareClient, caller: string, jobId: bigint): Promise<TransactionResult> =>
  client.write({ contract: "keeper_evaluator", method: "finalize", args: [address(caller), u64(jobId)] });

export const dispute = (client: SquareClient, caller: string, jobId: bigint, evidence: Uint8Array): Promise<TransactionResult> =>
  client.write({ contract: "keeper_evaluator", method: "dispute", args: [address(caller), u64(jobId), bytesN(evidence)] });
