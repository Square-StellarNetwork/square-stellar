"use client";

import { createSquareClient, type SquareClient, type SquareEvent } from "@squaresdk/core/stellar";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { chainClockOffset, chainNow } from "./clock";
import {
  challengeEnd,
  currentWindow,
  evaluatorFeeBp,
  getJobRecord,
  isDisputed,
  jobCounter,
  netPayout,
  paymentToken,
  platformFeeBp,
  settlementHorizon,
  tokenBalance,
  totalWithdrawable,
  treasury,
  withdrawable,
  type JobRecord,
  type KeeperWindow,
} from "./contracts";
import { deployment, horizonUrl, NETWORK_ID, rpcUrl, tokenLabel } from "./stellar";
import { useWallet } from "./wallet";

/** Every read refreshes on this interval, as the EVM app's did. */
export const POLL_MS = 10_000;
/** How many of the newest jobs the dashboard reads. */
export const RECENT_JOB_WINDOW = 50;
/**
 * How far back `getEvents` is asked to look when the deployment does not say
 * which ledger it started at. A Soroban RPC keeps about a day of events, and a
 * ledger closes about every five seconds.
 */
const EVENT_LOOKBACK_LEDGERS = 17_000;

const readOnly: SquareClient | null = deployment === null ? null : createSquareClient({ deployment, rpc: rpcUrl });

/** The client every read uses; null until this build names a deployment. */
export function useSquareRead(): SquareClient | null {
  return readOnly;
}

/**
 * The client writes go through: the same deployment with the connected
 * wallet's signer. Null while no wallet is connected, which is what every
 * action gate already checks.
 */
export function useSquare(): SquareClient | null {
  const { signer } = useWallet();
  return useMemo(() => {
    if (deployment === null) return null;
    if (signer === undefined) return readOnly;
    return createSquareClient({ deployment, rpc: rpcUrl, signer });
  }, [signer]);
}

/** A job as the lists show it: its record, its id, and the two window facts. */
export type JobSummary = JobRecord & {
  id: bigint;
  /** When the challenge window closes; 0 when this job has none. */
  challengeEnd: number;
  disputed: boolean;
};

export interface JobsSnapshot {
  counter: bigint;
  jobs: JobSummary[];
  scanned: number;
}

/** Whether the keeper evaluator holds this job's window, so it has one. */
export function keeperHoldsTheWindow(record: JobRecord): boolean {
  return deployment !== null && record.evaluator === deployment.keeperEvaluator;
}

async function summary(client: SquareClient, id: bigint): Promise<JobSummary> {
  const record = await getJobRecord(client, id);
  if (record.status !== "Submitted" || !keeperHoldsTheWindow(record)) {
    return { ...record, id, challengeEnd: 0, disputed: false };
  }
  const [end, disputed] = await Promise.all([challengeEnd(client, id), isDisputed(client, id)]);
  return { ...record, id, challengeEnd: end, disputed };
}

/**
 * The newest jobs. Their ids come from the kernel's own `JobCreated` events
 * (`getEvents`), which is what the MVP reads instead of an indexer, and each
 * job is then read from the contract.
 */
export function useJobs(limit = RECENT_JOB_WINDOW) {
  return useQuery({
    queryKey: ["jobs", NETWORK_ID, limit],
    enabled: readOnly !== null,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<JobsSnapshot> => {
      const client = readOnly;
      if (client === null) throw new Error("no deployment");
      const [counter, ids] = await Promise.all([jobCounter(client), createdJobIds(client, limit)]);
      const jobs = await Promise.all(ids.map((id) => summary(client, id)));
      return { counter, jobs, scanned: ids.length };
    },
  });
}

/** The job ids the kernel's `JobCreated` events carry, newest first. */
async function createdJobIds(client: SquareClient, limit: number): Promise<bigint[]> {
  const latest = await client.latestLedger();
  const startLedger = Math.max(1, deployment?.deployLedger ?? latest - EVENT_LOOKBACK_LEDGERS);
  const response = await client.server.getEvents({
    startLedger,
    filters: [{ type: "contract", contractIds: [client.resolve("square_job").id], topics: [["*", "*"]] }],
    limit: 1000,
  });
  const ids = client
    .decodeEvents(response)
    .filter((event: SquareEvent) => event.name === "job_created")
    .map((event: SquareEvent) => event.topics[1])
    .filter((id): id is bigint => typeof id === "bigint");
  return [...new Set(ids)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, limit);
}

export type JobDetail = JobSummary & {
  /** What `complete` would credit the payee side, at the job's snapshotted fees. */
  netPayout: bigint;
};

