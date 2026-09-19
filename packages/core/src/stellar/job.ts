import { hash, StrKey } from "@stellar/stellar-sdk";
import type { Spec } from "@stellar/stellar-sdk/contract";
import {
  Client as SquareJobBindings,
  JobStatus,
  OwnerError as OWNER_ERROR_CASES,
  SquareJobError as SQUARE_JOB_ERROR_CASES,
  type Config as KernelConfigRecord,
  type Job as JobRecord,
} from "../bindings/square_job/src/index.js";
import type { ContractErrorTable } from "./errors.js";
import type { SquareEvent } from "./events.js";

/**
 * The kernel (`contracts/contracts/square_job`, #9) as the SDK presents it:
 * the generated bindings' spec for encoding, its error and event tables, and
 * the camel-cased record the client answers with. The bindings are the
 * source; nothing about the contract's interface is written twice.
 */

export { JobStatus };
export type { JobRecord, KernelConfigRecord };

/** A job, as `getJob` answers it: the record with the SDK's field names and the settlement moment worked out. */
export interface SquareJob {
  id: bigint;
  client: string;
  provider: string;
  status: JobStatus;
  /** Base units (stroops for XLM); zero until `setBudget`. */
  budget: bigint;
  platformFeeBps: number;
  /** Seconds the client has after a submission to reject. */
  challengeWindow: bigint;
  createdAt: bigint;
  expiredAt: bigint;
  fundedAt: bigint;
  submittedAt: bigint;
  /** The 32-byte hash the provider submitted; undefined until then. */
  deliverable: Uint8Array | undefined;
  description: string;
  /** `submittedAt + challengeWindow`: when `finalize` opens and `reject` closes; undefined until submitted. */
  finalizeAfter: bigint | undefined;
}

export interface KernelConfig {
  token: string;
  challengeWindow: bigint;
  platformFeeBps: number;
}

/** The status names, in the contract's order, for display and for `JobStatus[value]`-free code. */
export const JOB_STATUS_NAMES: Readonly<Record<JobStatus, "Open" | "Funded" | "Submitted" | "Completed" | "Rejected" | "Expired">> = {
  [JobStatus.Open]: "Open",
  [JobStatus.Funded]: "Funded",
  [JobStatus.Submitted]: "Submitted",
  [JobStatus.Completed]: "Completed",
  [JobStatus.Rejected]: "Rejected",
  [JobStatus.Expired]: "Expired",
};

function tableFrom(cases: Record<number, { message: string }>): ContractErrorTable {
  return Object.fromEntries(Object.entries(cases).map(([code, { message }]) => [Number(code), message]));
}

/**
 * The kernel's error names by code, from the bindings: the contract's own
 * (1–19) and the owner primitive's (100–102), which share the contract's
 * code space (contracts/contracts/square_job/README.md, "Error codes").
 */
export const SQUARE_JOB_ERRORS: ContractErrorTable = { ...tableFrom(SQUARE_JOB_ERROR_CASES), ...tableFrom(OWNER_ERROR_CASES) };

/**
 * The bindings' spec: how each function's arguments become `ScVal`s and how
 * a return value comes back. The bindings' `Client` carries it; one is made
 * with placeholder options (its constructor only stores them and builds an
 * `rpc.Server` object, which connects to nothing), since only the spec is
 * used and it does not depend on the deployment.
 */
export const squareJobSpec: Spec = new SquareJobBindings({ contractId: StrKey.encodeContract(Buffer.alloc(32)), networkPassphrase: "", rpcUrl: "http://127.0.0.1:1", allowHttp: true }).spec;

export function toSquareJob(id: bigint, record: JobRecord): SquareJob {
  const deliverable = record.deliverable ?? undefined;
  return {
    id,
    client: record.client,
    provider: record.provider,
    status: record.status,
    budget: record.budget,
    platformFeeBps: record.platform_fee_bps,
    challengeWindow: record.challenge_window,
    createdAt: record.created_at,
    expiredAt: record.expired_at,
    fundedAt: record.funded_at,
    submittedAt: record.submitted_at,
    deliverable: deliverable === undefined ? undefined : new Uint8Array(deliverable),
    description: record.description,
    finalizeAfter: record.submitted_at === 0n ? undefined : record.submitted_at + record.challenge_window,
  };
}

