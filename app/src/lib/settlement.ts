import { hexToString, isHex, type Hex } from "viem";

/**
 * The settlement record of a job, derived from the events the indexer
 * journaled for it (`GET /jobs/:id/events`). The kernel's record says where
 * the money went; only the events say why: whether the compliance module
 * verified or refused the release and on which binding, whether the payee
 * was cleared, and what the hook wrote to the ERC-8004 registries. Pure over
 * the event list, so it is tested without an indexer.
 */

export interface JournaledEvent {
  contract: string;
  name: string;
  blockNumber: string;
  logIndex: number;
  txHash: string;
  args: { decoded?: Record<string, unknown> } | Record<string, unknown>;
}

export type Verdict = "verified" | "refused" | "unconfirmed" | "not-gated" | "unknown";

export interface SettlementRecord {
  /** What the compliance module said about the release, if the hook asked it. */
  verdict: Verdict;
  /** The module's own reason for a refusal (`ReleaseRefused.reason`, a bytes32 string). */
  refusalReason: string | null;
  /** True once `ComplianceChecked` was seen with `verified = false`, without a `ReleaseRefused` naming why. */
  checkFailed: boolean;
  /** The screening the hook read for the payee at release, when a registry was installed. */
  screening: "cleared" | "not-cleared" | "not-screened";
  reputation: { state: "recorded"; outcome: string; agentId: string } | { state: "skipped"; reason: string; agentId: string } | { state: "failed"; agentId: string } | { state: "none" };
  validation: "recorded" | "failed" | "none";
  payout: { payee: string; providerBps: number; providerShare: string; clientShare: string } | null;
  policyCommitment: string | null;
  hookFailures: number;
  /** Transactions the record was read from, for the explorer links. */
  transactions: string[];
  events: number;
}

const OUTCOMES: Record<number, string> = { 1: "completed", 2: "rejected", 3: "expired" };

function decoded(event: JournaledEvent): Record<string, unknown> {
  const args = event.args as { decoded?: Record<string, unknown> };
  if (args.decoded && typeof args.decoded === "object") return args.decoded;
  return event.args as Record<string, unknown>;
}

/** A `bytes32` the contracts write as a short ASCII string, read back as text; anything else is shown as hex. */
export function bytes32Text(value: unknown): string | null {
  if (typeof value !== "string" || !isHex(value)) return null;
  try {
    const text = hexToString(value as Hex, { size: 32 }).replace(/\0+$/, "");
    if (text.length === 0) return "";
    return /^[\x20-\x7e]+$/.test(text) ? text : value;
  } catch {
    return value;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "bigint" ? String(value) : null;
}

export function settlementRecord(events: JournaledEvent[]): SettlementRecord {
  const ordered = [...events].sort((a, b) => {
    const block = BigInt(a.blockNumber) - BigInt(b.blockNumber);
    return block === 0n ? a.logIndex - b.logIndex : block < 0n ? -1 : 1;
  });
  const record: SettlementRecord = {
    verdict: "unknown",
    refusalReason: null,
    checkFailed: false,
    screening: "not-screened",
    reputation: { state: "none" },
    validation: "none",
    payout: null,
    policyCommitment: null,
    hookFailures: 0,
    transactions: [],
    events: ordered.length,
  };
  let checked = false;
  for (const event of ordered) {
    const args = decoded(event);
    if (!record.transactions.includes(event.txHash)) record.transactions.push(event.txHash);
    switch (event.name) {
      case "PolicyPinned":
        record.policyCommitment = str(args["commitment"]);
        break;
      case "ComplianceChecked":
        checked = true;
        if (args["verified"] === true) record.verdict = "verified";
        else record.checkFailed = true;
        break;
      case "ReleaseVerified":
        record.verdict = "verified";
        break;
      case "ReleaseRefused":
        record.verdict = "refused";
        record.refusalReason = bytes32Text(args["reason"]);
        break;
      case "ReleaseUnconfirmed":
        record.verdict = "unconfirmed";
        break;
      case "ScreeningChecked":
        record.screening = args["cleared"] === true ? "cleared" : "not-cleared";
        break;
      case "ReputationRecorded": {
        const outcome = Number(args["outcome"]);
        record.reputation = { state: "recorded", outcome: OUTCOMES[outcome] ?? `outcome ${outcome}`, agentId: str(args["agentId"]) ?? "?" };
        break;
      }
      case "ReputationSkipped":
        record.reputation = { state: "skipped", reason: bytes32Text(args["reason"]) ?? "unknown", agentId: str(args["agentId"]) ?? "?" };
        break;
      case "ReputationWriteFailed":
        record.reputation = { state: "failed", agentId: str(args["agentId"]) ?? "?" };
        break;
      case "ValidationRecorded":
        record.validation = "recorded";
        break;
      case "ValidationWriteFailed":
        record.validation = "failed";
        break;
      case "PayoutRouted":
        record.payout = {
          payee: str(args["payee"]) ?? "?",
          providerBps: Number(args["providerBps"] ?? 0),
          providerShare: str(args["providerShare"]) ?? "0",
          clientShare: str(args["clientShare"]) ?? "0",
        };
        break;
      case "HookFailed":
        record.hookFailures += 1;
        break;
      default:
        break;
    }
  }
  // A completed job whose hook never ran a check was not proof gated: the
  // slot was empty, so finalize paid whatever the split said.
  if (!checked && record.verdict === "unknown" && record.payout !== null) record.verdict = "not-gated";
  // The hook's check failing without the module naming a reason is what an
  // unreadable proof looks like from the outside; say so rather than "unknown".
  if (record.checkFailed && record.verdict === "unknown") record.verdict = "refused";
  return record;
}
