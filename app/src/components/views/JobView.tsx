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
import { budgetAvailable, finalizeAvailable, fundAvailable, refundAvailable, rejectAvailable, submitAvailable, windowClosed } from "@/lib/actions";
import { addressInputError, readAddressInput } from "@/lib/address";
import { chartColors, formatCompactAmount, payoutSplit, settlementClock } from "@/lib/charts";
import { formatAmount, formatBps, formatCountdown, formatDuration, formatTimestamp, parseAmount, shortHash } from "@/lib/format";
import { platformFee, type JobSummary } from "@/lib/job";
import { jobPhase, PHASE_LABELS, useJob, useNow, usePaymentTokenLabel, usePositions, useSquare } from "@/lib/square";
import { isTestnet } from "@/lib/stellar";
import { describeError, useTx } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import type { SquareClient, TransactionResult } from "@squaresdk/core/stellar";

/** The kernel's `MAX_TEXT`: the longest description or rejection reason it stores, in bytes. */
const MAX_TEXT_BYTES = 256;

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
        void ctx.run("Set budget", () => square.setBudget(ctx.id, amount));
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
        void ctx.run("Fund", () => square.fund(ctx.id, budget));
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
        void ctx.run("Submit", () => square.submit(ctx.id, digest));
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
  send: (square: SquareClient, note: string) => Promise<TransactionResult>;
}) {
  const [note, setNote] = useState("");
  const used = new TextEncoder().encode(note.trim()).length;
  const tooLong = used > MAX_TEXT_BYTES;
  const ready = note.trim().length > 0 && !tooLong;
  return (
    <ActionCard
      title={title}
      description={description}
      buttonLabel={buttonLabel}
      disabled={!ready}
      ctx={ctx}
      onClick={() => {
        const { square } = ctx;
        if (square === null || !ready) return;
        void ctx.run(label, () => send(square, note.trim()));
      }}
    >
      <Field
        label="Reason"
        htmlFor={`${label}-note`}
        hint={`The text itself is stored on the job, so keep it short and free of anything private. ${used}/${MAX_TEXT_BYTES} bytes.`}
        error={tooLong ? `The kernel refuses a reason over ${MAX_TEXT_BYTES} bytes (TextTooLong).` : null}
      >
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

function Actions({ detail, ctx, token, now, balance }: { detail: JobSummary; ctx: ActionContext; token: string; now: number; balance: bigint | undefined }) {
  const { address } = ctx;
  const cards: ReactNode[] = [];

  if (budgetAvailable(detail, address)) cards.push(<SetBudgetAction key="budget" ctx={ctx} token={token} current={detail.budget} />);
  if (fundAvailable(detail, address, now)) cards.push(<FundAction key="fund" ctx={ctx} token={token} budget={detail.budget} balance={balance} />);
  if (submitAvailable(detail, address, now)) cards.push(<SubmitAction key="submit" ctx={ctx} deadline={detail.expiredAt} now={now} />);
  if (finalizeAvailable(detail, now)) {
    cards.push(
      <ActionCard
        key="finalize"
        title="Finalize"
        description={
          <>
            <span>The challenge window closed and the client did not reject. The provider is credited the budget less the platform fee, and the fee goes to the kernel&apos;s owner.</span>
            <span>Anyone may send this call — it names nobody — so the provider never depends on the client acting.</span>
          </>
        }
        buttonLabel="Finalize"
        ctx={ctx}
        onClick={() => {
          const { square } = ctx;
          if (square === null) return;
          void ctx.run("Finalize", () => square.finalize(ctx.id));
        }}
      />,
    );
  }
  if (rejectAvailable(detail, address, now)) {
    cards.push(
      <NoteAction
        key="reject"
        ctx={ctx}
        title="Reject"
        description={
          detail.status === "Open"
            ? "Nothing is escrowed yet. Rejecting closes the job."
            : detail.status === "Funded"
              ? "Rejecting closes the job and credits the whole budget back to you, to be withdrawn."
              : `The window is open until ${formatTimestamp(detail.finalizeAfter)}. Rejecting inside it takes the whole budget back; after it, only finalize is left.`
        }
        buttonLabel="Reject"
        label="Reason"
        placeholder="Why the work is refused"
        send={(square, note) => square.reject(ctx.id, note)}
      />,
    );
  }
  if (refundAvailable(detail, now)) {
    cards.push(
      <ActionCard
        key="refund"
        title="Claim the refund"
        description="The job expired without a submission. Anyone may crank this; the budget is credited back to the client, who withdraws it."
        buttonLabel="Claim refund"
        ctx={ctx}
        onClick={() => {
          const { square } = ctx;
          if (square === null) return;
          void ctx.run("Claim refund", () => square.claimRefund(ctx.id));
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
        void ctx.run("Withdraw", () => square.withdrawTo(address, owed));
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
function PayoutPanel({ detail, token }: { detail: JobSummary; token: string }) {
  const split = payoutSplit(detail);
  const amount = (value: number) => `${formatCompactAmount(value)} ${token}`;
  const segments: Segment[] = [
    { key: "provider", label: "To the provider", value: split.payout, color: chartColors.lavender, display: amount(split.payout) },
    { key: "platform", label: `Platform fee ${formatBps(detail.platformFeeBps)}`, value: split.platformFee, color: chartColors.carbon, display: amount(split.platformFee) },
  ];
  return (
    <PanelCard
      title="Payout split"
      description={
        detail.status === "Completed"
          ? "Settled. The provider was credited the budget less the fee, and the fee went to the kernel's owner."
          : detail.status === "Rejected" || detail.status === "Expired"
            ? "Closed without a payout: the whole budget was credited back to the client."
            : "The basis points are the job's own, so the payout is known before the window closes."
      }
    >
      <SegmentBar segments={segments} total={split.budget} ariaLabel={`How the ${amount(split.budget)} budget of job ${detail.id.toString()} divides`} />
    </PanelCard>
  );
}

function Facts({ detail, token }: { detail: JobSummary; token: string }) {
  const fee = platformFee(detail);
  return (
    <PanelCard title="The record" description="What the kernel stores for this job.">
      <dl className="flex flex-col">
        <Row label="Budget">
          <Amount value={detail.budget} />
        </Row>
        <Row label={`Platform fee ${formatBps(detail.platformFeeBps)}`}>
          <Amount value={fee} />
        </Row>
        <Row label="Payout on finalize">
          <Amount value={detail.budget - fee} />
        </Row>
        <Row label="Created">{formatTimestamp(detail.createdAt)}</Row>
        <Row label="Funded" muted={detail.fundedAt === 0}>
          {detail.fundedAt === 0 ? "Not funded" : formatTimestamp(detail.fundedAt)}
        </Row>
        <Row label="Submitted" muted={detail.submittedAt === 0}>
          {detail.submittedAt === 0 ? "Not submitted" : formatTimestamp(detail.submittedAt)}
        </Row>
        <Row label="Expires">{formatTimestamp(detail.expiredAt)}</Row>
        <Row label="Challenge window">{formatDuration(detail.challengeWindow)}</Row>
        <Row label="Finalize after" muted={detail.finalizeAfter === 0}>
          {detail.finalizeAfter === 0 ? "Not submitted" : formatTimestamp(detail.finalizeAfter)}
        </Row>
        <Row label="Deliverable" muted={detail.deliverable === null}>
          {detail.deliverable === null ? "Not submitted" : <span title={hexOf(detail.deliverable)}>{shortHash(hexOf(detail.deliverable))}</span>}
        </Row>
        <Row label="Provider">
          <AddressLink address={detail.provider} />
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
  const clock = settlementClock({
    createdAt: detail.createdAt,
    fundedAt: detail.fundedAt,
    submittedAt: detail.submittedAt,
    expiredAt: detail.expiredAt,
    finalizeAfter: detail.finalizeAfter,
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

      {detail.status === "Submitted" ? (
        <PanelCard
          title={windowClosed(detail, now) ? "The window has closed" : "In the challenge window"}
          description={
            windowClosed(detail, now)
              ? "The client did not reject in time. Anyone may finalize now, and the provider is credited."
              : `${formatCountdown(detail.finalizeAfter, now)} — the client may still reject until ${formatTimestamp(detail.finalizeAfter)}`
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
          <PartiesPanel client={detail.client} provider={detail.provider} />
          <PayoutPanel detail={detail} token={token} />
          <Facts detail={detail} token={token} />
        </div>
      </div>
    </div>
  );
}