export function toKernelConfig(record: KernelConfigRecord): KernelConfig {
  return { token: record.token, challengeWindow: record.challenge_window, platformFeeBps: record.platform_fee_bps };
}

/**
 * What `submit` records for a deliverable: the SHA-256 of its bytes. The
 * kernel stores 32 bytes and never sees the content; the provider keeps the
 * content and the client checks it against the hash the `submitted` event
 * carries. A 32-byte value is taken as a hash already.
 */
export function deliverableHash(content: string | Uint8Array): Uint8Array {
  if (typeof content !== "string" && content.length === 32) return new Uint8Array(content);
  return new Uint8Array(hash(typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content)));
}

// ---- events ------------------------------------------------------------------

/**
 * The kernel's events, typed: what `contracts/common/src/events.rs` emits,
 * with the topics and the data map read into one object each. `jobId` and
 * amounts are bigints (u64), bps and ledgers numbers (u32).
 */
export type KernelEvent =
  | { name: "job_created"; jobId: bigint; client: string; provider: string; expiredAt: bigint; challengeWindow: bigint; platformFeeBps: number; description: string }
  | { name: "budget_set"; jobId: bigint; by: string; amount: bigint }
  | { name: "funded"; jobId: bigint; client: string; amount: bigint }
  | { name: "submitted"; jobId: bigint; provider: string; deliverable: Uint8Array; submittedAt: bigint; finalizeAfter: bigint }
  | { name: "finalized"; jobId: bigint; provider: string; payout: bigint; fee: bigint }
  | { name: "rejected"; jobId: bigint; client: string; refund: bigint; reason: string }
  | { name: "refunded"; jobId: bigint; client: string; amount: bigint }
  | { name: "withdrawn"; account: string; to: string; amount: bigint }
  | { name: "skimmed"; to: string; amount: bigint }
  | { name: "ownership_offered"; from: string; to: string; liveUntilLedger: number }
  | { name: "ownership_transferred"; from: string; to: string };

export type KernelEventName = KernelEvent["name"];

/** A kernel event with where it was read from, as `SquareEvent` records it. */
export type LocatedKernelEvent = KernelEvent & Pick<SquareEvent, "ledger" | "id" | "txHash" | "position">;

export class MalformedEventError extends Error {
  constructor(readonly event: SquareEvent, detail: string) {
    super(`square_job event ${JSON.stringify(event.name)} is not what the kernel emits: ${detail}`);
    this.name = "MalformedEventError";
  }
}

type Reader = (event: SquareEvent) => KernelEvent;

function field<T>(event: SquareEvent, data: Record<string, unknown>, key: string, check: (value: unknown) => value is T): T {
  const value = data[key];
  if (!check(value)) throw new MalformedEventError(event, `data.${key} is ${typeof value}`);
  return value;
}

function topic<T>(event: SquareEvent, index: number, check: (value: unknown) => value is T): T {
  const value = event.topics[index];
  if (!check(value)) throw new MalformedEventError(event, `topics[${index}] is ${typeof value}`);
  return value;
}

const isBigint = (value: unknown): value is bigint => typeof value === "bigint";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isString = (value: unknown): value is string => typeof value === "string";
const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array;

function dataOf(event: SquareEvent): Record<string, unknown> {
  if (typeof event.data !== "object" || event.data === null || Array.isArray(event.data)) {
    throw new MalformedEventError(event, "data is not a map");
  }
  return event.data as Record<string, unknown>;
}

