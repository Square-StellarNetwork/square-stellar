"use client";

import { createSquareClient, kernelEvents, type KernelConfig, type SquareClient } from "@squaresdk/core/stellar";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { chainClockOffset, chainNow } from "./clock";
import { toSummary, type JobSummary } from "./job";
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

export interface JobsSnapshot {
  counter: bigint;
  jobs: JobSummary[];
  scanned: number;
}

/**
 * The newest jobs. Their ids come from the kernel's own `job_created` events
 * (`getEvents`), which is what the MVP reads instead of an indexer, and each
 * job is then read from the contract, since an event only says how a job
 * started.
 */
export function useJobs(limit = RECENT_JOB_WINDOW) {
  return useQuery({
    queryKey: ["jobs", NETWORK_ID, limit],
    enabled: readOnly !== null,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<JobsSnapshot> => {
      const client = readOnly;
      if (client === null) throw new Error("no deployment");
      const [counter, ids] = await Promise.all([client.jobCounter(), createdJobIds(client, limit)]);
      const jobs = await Promise.all(ids.map(async (id) => toSummary(await client.getJob(id))));
      return { counter, jobs, scanned: ids.length };
    },
  });
}

/** The job ids the kernel's `job_created` events carry, newest first. */
async function createdJobIds(client: SquareClient, limit: number): Promise<bigint[]> {
  const latest = await client.latestLedger();
  const startLedger = Math.max(1, deployment?.deployLedger ?? latest - EVENT_LOOKBACK_LEDGERS);
  const page = await client.getEvents({ startLedger, topics: [[{ symbol: "job_created" }]], limit: 1_000 });
  const ids = kernelEvents(page.events).flatMap((event) => (event.name === "job_created" ? [event.jobId] : []));
  return [...new Set(ids)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, limit);
}

export function useJob(id: bigint | null) {
  return useQuery({
    queryKey: ["job", NETWORK_ID, id === null ? null : id.toString()],
    enabled: readOnly !== null && id !== null,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<JobSummary | null> => {
      const client = readOnly;
      if (client === null || id === null) return null;
      const counter = await client.jobCounter();
      if (id < 1n || id > counter) return null;
      return toSummary(await client.getJob(id));
    },
  });
}

export interface NetworkInfo {
  ledger: number;
  protocolVersion: number;
  chainOffset: number;
  jobCounter: bigint;
  config: KernelConfig;
  owner: string;
  totals: { escrowed: bigint; withdrawable: bigint; unaccounted: bigint };
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
      const [closedAt, counter, config, owner, totals] = await Promise.all([
        ledgerClosedAt(client, head.sequence),
        client.jobCounter(),
        client.kernelConfig(),
        client.kernelOwner(),
        client.kernelTotals(),
      ]);
      return {
        ledger: head.sequence,
        protocolVersion: Number(head.protocolVersion),
        chainOffset: chainClockOffset(closedAt, Date.now()),
        jobCounter: counter,
        config,
        owner,
        totals,
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
      const [owed, xlm, token] = await Promise.all([client.withdrawable(account), nativeBalance(account), client.tokenBalance(account)]);
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
  return tokenLabel(useNetwork().data?.config.token);
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

export type { JobSummary } from "./job";
export { jobPhase, PHASE_LABELS } from "./phase";
export type { JobPhase } from "./phase";
