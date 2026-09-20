"use client";

import { useEffect, useState } from "react";

import { AddressLink, TxLink } from "@/components/AddressLink";
import { Amount } from "@/components/Amount";
import { Field, inputClass } from "@/components/Field";
import { GhostButton } from "@/components/GhostButton";
import { PanelCard } from "@/components/PanelCard";
import { PillToggle } from "@/components/PillToggle";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionHeading } from "@/components/SectionHeading";
import { Step, type StepState } from "@/components/Step";
import { WalletButton } from "@/components/WalletButton";
import { minimumExpiry } from "@/lib/actions";
import { addressInputError, readAddressInput } from "@/lib/address";
import { createJob, setBudget as setBudgetOnChain } from "@/lib/contracts";
import { formatAmount, formatBps, formatDuration, formatTimestamp, fromDatetimeLocal, parseAmount, toDatetimeLocal } from "@/lib/format";
import { deployment, NETWORK_LABEL } from "@/lib/stellar";
import { useNetwork, useNow, usePaymentTokenLabel, useSquare } from "@/lib/square";
import { describeError, useTx } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

const DAY = 86_400;

const EXPIRY_PRESETS = [
  { id: "1d", label: "1 day", seconds: DAY },
  { id: "3d", label: "3 days", seconds: 3 * DAY },
  { id: "1w", label: "1 week", seconds: 7 * DAY },
  { id: "30d", label: "30 days", seconds: 30 * DAY },
] as const;

const BUDGET_PRESETS = ["1", "5", "10", "50"] as const;

/** The kernel's MAX_DESCRIPTION: the description is stored on the job. */
const MAX_DESCRIPTION = 256;

interface Created {
  jobId: bigint;
  createHash: string;
  budgetHash: string | undefined;
  budgetFailed: boolean;
  budget: bigint | null;
  provider: string;
  description: string;
}

function Row({ label, children, muted = false }: { label: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-fog py-3 last:border-b-0">
      <dt className="shrink-0 text-caption text-graphite">{label}</dt>
      <dd className={`min-w-0 text-right text-body tabular-nums ${muted ? "text-ash" : "text-carbon"}`}>{children}</dd>
    </div>
  );
}

/**
 * Opening a job (#39): the client names the provider, the deadline, what the
 * work is and what it pays. The evaluator and the hook are bound at creation
 * from the deployment, as they were on the EVM app; the budget is a second
 * call, and the token moves later, at funding.
 */