const readers: Record<KernelEventName, Reader> = {
  job_created: (e) => {
    const d = dataOf(e);
    return {
      name: "job_created",
      jobId: topic(e, 1, isBigint),
      client: topic(e, 2, isString),
      provider: topic(e, 3, isString),
      expiredAt: field(e, d, "expired_at", isBigint),
      challengeWindow: field(e, d, "challenge_window", isBigint),
      platformFeeBps: field(e, d, "platform_fee_bps", isNumber),
      description: field(e, d, "description", isString),
    };
  },
  budget_set: (e) => {
    const d = dataOf(e);
    return { name: "budget_set", jobId: topic(e, 1, isBigint), by: field(e, d, "by", isString), amount: field(e, d, "amount", isBigint) };
  },
  funded: (e) => {
    const d = dataOf(e);
    return { name: "funded", jobId: topic(e, 1, isBigint), client: topic(e, 2, isString), amount: field(e, d, "amount", isBigint) };
  },
  submitted: (e) => {
    const d = dataOf(e);
    return {
      name: "submitted",
      jobId: topic(e, 1, isBigint),
      provider: topic(e, 2, isString),
      deliverable: new Uint8Array(field(e, d, "deliverable", isBytes)),
      submittedAt: field(e, d, "submitted_at", isBigint),
      finalizeAfter: field(e, d, "finalize_after", isBigint),
    };
  },
  finalized: (e) => {
    const d = dataOf(e);
    return { name: "finalized", jobId: topic(e, 1, isBigint), provider: topic(e, 2, isString), payout: field(e, d, "payout", isBigint), fee: field(e, d, "fee", isBigint) };
  },
  rejected: (e) => {
    const d = dataOf(e);
    return { name: "rejected", jobId: topic(e, 1, isBigint), client: topic(e, 2, isString), refund: field(e, d, "refund", isBigint), reason: field(e, d, "reason", isString) };
  },
  refunded: (e) => {
    const d = dataOf(e);
    return { name: "refunded", jobId: topic(e, 1, isBigint), client: topic(e, 2, isString), amount: field(e, d, "amount", isBigint) };
  },
  withdrawn: (e) => {
    const d = dataOf(e);
    return { name: "withdrawn", account: topic(e, 1, isString), to: topic(e, 2, isString), amount: field(e, d, "amount", isBigint) };
  },
  skimmed: (e) => {
    const d = dataOf(e);
    return { name: "skimmed", to: topic(e, 1, isString), amount: field(e, d, "amount", isBigint) };
  },
  ownership_offered: (e) => {
    const d = dataOf(e);
    return { name: "ownership_offered", from: topic(e, 1, isString), to: topic(e, 2, isString), liveUntilLedger: field(e, d, "live_until_ledger", isNumber) };
  },
  ownership_transferred: (e) => ({ name: "ownership_transferred", from: topic(e, 1, isString), to: topic(e, 2, isString) }),
};

export function isKernelEventName(name: string): name is KernelEventName {
  return Object.hasOwn(readers, name);
}

/**
 * The kernel's events among `events` (a transaction result's, or a decoded
 * `getEvents` page), typed. Events of other contracts and names the kernel
 * does not emit are left out; a kernel event whose shape is not the
 * contract's throws `MalformedEventError`, since that means the deployment
 * is not the contract these bindings were generated from.
 */
export function kernelEvents(events: readonly SquareEvent[]): LocatedKernelEvent[] {
  const out: LocatedKernelEvent[] = [];
  for (const event of events) {
    if (event.contract !== "square_job" || !isKernelEventName(event.name)) continue;
    out.push({ ...readers[event.name](event), ledger: event.ledger, id: event.id, txHash: event.txHash, position: event.position });
  }
  return out;
}

/** The one event named `name` in a transaction's events, or undefined. */
export function kernelEvent<N extends KernelEventName>(events: readonly SquareEvent[], name: N): Extract<LocatedKernelEvent, { name: N }> | undefined {
  return kernelEvents(events).find((event): event is Extract<LocatedKernelEvent, { name: N }> => event.name === name);
}
