"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionInbox } from "@/components/ActionInbox";
import { AddressLink } from "@/components/AddressLink";
import { Amount } from "@/components/Amount";
import { EscrowFlowChart } from "@/components/charts/EscrowFlowChart";
import { FeeTotalsChart } from "@/components/charts/FeeTotalsChart";
import { PipelineChart } from "@/components/charts/PipelineChart";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { GhostButton } from "@/components/GhostButton";
import { MetricCard } from "@/components/MetricCard";
import { PanelCard } from "@/components/PanelCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionHeading } from "@/components/SectionHeading";
import { StatusPill, phaseTone } from "@/components/StatusPill";
import { TabBar } from "@/components/TabBar";
import { escrowFlow, feeTotals, phaseBreakdown } from "@/lib/charts";
import { formatAmount, formatBigint, formatCountdown, formatTimestamp } from "@/lib/format";
import { inputClass } from "@/components/Field";
import { jobPhase, PHASE_LABELS, RECENT_JOB_WINDOW, useJobs, useNow, usePaymentTokenLabel, usePositions, useSquare, type JobPhase, type JobSummary } from "@/lib/square";
import { matchesQuery } from "@/lib/stats";
import { describeError, useTx } from "@/lib/tx";
import { NETWORK_LABEL } from "@/lib/stellar";
import { useWallet } from "@/lib/wallet";

const tabs = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "in-window", label: "In window" },
  { id: "finalizable", label: "Finalizable" },
  { id: "completed", label: "Completed" },
  { id: "refundable", label: "Refundable" },
];

function matchesTab(job: JobSummary, phase: JobPhase, tab: string): boolean {
  switch (tab) {
    case "open":
      return job.status === "Open" || job.status === "Funded";
    case "in-window":
      return phase === "in-window";
    case "finalizable":
      return phase === "finalizable";
    case "completed":
      return job.status === "Completed";
    case "refundable":
      return phase === "refundable";
    default:
      return true;
  }
}

function ChallengeCell({ job, now }: { job: JobSummary; now: number }) {
  if (job.status === "Submitted") {
    return (
      <span className="flex flex-col">
        <span className="tabular-nums text-carbon">{formatCountdown(job.finalizeAfter, now)}</span>
        <span className="text-caption tabular-nums text-ash">{formatTimestamp(job.finalizeAfter)}</span>
      </span>
    );
  }
  if (job.status === "Open" || job.status === "Funded") {
    return <span className="text-ash">Not submitted</span>;
  }
  return <span className="text-ash">Settled</span>;
}

