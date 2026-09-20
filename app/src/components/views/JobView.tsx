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
      title="Name the price"
      description={
        <>
          <span>Either side may name the price while the job is still open. Nothing is committed by naming it: the client accepts by funding exactly this amount, and a price changed afterwards cannot be funded by surprise.</span>
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
      title="Fund the job"
      description={
        <>
          <span>
            One signature moves {formatAmount(budget)} {token} out of your wallet and into the contract. It is not ours and not the agent&apos;s while it
            sits there: the contract releases it to the agent when the work is accepted, or back to you if you reject.
          </span>
          <span>Stellar has no separate approval step — the transfer is authorized inside the same signature — and the amount you are agreeing to is sent with the call, so a price changed in between is refused rather than charged.</span>
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
  const [text, setText] = useState("");
  const [hash, setHash] = useState("");
  const [hashing, setHashing] = useState(false);
  const typed = bytes32FromInput(hash);
  const ready = text.trim().length > 0 || typed !== null;

  // Hashing the work here is the point: the contract stores 32 bytes, and the
  // person delivering should not have to find a tool to produce them.
  async function send(): Promise<void> {
    const { square } = ctx;
    if (square === null || !ready) return;
    setHashing(true);
    try {
      const digest = typed ?? (await digestOf(text.trim()));
      await ctx.run("Submit", () => square.submit(ctx.id, digest));
    } finally {
      setHashing(false);
    }
  }

  return (
    <ActionCard
      title="Deliver the work"
      description={
        <>
          <span>
            Paste what you produced. The browser takes its SHA-256 — a 64-character fingerprint — and only that goes on chain, so the work
            itself stays with you and is never uploaded here. Anyone holding the same file can recompute the fingerprint and see it matches.
          </span>
          <span>
            Deliver before {formatTimestamp(deadline)} ({formatCountdown(deadline, now)}), after which the job expires and the client can take
            the budget back. Once you deliver, the client has the challenge window to object, and then the payout is yours.
          </span>
        </>
      }
      buttonLabel={hashing ? "Hashing…" : "Deliver"}
      disabled={!ready || hashing}
      ctx={ctx}
      onClick={() => void send()}
    >
      <Field
        label="What you delivered"
        htmlFor="deliverable-text"
        hint="Text, a link, a summary — whatever identifies the work. It is hashed in this browser and not sent anywhere."
      >
        <textarea
          id="deliverable-text"
          rows={4}
          className={`${inputClass} min-h-24`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste the deliverable, or a link to it"
          disabled={typed !== null}
        />
      </Field>
      <Field
        label="Or paste a fingerprint you already have"
        htmlFor="deliverable-hash"
        error={hash.trim().length > 0 && typed === null ? "A fingerprint is 64 hex characters (32 bytes), with or without a leading 0x." : null}
        hint="For a file hashed elsewhere: shasum -a 256 the-file."
      >
        <input
          id="deliverable-hash"
          className={inputClass}
          value={hash}
          onChange={(event) => setHash(event.target.value)}
          placeholder="0x…"
          spellCheck={false}
        />
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
            <span>The window to object has passed and the client did not. The agent is credited the budget less the platform fee.</span>
            <span>Anyone at all can send this, including you: the contract does not ask who you are. That is what stops a client settling an agent&apos;s payment by simply never acting.</span>
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
        description="The job passed its expiry with nothing delivered, so the escrow goes back. Anyone can send this; the money is credited to the client either way, who then withdraws it."
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
      description={`${formatAmount(owed)} ${token} is yours. The contract never pushes money at anyone — it waits until you ask for it, which is what stops a payment going to an address that cannot receive it.`}
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
