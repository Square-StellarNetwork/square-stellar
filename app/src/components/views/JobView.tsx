"use client";

import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AddressLink } from "@/components/AddressLink";
import { Amount } from "@/components/Amount";
import { SegmentBar, type Segment } from "@/components/charts/SegmentBar";
import { SettlementClock } from "@/components/charts/SettlementClock";
import { EmptyState } from "@/components/EmptyState";
import { Field, inputClass } from "@/components/Field";
import { PanelCard } from "@/components/PanelCard";
import { PartiesPanel } from "@/components/PartiesPanel";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionHeading } from "@/components/SectionHeading";
import { StatusPill, phaseTone } from "@/components/StatusPill";
import { WalletButton } from "@/components/WalletButton";
import { challengeWindowClosed, disputeAvailable, finalizeAvailable, keeperEvaluates, refundAvailable, submitAvailable, submitDeadline } from "@/lib/actions";
import { addressInputError, readAddressInput } from "@/lib/address";
import { chartColors, formatCompactAmount, payoutSplit, settlementClock } from "@/lib/charts";
import { claimRefund, dispute, finalize, fund, reject, setBudget, setProvider, submit, withdrawTo, type JobRecord } from "@/lib/contracts";
import { formatAmount, formatBps, formatCountdown, formatDuration, formatTimestamp, parseAmount, shortHash } from "@/lib/format";
import { jobPhase, PHASE_LABELS, useJob, useNow, usePaymentTokenLabel, usePositions, useSquare, type JobDetail } from "@/lib/square";
import { deployment, isTestnet } from "@/lib/stellar";
import { describeError, useTx } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import type { SquareClient, TransactionResult } from "@squaresdk/core/stellar";