export function NewJobView() {
  const now = useNow();
  const network = useNetwork();
  const square = useSquare();
  const { address } = useWallet();
  const { run, busy } = useTx();
  const token = usePaymentTokenLabel();

  const [provider, setProvider] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [expiryPreset, setExpiryPreset] = useState<string>("1w");
  const [expiry, setExpiry] = useState(() => toDatetimeLocal(Math.floor(Date.now() / 1000) + 7 * DAY));
  const [stage, setStage] = useState<"create" | "budget" | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const horizon = network.data?.settlementHorizon ?? null;
  const floor = horizon === null ? null : minimumExpiry(now, horizon);

  // The floor moves with the chain clock, so a preset re-reads it once the
  // horizon is known rather than leaving a date the kernel would refuse.
  useEffect(() => {
    if (floor === null) return;
    const preset = EXPIRY_PRESETS.find((entry) => entry.id === expiryPreset);
    if (preset === undefined) return;
    setExpiry(toDatetimeLocal(Math.max(now + preset.seconds, floor.at + 60)));
  }, [expiryPreset, floor === null, horizon]); // eslint-disable-line react-hooks/exhaustive-deps

  const providerInput = readAddressInput(provider);
  const providerError = addressInputError(providerInput);
  const providerValid = providerInput.kind === "valid";

  const expirySeconds = fromDatetimeLocal(expiry);
  const expiryError =
    expiry.length === 0
      ? null
      : expirySeconds === null
        ? "Enter a date and time."
        : floor !== null && expirySeconds < floor.at
          ? `The expiry must be at least ${formatDuration(floor.horizon + floor.margin)} from now: one settlement horizon of ${formatDuration(floor.horizon)} for the challenge and dispute windows, plus ${formatDuration(floor.margin)} of margin, because submit measures the same horizon again from its own ledger and a job created at the bare minimum could never be submitted.`
          : null;
  const expiryValid = expirySeconds !== null && expiryError === null;

  const descriptionBytes = new TextEncoder().encode(description).length;
  const descriptionError =
    description.trim().length === 0 ? null : descriptionBytes > MAX_DESCRIPTION ? `The kernel stores at most ${MAX_DESCRIPTION} bytes; this is ${descriptionBytes}.` : null;
  const descriptionValid = description.trim().length > 0 && descriptionError === null;

  const budgetAmount = budget.trim().length === 0 ? null : parseAmount(budget);
  const budgetError = budget.trim().length > 0 && budgetAmount === null ? "Enter an amount with up to seven decimals." : null;
  const budgetValid = budgetError === null;

  const connected = address !== null && square !== null;
  const ready = providerValid && expiryValid && descriptionValid && budgetValid && connected && !busy;

  const fees =
    budgetAmount !== null && budgetAmount > 0n && network.data
      ? {
          platform: (budgetAmount * BigInt(network.data.platformFeeBp)) / 10_000n,
          evaluator: (budgetAmount * BigInt(network.data.evaluatorFeeBp)) / 10_000n,
        }
      : null;
  const net = fees && budgetAmount !== null ? budgetAmount - fees.platform - fees.evaluator : null;

  const providerState: StepState = providerValid ? "done" : providerError ? "error" : "todo";
  const expiryState: StepState = expiryValid ? "done" : expiryError ? "error" : "todo";
  const descriptionState: StepState = descriptionValid ? "done" : descriptionError ? "error" : "todo";
  const budgetState: StepState = budgetAmount !== null && budgetAmount > 0n ? "done" : budgetError ? "error" : "todo";

  function chooseExpiry(id: string, seconds: number) {
    setExpiryPreset(id);
    setExpiry(toDatetimeLocal(Math.floor(Date.now() / 1000) + seconds));
  }

  function reset() {
    setCreated(null);
    setProvider("");
    setDescription("");
    setBudget("");
    setExpiryPreset("1w");
    setExpiry(toDatetimeLocal(Math.floor(Date.now() / 1000) + 7 * DAY));
  }

  async function submit() {
    const stack = deployment;
    if (!ready || expirySeconds === null || providerInput.kind !== "valid" || address === null || square === null || stack === null) return;
    setStage("create");
    const result = await run("Create job", () =>
      createJob(square, {
        client: address,
        provider: providerInput.address,
        evaluator: stack.keeperEvaluator,
        expiredAt: expirySeconds,
        description: description.trim(),
        hook: stack.squareHook,
      }),
    );
    if (result === undefined) {
      setStage(null);
      return;
    }
    const jobId = result.result;
    let budgetHash: string | undefined;
    let budgetFailed = false;
    if (budgetAmount !== null && budgetAmount > 0n) {
      setStage("budget");
      const set = await run("Set budget", () => setBudgetOnChain(square, address, jobId, budgetAmount));
      if (set === undefined) budgetFailed = true;
      else budgetHash = set.hash;
    }
    setStage(null);
    setCreated({
      jobId,
      createHash: result.hash,
      budgetHash,
      budgetFailed,
      budget: budgetAmount,
      provider: providerInput.address,
      description: description.trim(),
    });
  }

  const ctaLabel =
    stage === "create"
      ? "Confirm create_job in the wallet"
      : stage === "budget"
        ? "Confirm set_budget in the wallet"
        : budgetAmount !== null && budgetAmount > 0n
          ? "Create job and set budget"
          : "Create job";

  if (created !== null) {
    const href = `/job?id=${created.jobId.toString()}`;
    return (
      <div className="flex flex-col gap-16">
        <SectionHeading title="New job" description={`Opened on ${NETWORK_LABEL}, with the keeper evaluator and the Square hook bound at creation.`} />
        <PanelCard elevated title={`Job #${created.jobId.toString()} is on chain`} description="Both receipts link to the explorer. The job is Open until it is funded.">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
            <dl className="flex flex-col">
              <Row label="create_job">
                <TxLink hash={created.createHash} />
              </Row>
              <Row label="set_budget" muted={created.budgetHash === undefined && !created.budgetFailed}>
                {created.budgetHash !== undefined ? (
                  <TxLink hash={created.budgetHash} />
                ) : created.budgetFailed ? (
                  <span className="text-magenta">Not sent; set it from the job page</span>
                ) : (
                  "Skipped"
                )}
              </Row>
              <Row label="Provider">
                <AddressLink address={created.provider} />
              </Row>
              <Row label="Budget" muted={created.budgetHash === undefined && !created.budgetFailed}>
                {created.budgetHash !== undefined && created.budget !== null ? (
                  <Amount value={created.budget} />
                ) : created.budgetFailed && created.budget !== null ? (
                  <span className="text-magenta">
                    {formatAmount(created.budget)} {token} requested, not set
                  </span>
                ) : (
                  "Not set"
                )}
              </Row>
            </dl>
            <div className="flex flex-col gap-4">
              <p className="text-caption font-medium text-carbon">What happens next</p>
              <ol className="flex flex-col gap-3">
                {[
                  created.budgetHash !== undefined
                    ? { title: "Fund the escrow", body: `Fund from the job page. One signature moves the ${token} and fixes the fee basis points; there is no approval step on Stellar.` }
                    : { title: "Set the budget, then fund", body: "Set a budget on the job page first: funding a job with no budget is refused with ZeroBudget." },
                  { title: "Hand the job to the provider", body: "Share the job link. The provider submits the deliverable hash before the deadline, which is the expiry less the settlement horizon." },
                  {
                    title: "Watch the challenge window",
                    body: `After submission you have ${network.data ? formatDuration(network.data.window.challengeWindow) : "the challenge window"} to dispute; otherwise anyone finalizes and the payee is credited.`,
                  },
                ].map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-mist text-caption tabular-nums text-graphite">
                      {index + 1}
                    </span>
                    <span>
                      <span className="block text-body font-medium text-carbon">{step.title}</span>
                      <span className="block text-caption text-graphite">{step.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex flex-wrap gap-3">
                <PrimaryButton href={href}>Open job #{created.jobId.toString()}</PrimaryButton>
                <GhostButton onClick={reset}>Create another</GhostButton>
              </div>
            </div>
          </div>
          <div className="mt-8 border-t border-fog pt-6">
            <p className="text-caption font-medium text-carbon">What the job says</p>
            <p className="mt-2 max-w-2xl text-body text-graphite">{created.description}</p>
          </div>
        </PanelCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <SectionHeading title="New job" description="Four decisions, one transaction. The keeper evaluator and the Square hook are bound at creation; funding comes after." />

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr] lg:gap-12">
        <form
          className="flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Step number={1} title="Who does the work" description="The provider's address. It is the only account that can submit the deliverable." state={providerState}>
            <Field label="Provider" htmlFor="provider" error={providerError} hint="A Stellar account (G…) or a contract (C…).">
              <input
                id="provider"
                className={inputClass}
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                placeholder="GA…"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </Step>

          <Step
            number={2}
            title="By when"
            description="The expiry. After it, an unsettled job can be refunded to the client."
            state={expiryState}
            aside={floor === null ? null : <span className="text-caption tabular-nums text-graphite">Earliest {formatTimestamp(floor.at)}</span>}
          >
            <div className="flex flex-wrap gap-2" role="group" aria-label="Expiry presets">
              {EXPIRY_PRESETS.map((preset) => (
                <PillToggle key={preset.id} selected={expiryPreset === preset.id} onClick={() => chooseExpiry(preset.id, preset.seconds)}>
                  {preset.label}
                </PillToggle>
              ))}
            </div>
            <Field label="Expires" htmlFor="expiry" error={expiryError} hint="Your local time; the chain reads it in UTC seconds.">
              <input
                id="expiry"
                type="datetime-local"
                className={inputClass}
                value={expiry}
                onChange={(event) => {
                  setExpiryPreset("custom");
                  setExpiry(event.target.value);
                }}
              />
            </Field>
          </Step>

          <Step number={3} title="What the work is" description="Stored on the job and shown to everyone who opens it." state={descriptionState}>
            <Field
              label="Description"
              htmlFor="description"
              error={descriptionError}
              hint={`${descriptionBytes} of ${MAX_DESCRIPTION} bytes. The kernel refuses more with DescriptionTooLong.`}
            >
              <textarea
                id="description"
                className={`${inputClass} min-h-24`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Summarise the filing and return a PDF."
              />
            </Field>
          </Step>

          <Step
            number={4}
            title="What it pays"
            description={`Optional now. A budget is a second signature right after creation; the ${token} itself moves when the job is funded.`}
            state={budgetState}
            last
            aside={
              net !== null ? (
                <span className="text-caption tabular-nums text-graphite">
                  {formatAmount(net)} {token} net to the provider
                </span>
              ) : null
            }
          >
            <div className="flex flex-wrap gap-2" role="group" aria-label="Budget presets">
              {BUDGET_PRESETS.map((preset) => (
                <PillToggle key={preset} selected={budget === preset} onClick={() => setBudget(preset)}>
                  {preset} {token}
                </PillToggle>
              ))}
              <PillToggle selected={budget.length === 0} onClick={() => setBudget("")}>
                Later
              </PillToggle>
            </div>
            <Field label={`Budget (${token})`} htmlFor="budget-amount" error={budgetError} hint="Up to seven decimals. The provider agrees to it before funding.">
              <input
                id="budget-amount"
                inputMode="decimal"
                className={inputClass}
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                placeholder="0.00"
              />
            </Field>
          </Step>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <PrimaryButton type="submit" disabled={!ready}>
              {ctaLabel}
            </PrimaryButton>
            {address === null ? <WalletButton /> : null}
            {network.isError ? <span className="text-caption text-magenta">{describeError(network.error)}</span> : null}
            {deployment === null ? <span className="text-caption text-magenta">This build names no deployment, so nothing can be created.</span> : null}
          </div>
        </form>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <PanelCard elevated title="Preview" description="What create_job writes, and what the budget would split into.">
            <dl className="flex flex-col">
              <Row label="Client" muted={address === null}>
                {address === null ? "No wallet connected" : <AddressLink address={address} />}
              </Row>
              <Row label="Provider" muted={!providerValid}>
                {providerInput.kind === "valid" ? <AddressLink address={providerInput.address} /> : "Not set"}
              </Row>
              <Row label="Expires" muted={!expiryValid}>
                {expiryValid && expirySeconds !== null ? formatTimestamp(expirySeconds) : "Not set"}
              </Row>
              <Row label="Budget" muted={budgetAmount === null || budgetAmount === 0n}>
                {budgetAmount !== null && budgetAmount > 0n ? <Amount value={budgetAmount} /> : "Set later"}
              </Row>
              {fees && net !== null && network.data ? (
                <>
                  <Row label={`Platform fee ${formatBps(network.data.platformFeeBp)}`}>
                    <Amount value={fees.platform} />
                  </Row>
                  <Row label={`Evaluator fee ${formatBps(network.data.evaluatorFeeBp)}`}>
                    <Amount value={fees.evaluator} />
                  </Row>
                  <Row label="Net to the provider">
                    <Amount value={net} className="font-medium" />
                  </Row>
                </>
              ) : null}
            </dl>

            <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-fog bg-linen p-5">
              <p className="text-caption font-medium text-carbon">Bound at creation</p>
              <dl className="flex flex-col gap-2 text-caption">
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Evaluator</dt>
                  <dd>{deployment === null ? <span className="text-ash">No deployment</span> : <AddressLink address={deployment.keeperEvaluator} label="keeper_evaluator" />}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Hook</dt>
                  <dd>{deployment === null ? <span className="text-ash">No deployment</span> : <AddressLink address={deployment.squareHook} label="square_hook" />}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Settlement horizon</dt>
                  <dd className="tabular-nums text-carbon">{horizon === null ? "Reading" : formatDuration(horizon)}</dd>
                </div>
              </dl>
              <p className="text-caption text-ash">
                The horizon is the challenge, dispute and finalize windows in force now, snapshotted onto the job so a later change cannot shorten it.
              </p>
            </div>
          </PanelCard>
        </aside>
      </div>
    </div>
  );
}