export function DashboardView() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(RECENT_JOB_WINDOW);
  const now = useNow();
  const jobsQuery = useJobs(limit);
  const { address } = useWallet();
  const positions = usePositions(address ?? undefined);
  const square = useSquare();
  const token = usePaymentTokenLabel();
  const { run, busy } = useTx();

  const jobs = jobsQuery.data?.jobs ?? [];
  const scanned = jobsQuery.data?.scanned ?? 0;
  const withPhase = jobs.map((job) => ({ job, phase: jobPhase(job, now) }));
  const counts = {
    open: withPhase.filter(({ job }) => job.status === "Open" || job.status === "Funded").length,
    inWindow: withPhase.filter(({ phase }) => phase === "in-window").length,
    finalizable: withPhase.filter(({ phase }) => phase === "finalizable").length,
    completed: withPhase.filter(({ job }) => job.status === "Completed").length,
    refundable: withPhase.filter(({ phase }) => phase === "refundable").length,
  };
  const tabCounts: Record<string, number> = {
    all: jobs.length,
    open: counts.open,
    "in-window": counts.inWindow,
    finalizable: counts.finalizable,
    completed: counts.completed,
    refundable: counts.refundable,
  };
  const filtered = withPhase.filter(({ job, phase }) => matchesTab(job, phase, tab) && matchesQuery(job, query));
  const olderAvailable = jobsQuery.data ? jobsQuery.data.counter > BigInt(jobsQuery.data.scanned) : false;
  const flow = jobsQuery.data ? escrowFlow(jobs) : null;
  const slices = jobsQuery.data ? phaseBreakdown(jobs, now, PHASE_LABELS) : [];
  const settled = jobsQuery.data ? feeTotals(jobs) : null;

  // The MVP reads the chain itself: the kernel's JobCreated events for the ids
  // and the contract for each job. The indexer arrives with #36.
  const caption = `Open, in window and completed are counted over the ${scanned} most recent jobs, read from the kernel's own events and records; the total comes from job_counter.`;

  const connected = address !== null;

  const columns: Column<{ job: JobSummary; phase: JobPhase }>[] = [
    {
      key: "id",
      header: "Id",
      render: ({ job }) => (
        <Link
          href={`/job?id=${job.id.toString()}`}
          className="font-medium tabular-nums text-carbon underline decoration-fog underline-offset-4 hover:decoration-carbon"
        >
          #{job.id.toString()}
        </Link>
      ),
    },
    { key: "client", header: "Client", render: ({ job }) => <AddressLink address={job.client} /> },
    { key: "provider", header: "Provider", render: ({ job }) => <AddressLink address={job.provider} /> },
    { key: "budget", header: "Budget", align: "right", render: ({ job }) => <Amount value={job.budget} /> },
    { key: "status", header: "Status", render: ({ phase }) => <StatusPill label={PHASE_LABELS[phase]} tone={phaseTone[phase]} /> },
    { key: "window", header: "Challenge end", render: ({ job }) => <ChallengeCell job={job} now={now} /> },
    {
      key: "detail",
      header: "",
      align: "right",
      render: ({ job }) => (
        <GhostButton size="sm" href={`/job?id=${job.id.toString()}`}>
          Detail
        </GhostButton>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-16">
      <section className="flex flex-col gap-8">
        <SectionHeading
          title="Dashboard"
          description={`Jobs on ${NETWORK_LABEL}, read from the chain every ten seconds.`}
          actions={<PrimaryButton href="/new">New job</PrimaryButton>}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Total jobs"
            loading={jobsQuery.isPending}
            value={jobsQuery.data ? formatBigint(jobsQuery.data.counter) : "Unavailable"}
            hint="job_counter on square_job"
          />
          <MetricCard
            label="Open"
            loading={jobsQuery.isPending}
            value={jobsQuery.data ? counts.open : "Unavailable"}
            hint="Open or funded, not yet submitted"
          />
          <MetricCard
            label="In window"
            loading={jobsQuery.isPending}
            value={jobsQuery.data ? counts.inWindow : "Unavailable"}
            hint="Submitted, undisputed, window still open"
          />
          <MetricCard
            label="Completed"
            loading={jobsQuery.isPending}
            value={jobsQuery.data ? counts.completed : "Unavailable"}
            hint="Status Completed on the kernel"
          />
        </div>
        <p className="text-caption text-graphite">{caption}</p>
      </section>

      {address === null ? null : <ActionInbox jobs={jobs} address={address} now={now} scanned={scanned} />}

      <section aria-label="Activity" className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <EscrowFlowChart series={flow} scanned={scanned} loading={jobsQuery.isPending} error={jobsQuery.isError ? describeError(jobsQuery.error) : null} />
        <PipelineChart slices={slices} scanned={scanned} loading={jobsQuery.isPending} error={jobsQuery.isError ? describeError(jobsQuery.error) : null} />
      </section>

      <section aria-label="Settlement">
        <FeeTotalsChart totals={settled} scanned={scanned} loading={jobsQuery.isPending} error={jobsQuery.isError ? describeError(jobsQuery.error) : null} />
      </section>

      {address === null ? null : (
        <PanelCard elevated title="Your positions" description="What this wallet holds, and what the kernel owes it.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-fog p-6">
              <p className="text-caption text-graphite">Wallet balance</p>
              <p className="mt-2 text-subheading font-medium tabular-nums">
                {positions.data ? <Amount value={positions.data.token} /> : positions.isError ? "Unavailable" : "Loading"}
              </p>
              <p className="mt-2 text-caption text-ash">
                {token === "XLM"
                  ? "XLM funds the budgets on this stack and pays every transaction fee."
                  : positions.data
                    ? `What the budgets are funded in. ${formatAmount(positions.data.xlm)} XLM pays the transaction fees.`
                    : "What the budgets are funded in; the fees are paid in XLM."}
              </p>
            </div>
            <div className="flex flex-col gap-4 rounded-2xl border border-fog p-6">
              <div>
                <p className="text-caption text-graphite">Withdrawable from square_job</p>
                <p className="mt-2 text-subheading font-medium">
                  {positions.data ? <Amount value={positions.data.withdrawable} /> : positions.isError ? "Unavailable" : "Loading"}
                </p>
              </div>
              <div>
                <PrimaryButton
                  size="sm"
                  disabled={busy || !connected || square === null || !positions.data || positions.data.withdrawable === 0n}
                  onClick={() => {
                    const client = square;
                    const holder = address;
                    const amount = positions.data?.withdrawable;
                    if (client === null || holder === null || amount === undefined || amount === 0n) return;
                    void run("Withdraw", () => client.withdrawTo(holder, amount));
                  }}
                >
                  Withdraw
                </PrimaryButton>
                <p className="mt-2 text-caption text-ash">The ledger credits; the holder chooses where it goes.</p>
              </div>
            </div>
          </div>
        </PanelCard>
      )}

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <TabBar tabs={tabs.map((entry) => ({ ...entry, count: tabCounts[entry.id] ?? 0 }))} active={tab} onChange={setTab} label="Job filters" />
          </div>
          <label className="flex flex-col gap-2 lg:w-72">
            <span className="sr-only">Find a job by id or address</span>
            <input
              type="search"
              className={inputClass}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Job id or address"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
        <DataTable
          caption="Jobs"
          columns={columns}
          rows={filtered}
          rowKey={({ job }) => job.id.toString()}
          empty={
            jobsQuery.isPending ? (
              <EmptyState title="Reading jobs from the chain" />
            ) : jobsQuery.isError ? (
              <EmptyState title="The chain read failed" hint={describeError(jobsQuery.error)} />
            ) : jobs.length === 0 ? (
              <EmptyState
                title="No jobs yet"
                hint="job_counter is zero on this deployment."
                action={<PrimaryButton href="/new">Create the first job</PrimaryButton>}
              />
            ) : (
              <EmptyState
                title={query.trim().length > 0 ? "No jobs match this search" : "No jobs match this filter"}
                hint={query.trim().length > 0 ? `Nothing among the ${scanned} most recent jobs has that id or address.` : `Nothing among the ${scanned} most recent jobs is in this state.`}
              />
            )
          }
        />
        {olderAvailable ? (
          <div className="flex flex-wrap items-center gap-3">
            <GhostButton size="sm" onClick={() => setLimit((current) => current + RECENT_JOB_WINDOW)} disabled={jobsQuery.isFetching}>
              {jobsQuery.isFetching ? "Reading" : `Load ${RECENT_JOB_WINDOW} older jobs`}
            </GhostButton>
            <span className="text-caption text-ash">
              {scanned} of {jobsQuery.data ? formatBigint(jobsQuery.data.counter) : ""} jobs loaded.
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