/** sha256 of what the user typed: a real digest of a real note, computed here. */
async function digestOf(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function hexOf(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function bytes32FromInput(value: string): Uint8Array | null {
  const hex = value.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

interface ActionContext {
  id: bigint;
  square: SquareClient | null;
  address: string | null;
  busy: boolean;
  run: <T>(label: string, fn: () => Promise<TransactionResult<T>>) => Promise<TransactionResult<T> | undefined>;
}

function ActionCard({
  title,
  description,
  children,
  buttonLabel,
  onClick,
  disabled = false,
  ctx,
}: {
  title: string;
  description: ReactNode;
  children?: ReactNode;
  buttonLabel: string;
  onClick: () => void;
  disabled?: boolean;
  ctx: ActionContext;
}) {
  const unconnected = ctx.address === null || ctx.square === null;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-fog bg-paper-white p-6">
      <div>
        <h3 className="text-body font-medium text-carbon">{title}</h3>
        <div className="mt-1 flex flex-col gap-2 text-caption text-graphite">{description}</div>
      </div>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton size="sm" onClick={onClick} disabled={disabled || ctx.busy || unconnected}>
          {buttonLabel}
        </PrimaryButton>
        {unconnected ? <span className="text-caption text-ash">Connect a wallet to sign.</span> : null}
      </div>
    </div>
  );
}

function SetProviderAction({ ctx }: { ctx: ActionContext }) {
  const [value, setValue] = useState("");
  const parsed = readAddressInput(value);
  const provider = parsed.kind === "valid" ? parsed.address : null;
  return (
    <ActionCard
      title="Name the provider"
      description="The job was opened without one. Only the client can name it, and only while the job is Open."
      buttonLabel="Set provider"
      disabled={provider === null}
      ctx={ctx}
      onClick={() => {
        const { square, address } = ctx;
        if (square === null || address === null || provider === null) return;
        void ctx.run("Set provider", () => setProvider(square, address, ctx.id, provider));
      }}
    >
      <Field label="Provider" htmlFor="set-provider" error={addressInputError(parsed)}>
        <input id="set-provider" className={inputClass} value={value} onChange={(event) => setValue(event.target.value)} placeholder="GA…" spellCheck={false} />
      </Field>
    </ActionCard>
  );
}

function SetBudgetAction({ ctx, token, current }: { ctx: ActionContext; token: string; current: bigint }) {
  const [value, setValue] = useState("");
  const amount = value.trim().length === 0 ? null : parseAmount(value);
  return (
    <ActionCard
      title="Agree the budget"
      description={
        <>
          <span>The client or the provider may set it while the job is Open. It is what funding moves.</span>
          <span>{current > 0n ? `Currently ${formatAmount(current)} ${token}.` : "No budget set yet."}</span>
        </>
      }
      buttonLabel="Set budget"
      disabled={amount === null || amount <= 0n}
      ctx={ctx}
      onClick={() => {
        const { square, address } = ctx;
        if (square === null || address === null || amount === null) return;
        void ctx.run("Set budget", () => setBudget(square, address, ctx.id, amount));
      }}
    >
      <Field label={`Budget (${token})`} htmlFor="set-budget" error={value.trim().length > 0 && amount === null ? "Enter an amount with up to seven decimals." : null}>
        <input id="set-budget" inputMode="decimal" className={inputClass} value={value} onChange={(event) => setValue(event.target.value)} placeholder="0.00" />
      </Field>
    </ActionCard>
  );
}

function FundAction({ ctx, token, budget, balance }: { ctx: ActionContext; token: string; budget: bigint; balance: bigint | undefined }) {
  const short = balance !== undefined && balance < budget;
  return (
    <ActionCard
      title="Fund the escrow"
      description={
        <>
          <span>
            One signature moves {formatAmount(budget)} {token} into the kernel and fixes the fee basis points on the job. There is no approval step: the transfer is
            authorized inside the same call.
          </span>
          <span>The expected budget is sent with it, so a budget changed in between is refused rather than funded by surprise.</span>
          {short ? (
            <span className="text-magenta">
              This wallet holds {formatAmount(balance ?? 0n)} {token}, less than the budget. {isTestnet ? "Friendbot funds a testnet account with XLM." : "Top it up before funding."}
            </span>
          ) : null}
        </>
      }
      buttonLabel={`Fund ${formatAmount(budget)} ${token}`}
      disabled={budget <= 0n || short}
      ctx={ctx}
      onClick={() => {
        const { square, address } = ctx;
        if (square === null || address === null) return;
        void ctx.run("Fund", () => fund(square, address, ctx.id, budget));
      }}
    />
  );
}

function SubmitAction({ ctx, deadline, now }: { ctx: ActionContext; deadline: number; now: number }) {
  const [deliverable, setDeliverable] = useState("");
  const [agent, setAgent] = useState("");
  const digest = bytes32FromInput(deliverable);
  const agentId = agent.trim().length === 0 ? null : Number.parseInt(agent.trim(), 10);
  const agentError = agent.trim().length > 0 && (agentId === null || !Number.isInteger(agentId) || agentId < 0) ? "An agent id is a whole number." : null;
  return (
    <ActionCard
      title="Submit the deliverable"
      description={
        <>
          <span>The provider submits the 32-byte hash of the work. Only the hash is on chain; the work itself travels your own way.</span>
          <span>
            The deadline is {formatTimestamp(deadline)} ({formatCountdown(deadline, now)}), the expiry less the settlement horizon.
          </span>
        </>
      }
      buttonLabel="Submit"
      disabled={digest === null || agentError !== null}
      ctx={ctx}
      onClick={() => {
        const { square, address } = ctx;
        if (square === null || address === null || digest === null) return;
        void ctx.run("Submit", () => submit(square, address, ctx.id, digest, { agentId: agentError === null && agentId !== null ? agentId : null, requestHash: null }));
      }}
    >
      <Field
        label="Deliverable hash"
        htmlFor="deliverable"
        error={deliverable.trim().length > 0 && digest === null ? "32 bytes of hex, with or without 0x." : null}
        hint="sha256 or keccak256 of what you delivered."
      >
        <input id="deliverable" className={inputClass} value={deliverable} onChange={(event) => setDeliverable(event.target.value)} placeholder="0x…" spellCheck={false} />
      </Field>
      <Field label="Agent id (optional)" htmlFor="agent-id" error={agentError} hint="The 8004 agent you submit as. The hook checks that it is yours.">
        <input id="agent-id" inputMode="numeric" className={inputClass} value={agent} onChange={(event) => setAgent(event.target.value)} placeholder="0" />
      </Field>
    </ActionCard>
  );
}

function NoteAction({
  ctx,
  title,
  description,
  buttonLabel,
  label,
  placeholder,
  send,
}: {
  ctx: ActionContext;
  title: string;
  description: ReactNode;
  buttonLabel: string;
  label: string;
  placeholder: string;
  send: (square: SquareClient, address: string, note: Uint8Array) => Promise<TransactionResult>;
}) {
  const [note, setNote] = useState("");
  const ready = note.trim().length > 0;
  return (
    <ActionCard
      title={title}
      description={description}
      buttonLabel={buttonLabel}
      disabled={!ready}
      ctx={ctx}
      onClick={() => {
        const { square, address } = ctx;
        if (square === null || address === null || !ready) return;
        void ctx.run(label, async () => send(square, address, await digestOf(note.trim())));
      }}
    >
      <Field label="Reason" htmlFor={`${label}-note`} hint="Only its sha256 goes on chain; keep the text if you need to show it later.">
        <textarea id={`${label}-note`} className={`${inputClass} min-h-20`} value={note} onChange={(event) => setNote(event.target.value)} placeholder={placeholder} />
      </Field>
    </ActionCard>
  );
}

function Row({ label, children, muted = false }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-fog py-3 last:border-b-0">
      <dt className="shrink-0 text-caption text-graphite">{label}</dt>
      <dd className={`min-w-0 text-right text-body tabular-nums ${muted ? "text-ash" : "text-carbon"}`}>{children}</dd>
    </div>
  );
}

function Actions({ detail, ctx, token, now, balance }: { detail: JobDetail; ctx: ActionContext; token: string; now: number; balance: bigint | undefined }) {
  const keeper = deployment?.keeperEvaluator ?? "";
  const { address } = ctx;
  const isClient = address !== null && address === detail.client;
  const isProvider = address !== null && address === detail.provider;
  const isEvaluator = address !== null && address === detail.evaluator;
  const cards: ReactNode[] = [];

  if (isClient && detail.status === "Open" && detail.provider === null) cards.push(<SetProviderAction key="provider" ctx={ctx} />);
  if ((isClient || isProvider) && detail.status === "Open") cards.push(<SetBudgetAction key="budget" ctx={ctx} token={token} current={detail.budget} />);
  if (isClient && detail.status === "Open" && detail.provider !== null && detail.budget > 0n) {
    cards.push(<FundAction key="fund" ctx={ctx} token={token} budget={detail.budget} balance={balance} />);
  }
  if (isProvider && submitAvailable(detail, now)) cards.push(<SubmitAction key="submit" ctx={ctx} deadline={submitDeadline(detail)} now={now} />);
  if (isClient && disputeAvailable(detail, keeper, now)) {
    cards.push(
      <NoteAction
        key="dispute"
        ctx={ctx}
        title="Dispute the submission"
        description={
          <>
            <span>The challenge window is open until {formatTimestamp(detail.challengeEnd)}. A dispute stops the finalize and puts the decision to the arbiters.</span>
            <span>It pulls a bond from this wallet in the same signature; the bond returns if the dispute is upheld or lapses.</span>
          </>
        }
        buttonLabel="Dispute"
        label="Dispute"
        placeholder="What is wrong with the deliverable"
        send={(square, address, note) => dispute(square, address, ctx.id, note)}
      />,
    );
  }
  if (finalizeAvailable(detail, keeper, now)) {
    cards.push(
      <ActionCard
        key="finalize"
        title="Finalize"
        description={
          <>
            <span>The challenge window closed and nobody disputed. Anyone may finalize; the payee is credited and the caller takes the evaluator fee.</span>
            <span>The keeper evaluator does this on its own too; this button is the same call.</span>
          </>
        }
        buttonLabel="Finalize"
        ctx={ctx}
        onClick={() => {
          const { square, address } = ctx;
          if (square === null || address === null) return;
          void ctx.run("Finalize", () => finalize(square, address, ctx.id));
        }}
      />,
    );
  }
  if ((isEvaluator && (detail.status === "Funded" || detail.status === "Submitted")) || (isClient && detail.status === "Open")) {
    cards.push(
      <NoteAction
        key="reject"
        ctx={ctx}
        title="Reject"
        description={
          detail.status === "Open"
            ? "The job has not been funded. Rejecting closes it."
            : "You are the evaluator on this job. Rejecting refunds the client the whole escrow."
        }
        buttonLabel="Reject"
        label="Reject"
        placeholder="Why the work is refused"
        send={(square, address, note) => reject(square, address, ctx.id, note)}
      />,
    );
  }
  if (refundAvailable(detail, keeper, now)) {
    cards.push(
      <ActionCard
        key="refund"
        title="Claim the refund"
        description="The expiry passed with nothing settled and no optimistic evaluator holding the job. Anyone may crank it; the escrow is credited back to the client."
        buttonLabel="Claim refund"
        ctx={ctx}
        onClick={() => {
          const { square } = ctx;
          if (square === null) return;
          void ctx.run("Claim refund", () => claimRefund(square, ctx.id));
        }}
      />,
    );
  }

  if (cards.length === 0) {
    return (
      <PanelCard title="Nothing to do here" description="No action on this job is open to the connected wallet right now.">
        <p className="text-caption text-graphite">
          {address === null ? "Connect a wallet to see what it can do." : "Another party acts next, or the job has settled."}
        </p>
      </PanelCard>
    );
  }
  return <div className="flex flex-col gap-4">{cards}</div>;
}

function Withdrawable({ ctx, token }: { ctx: ActionContext; token: string }) {
  const positions = usePositions(ctx.address ?? undefined);
  const owed = positions.data?.withdrawable ?? 0n;
  if (ctx.address === null || owed === 0n) return null;
  return (
    <ActionCard
      title="Withdraw what you are owed"
      description={`The kernel credits a ledger rather than pushing: ${formatAmount(owed)} ${token} is yours to take, from this job or any other.`}
      buttonLabel="Withdraw"
      ctx={ctx}
      onClick={() => {
        const { square, address } = ctx;
        if (square === null || address === null) return;
        void ctx.run("Withdraw", () => withdrawTo(square, address, address, owed));
      }}
    />
  );
}

/**
 * Where the budget goes, at the basis points the record carries. Before
 * funding these are the current parameters; from `fund` on they are the ones
 * snapshotted on the job, and after a decision the net is split at the share
 * the settlement decided.
 */
function PayoutPanel({ detail, token }: { detail: JobDetail; token: string }) {
  const split = payoutSplit(detail, detail.netPayout);
  const decided = detail.status === "Completed";
  const amount = (value: number) => `${formatCompactAmount(value)} ${token}`;
  const segments: Segment[] = [
    { key: "provider", label: decided && split.providerBps < 10_000 ? "To the payee" : "Net payout", value: split.providerShare, color: chartColors.lavender, display: amount(split.providerShare) },
    ...(split.clientShare > 0 ? [{ key: "client", label: "Back to the client", value: split.clientShare, color: chartColors.magenta, display: amount(split.clientShare) }] : []),
    { key: "platform", label: `Platform ${formatBps(detail.platformFeeBp)}`, value: split.platformFee, color: chartColors.carbon, display: amount(split.platformFee) },
    { key: "evaluator", label: `Evaluator ${formatBps(detail.evaluatorFeeBp)}`, value: split.evaluatorFee, color: chartColors.amber, display: amount(split.evaluatorFee) },
  ];
  return (
    <PanelCard
      title="Payout split"
      description={
        detail.fundedAt === 0
          ? "Not funded yet, so these are the parameters the kernel would snapshot, not a commitment."
          : decided
            ? `Settled at ${formatBps(split.providerBps)} to the payee; the rest of the net was credited back to the client.`
            : "The fees are fixed at funding, so the net payout is already known."
      }
    >
      <SegmentBar segments={segments} total={split.budget} ariaLabel={`How the ${amount(split.budget)} budget of job ${detail.id.toString()} divides`} />
    </PanelCard>
  );
}

function Facts({ detail, token }: { detail: JobRecord & { id: bigint; netPayout: bigint; challengeEnd: number }; token: string }) {
  return (
    <PanelCard title="The record" description="What the kernel stores for this job.">
      <dl className="flex flex-col">
        <Row label="Budget">
          <Amount value={detail.budget} />
        </Row>
        <Row label={`Platform fee ${formatBps(detail.platformFeeBp)}`} muted={detail.fundedAt === 0}>
          <Amount value={(detail.budget * BigInt(detail.platformFeeBp)) / 10_000n} />
        </Row>
        <Row label={`Evaluator fee ${formatBps(detail.evaluatorFeeBp)}`} muted={detail.fundedAt === 0}>
          <Amount value={(detail.budget * BigInt(detail.evaluatorFeeBp)) / 10_000n} />
        </Row>
        <Row label="Net payout">
          <Amount value={detail.netPayout} />
        </Row>
        <Row label="Created">{formatTimestamp(detail.createdAt)}</Row>
        <Row label="Funded" muted={detail.fundedAt === 0}>
          {detail.fundedAt === 0 ? "Not funded" : formatTimestamp(detail.fundedAt)}
        </Row>
        <Row label="Submitted" muted={detail.submittedAt === 0}>
          {detail.submittedAt === 0 ? "Not submitted" : formatTimestamp(detail.submittedAt)}
        </Row>
        <Row label="Expires">{formatTimestamp(detail.expiredAt)}</Row>
        <Row label="Settlement horizon">{formatDuration(detail.settlementHorizon)}</Row>
        <Row label="Deliverable" muted={detail.submittedAt === 0}>
          {detail.submittedAt === 0 ? "Not submitted" : <span title={detail.deliverable}>{shortHash(detail.deliverable)}</span>}
        </Row>
        <Row label="Evaluator">
          <AddressLink address={detail.evaluator} />
        </Row>
        <Row label="Hook" muted={detail.hook === null}>
          {detail.hook === null ? "None" : <AddressLink address={detail.hook} />}
        </Row>
        <Row label="Paid in">{token}</Row>
      </dl>
    </PanelCard>
  );
}

/**
 * One job, and what the connected wallet can do with it (#39). Every action is
 * the contract call behind it: the gates here are the same conditions the
 * kernel enforces, so a button that is shown is a call that simulates.
 */
export function JobView() {
  const params = useSearchParams();
  const raw = params.get("id");
  const id = raw !== null && /^\d+$/.test(raw) ? BigInt(raw) : null;
  const now = useNow();
  const job = useJob(id);
  const square = useSquare();
  const { address } = useWallet();
  const { run, busy } = useTx();
  const token = usePaymentTokenLabel();
  const positions = usePositions(address ?? undefined);

  if (id === null) {
    return (
      <div className="flex flex-col gap-8">
        <SectionHeading title="Job" description="Open a job from the dashboard." />
        <EmptyState title="No job id" hint="This page takes an id, as /job?id=1." action={<PrimaryButton href="/dashboard">Back to the dashboard</PrimaryButton>} />
      </div>
    );
  }

  if (job.isPending) {
    return (
      <div className="flex flex-col gap-8">
        <SectionHeading title={`Job #${id.toString()}`} description="Reading the job from the chain." />
        <EmptyState title="Reading the chain" />
      </div>
    );
  }

  if (job.isError) {
    return (
      <div className="flex flex-col gap-8">
        <SectionHeading title={`Job #${id.toString()}`} description="The chain read failed." />
        <EmptyState title="The chain read failed" hint={describeError(job.error)} />
      </div>
    );
  }

  const detail = job.data;
  if (detail === null || detail === undefined) {
    return (
      <div className="flex flex-col gap-8">
        <SectionHeading title={`Job #${id.toString()}`} description="No such job." />
        <EmptyState title="No such job" hint="The kernel's job counter is below this id." action={<PrimaryButton href="/dashboard">Back to the dashboard</PrimaryButton>} />
      </div>
    );
  }

  const phase = jobPhase(detail, now);
  const ctx: ActionContext = { id, square, address, busy, run };
  const keeper = deployment?.keeperEvaluator ?? "";
  const clock = settlementClock({
    createdAt: detail.createdAt,
    fundedAt: detail.fundedAt,
    submittedAt: detail.submittedAt,
    expiredAt: detail.expiredAt,
    challengeEnd: detail.challengeEnd,
    disputedAt: 0,
    resolveBy: 0,
    status: detail.status,
    now,
  });

  return (
    <div className="flex flex-col gap-12">
      <SectionHeading
        title={`Job #${id.toString()}`}
        description={detail.description}
        actions={
          <span className="flex items-center gap-3">
            <StatusPill label={PHASE_LABELS[phase]} tone={phaseTone[phase]} />
            {address === null ? <WalletButton /> : null}
          </span>
        }
      />

      {detail.status === "Submitted" && keeperEvaluates(detail, keeper) ? (
        <PanelCard
          title={detail.disputed ? "Disputed" : challengeWindowClosed(detail.challengeEnd, now) ? "The window has closed" : "In the challenge window"}
          description={
            detail.disputed
              ? "A dispute is open, so the keeper cannot finalize. The arbiters decide."
              : detail.challengeEnd === 0
                ? "This job has no window: its evaluator is not the keeper."
                : `${formatCountdown(detail.challengeEnd, now)} — ${formatTimestamp(detail.challengeEnd)}`
          }
        >
          <SettlementClock clock={clock} />
        </PanelCard>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Actions detail={detail} ctx={ctx} token={token} now={now} balance={positions.data?.token} />
          <Withdrawable ctx={ctx} token={token} />
        </div>
        <div className="flex flex-col gap-4">
          <PartiesPanel client={detail.client} provider={detail.provider} payee={detail.payee} submitted={detail.submittedAt > 0} />
          <PayoutPanel detail={detail} token={token} />
          <Facts detail={detail} token={token} />
        </div>
      </div>
    </div>
  );
}