export function useJob(id: bigint | null) {
  return useQuery({
    queryKey: ["job", NETWORK_ID, id === null ? null : id.toString()],
    enabled: readOnly !== null && id !== null,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<JobDetail | null> => {
      const client = readOnly;
      if (client === null || id === null) return null;
      const counter = await jobCounter(client);
      if (id < 1n || id > counter) return null;
      const base = await summary(client, id);
      const net = await netPayout(client, id);
      return { ...base, netPayout: net };
    },
  });
}

export interface NetworkInfo {
  ledger: number;
  protocolVersion: number;
  chainOffset: number;
  jobCounter: bigint;
  settlementHorizon: number;
  window: KeeperWindow;
  platformFeeBp: number;
  evaluatorFeeBp: number;
  treasury: string;
  totalWithdrawable: bigint;
  paymentToken: string;
}

/**
 * The chain head and the settings the pages show. The ledger's close time is
 * the chain clock the countdowns run on, as the EVM app used the block
 * timestamp.
 */
export function useNetwork() {
  return useQuery({
    queryKey: ["network", NETWORK_ID],
    enabled: readOnly !== null,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<NetworkInfo> => {
      const client = readOnly;
      if (client === null) throw new Error("no deployment");
      const head = await client.server.getLatestLedger();
      const [closedAt, counter, horizon, window, platform, evaluator, treasuryAddress, withdrawableTotal, token] = await Promise.all([
        ledgerClosedAt(client, head.sequence),
        jobCounter(client),
        settlementHorizon(client),
        currentWindow(client),
        platformFeeBp(client),
        evaluatorFeeBp(client),
        treasury(client),
        totalWithdrawable(client),
        paymentToken(client),
      ]);
      return {
        ledger: head.sequence,
        protocolVersion: Number(head.protocolVersion),
        chainOffset: chainClockOffset(closedAt, Date.now()),
        jobCounter: counter,
        settlementHorizon: horizon,
        window,
        platformFeeBp: platform,
        evaluatorFeeBp: evaluator,
        treasury: treasuryAddress,
        totalWithdrawable: withdrawableTotal,
        paymentToken: token,
      };
    },
  });
}

/** When the ledger closed, in seconds: the chain's own clock. */
async function ledgerClosedAt(client: SquareClient, sequence: number): Promise<number> {
  const ledgers = await client.server.getLedgers({ startLedger: sequence, pagination: { limit: 1 } });
  const closed = ledgers.ledgers[0]?.ledgerCloseTime;
  if (closed === undefined) throw new Error(`ledger ${sequence} did not report its close time`);
  return Number(closed);
}

export interface Positions {
  /** What the kernel owes this account, in the payment token's base units. */
  withdrawable: bigint;
  /** The account's XLM, in stroops: what it pays every transaction fee with. */
  xlm: bigint;
  /** The account's balance of the kernel's payment token, in that token's base units. */
  token: bigint;
}

export function usePositions(account: string | undefined) {
  return useQuery({
    queryKey: ["positions", NETWORK_ID, account ?? null],
    enabled: readOnly !== null && account !== undefined,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<Positions> => {
      const client = readOnly;
      if (client === null || account === undefined) throw new Error("no deployment or no account");
      const [owed, xlm, token] = await Promise.all([
        withdrawable(client, account),
        nativeBalance(account),
        paymentToken(client).then((id) => tokenBalance(client, id, account)),
      ]);
      return { withdrawable: owed, xlm, token };
    },
  });
}

/** The account's XLM in stroops, from Horizon; zero when the account does not exist yet. */
export async function nativeBalance(account: string): Promise<bigint> {
  const response = await fetch(`${horizonUrl}/accounts/${account}`, { headers: { accept: "application/json" } });
  if (response.status === 404) return 0n;
  if (!response.ok) throw new Error(`Horizon answered ${response.status} for ${account}`);
  const body = (await response.json()) as { balances?: { asset_type?: string; balance?: string }[] };
  const native = body.balances?.find((balance) => balance.asset_type === "native")?.balance ?? "0";
  const [whole, fraction = ""] = native.split(".");
  return BigInt(`${whole ?? "0"}${fraction.padEnd(7, "0").slice(0, 7)}`);
}

/** What the kernel's payment token is called, for every amount on screen. */
export function usePaymentTokenLabel(): string {
  return tokenLabel(useNetwork().data?.paymentToken);
}

export function useNow(intervalMs = 1000): number {
  const offset = useNetwork().data?.chainOffset ?? 0;
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return chainNow(offset, tick);
}

export function useClockSkew(): number {
  return useNetwork().data?.chainOffset ?? 0;
}

export { jobPhase, LISTING_LABELS, PHASE_LABELS } from "./phase";
export type { JobPhase } from "./phase";
