"use client";

import { useState } from "react";

import { AddressLink, TxLink } from "@/components/AddressLink";
import { EmptyState } from "@/components/EmptyState";
import { Field, inputClass } from "@/components/Field";
import { GhostButton } from "@/components/GhostButton";
import { PanelCard } from "@/components/PanelCard";
import { PillToggle } from "@/components/PillToggle";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionHeading } from "@/components/SectionHeading";
import { WalletButton } from "@/components/WalletButton";
import type { Anchor } from "@squaresdk/core/stellar";
import { Asset } from "@stellar/stellar-sdk";

import { sep6StatusCopy } from "@/lib/anchorStatus";
import { depositableAsset, openAnchorTrustline, useAnchor, useAnchorTrustline, useDeposit, useWithdraw } from "@/lib/anchor";
import { formatAmount } from "@/lib/format";
import { useSquare } from "@/lib/square";
import { anchorDomain, anchorFiat, network } from "@/lib/stellar";
import { describeError, useTx } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

const AMOUNTS = ["100", "250", "500"];

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-caption tabular-nums ${done ? "bg-mint-wash text-carbon" : "bg-mist text-graphite"}`}
      >
        {done ? "✓" : n}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-body font-medium text-carbon">{title}</p>
        <div className="flex flex-col gap-2 text-caption text-graphite">{children}</div>
      </div>
    </li>
  );
}

/**
 * The fiat rail into a wallet (#58): lira in through an anchor's SEP flows,
 * the asset out in the wallet, ready to fund a job.
 *
 * The anchor on testnet simulates the bank leg. That is said at the top, in
 * the step that waits for it, and next to the result — not once in small
 * print — because the one thing a person must not misread here is whether
 * real money moved.
 */
export function DepositView() {
  const { address } = useWallet();
  const client = useSquare();
  const anchor = useAnchor();
  const asset = depositableAsset(anchor.data ?? undefined);
  const assetContract = asset === null ? undefined : anchorAssetContract(anchor.data, asset.code);
  const trustline = useAnchorTrustline(assetContract);
  const { state, start, reset } = useDeposit();
  const out = useWithdraw();
  const [iban, setIban] = useState("");
  const [outAmount, setOutAmount] = useState("1");
  const { run, busy } = useTx();
  const [amount, setAmount] = useState(AMOUNTS[1] ?? "250");

  const fiat = asset?.fiat ?? anchorFiat;
  const settled = state.stage === "done" || state.stage === "handed-over" || state.stage === "failed";
  const running = state.stage !== "idle" && !settled;
  const trustlineOpen = trustline.data?.open === true;

  return (
    <div className="flex flex-col gap-10">
      <SectionHeading
        title={`Put ${fiat} in, get a balance you can spend`}
        description={`The job is funded on Stellar, so the money has to get there first. ${anchorDomain} takes ${fiat} and pays the asset into your wallet, over the SEP standards every Stellar anchor speaks.`}
      />

      <PanelCard
        title="This anchor is a sandbox"
        description={`${anchorDomain} simulates the bank leg: no ${fiat} moves anywhere, and nothing here can cost you money. What it pays into your wallet is real testnet USDC, and every request below is a real SEP request to a real anchor.`}
      >
        <p className="text-caption text-graphite">
          It is the one endpoint serving {fiat} ⇄ USDC on testnet. A production anchor speaks the same four standards — SEP-1 to find it, SEP-10 to
          sign in, SEP-38 to quote, SEP-6 to move the money — so nothing in this screen changes when the rail becomes a real one.
        </p>
      </PanelCard>

      {anchor.isError ? (
        <EmptyState title={`${anchorDomain} did not answer`} hint={describeError(anchor.error)} />
      ) : (
        <ol className="flex flex-col gap-6">
          <Step n={1} title={address === null ? "Connect a wallet" : "Wallet connected"} done={address !== null}>
            {address === null ? (
              <>
                <p>The anchor signs you in by asking your wallet to sign a challenge — SEP-10. It never sees your key, and neither does this page.</p>
                <WalletButton />
              </>
            ) : (
              <p>
                The anchor will pay into <AddressLink address={address} />.
              </p>
            )}
          </Step>

          <Step n={2} title={trustlineOpen ? `Your account accepts ${asset?.code ?? "the asset"}` : `Let your account hold ${asset?.code ?? "the asset"}`} done={trustlineOpen}>
            {address === null ? (
              <p>An issued asset reaches an account only if that account has opted in. This step does that, once.</p>
            ) : trustlineOpen ? (
              <p>
                Balance {formatAmount(trustline.data?.balance ?? 0n)} {asset?.code}. The anchor can pay it.
              </p>
            ) : (
              <>
                <p>
                  On Stellar an issued asset reaches an account only if the account has opted in first — a trustline. It is one signature and it
                  costs a fraction of a cent. Without it the anchor has nowhere to send the money.
                </p>
                <div>
                  <PrimaryButton
                    size="sm"
                    disabled={busy || client === null || assetContract === undefined}
                    onClick={() => {
                      if (client === null || address === null || assetContract === undefined) return;
                      void run(`Accept ${asset?.code ?? "the asset"}`, () => openAnchorTrustline(client, address, assetContract)).then(() =>
                        trustline.refetch(),
                      );
                    }}
                  >
                    Accept {asset?.code ?? "the asset"}
                  </PrimaryButton>
                </div>
              </>
            )}
          </Step>

          <Step n={3} title={`Ask the anchor for ${fiat}`} done={state.stage === "done" || state.stage === "handed-over"}>
            <p>
              You tell it how much {fiat} you are sending; it quotes a rate, waits for the transfer, then pays the asset into your wallet. A real
              anchor gives you bank details and waits for the money; this sandbox gives you a page with a button that plays the bank, and the link
              to it appears below once the deposit is open.
            </p>
            <Field label={`Amount in ${fiat}`} htmlFor="deposit-amount">
              <input
                id="deposit-amount"
                inputMode="decimal"
                className={inputClass}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={running}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              {AMOUNTS.map((preset) => (
                <PillToggle key={preset} selected={amount === preset} onClick={() => setAmount(preset)}>
                  {preset} {fiat}
                </PillToggle>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton
                size="sm"
                disabled={running || address === null || !trustlineOpen || amount.trim().length === 0}
                onClick={() => void start(amount.trim())}
              >
                {running ? stageLabel(state.stage) : `Deposit ${amount} ${fiat}`}
              </PrimaryButton>
              {settled ? (
                <GhostButton size="sm" onClick={reset}>
                  Start again
                </GhostButton>
              ) : null}
            </div>
          </Step>
        </ol>
      )}

      {state.stage === "idle" ? null : (
        <PanelCard
          title={
            state.stage === "done"
              ? "The money arrived"
              : state.stage === "handed-over"
                ? "The anchor has it"
                : state.stage === "failed"
                  ? "The anchor stopped"
                  : "Following the deposit"
          }
          description={state.price === null ? undefined : `Quoted at ${state.price} ${fiat} per ${asset?.code ?? "unit"}.`}
        >
          <dl className="flex flex-col gap-3 text-caption">
            {state.transaction === null ? null : (
              <>
                <Row label="Status">
                  <span className="text-carbon">{sep6StatusCopy(state.transaction.status, "deposit", fiat)}</span>{" "}
                  <span className="text-ash">({state.transaction.status})</span>
                </Row>
                {state.transaction.amountIn === undefined ? null : (
                  <Row label={`${fiat} in`}>{state.transaction.amountIn}</Row>
                )}
                {state.transaction.amountOut === undefined ? null : (
                  <Row label={`${asset?.code ?? "Asset"} out`}>{state.transaction.amountOut}</Row>
                )}
                {state.transaction.amountFee === undefined ? null : <Row label="Anchor fee">{state.transaction.amountFee}</Row>}
                {state.transaction.stellarTransactionId === undefined ? null : (
                  <Row label="On chain">
                    <TxLink hash={state.transaction.stellarTransactionId} />
                  </Row>
                )}
                {state.transaction.moreInfoUrl === undefined ? null : (
                  <Row label={state.transaction.status === "pending_user_transfer_start" ? "Send the money here" : "The anchor's page"}>
                    <a className="underline" href={state.transaction.moreInfoUrl} target="_blank" rel="noreferrer">
                      {state.transaction.status === "pending_user_transfer_start" ? "open the anchor's page and play the bank" : "open"}
                    </a>
                  </Row>
                )}
              </>
            )}
            {state.instructions?.how === undefined ? null : <Row label="How to send it">{state.instructions.how}</Row>}
            {state.error === null ? null : <Row label="What happened">{state.error}</Row>}
          </dl>

          {state.stage === "handed-over" ? (
            <p className="mt-4 text-caption text-graphite">
              Your side is done: the anchor has taken the {fiat} and owes the payout. It can take a while to send it, and it is not waited on here —
              the balance in step 2 is what says when it lands, and it refreshes by itself.
            </p>
          ) : null}
          {state.stage === "done" || state.stage === "handed-over" ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <PrimaryButton size="sm" href="/new" disabled={!trustlineOpen || (trustline.data?.balance ?? 0n) === 0n}>
                Open a job with it
              </PrimaryButton>
              <span className="text-caption text-ash">No {fiat} moved: this anchor simulates the bank leg.</span>
            </div>
          ) : null}
        </PanelCard>
      )}

      <PanelCard
        title={`Take it back out as ${fiat}`}
        description={`The same rail in reverse: the anchor names an account and a memo, the asset goes there as a payment carrying that memo — which is how the anchor knows the money is yours — and the ${fiat} leaves at the other end. On this sandbox no ${fiat} arrives anywhere; the payment on Stellar is real.`}
      >
        <div className="flex flex-col gap-4">
          <Field label={`Amount in ${asset?.code ?? "the asset"}`} htmlFor="withdraw-amount">
            <input
              id="withdraw-amount"
              inputMode="decimal"
              className={inputClass}
              value={outAmount}
              onChange={(event) => setOutAmount(event.target.value)}
              disabled={out.state.stage !== "idle" && out.state.stage !== "failed" && out.state.stage !== "done"}
            />
          </Field>
          <Field label="Where the money goes" htmlFor="withdraw-dest" hint="An IBAN or account number, as the anchor asks for it.">
            <input
              id="withdraw-dest"
              className={inputClass}
              value={iban}
              onChange={(event) => setIban(event.target.value)}
              placeholder="TR00 0000 0000 0000 0000 0000 00"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton
              size="sm"
              disabled={
                address === null ||
                !trustlineOpen ||
                iban.trim().length === 0 ||
                outAmount.trim().length === 0 ||
                (trustline.data?.balance ?? 0n) === 0n ||
                (out.state.stage !== "idle" && out.state.stage !== "failed" && out.state.stage !== "done")
              }
              onClick={() => void out.start(outAmount.trim(), iban.trim())}
            >
              {out.state.stage === "idle" || out.state.stage === "failed" || out.state.stage === "done"
                ? `Withdraw ${outAmount} ${asset?.code ?? ""}`.trim()
                : withdrawLabel(out.state.stage)}
            </PrimaryButton>
            {(trustline.data?.balance ?? 0n) === 0n ? (
              <span className="text-caption text-ash">Nothing to withdraw yet: the balance above is zero.</span>
            ) : null}
          </div>
          {out.state.stage === "idle" ? null : (
            <dl className="flex flex-col gap-3 text-caption">
              {out.state.instructions?.accountId === undefined ? null : (
                <Row label="Sent to the anchor">
                  <AddressLink address={out.state.instructions.accountId} />
                  {out.state.instructions.memo === undefined ? null : <span className="text-ash"> memo {out.state.instructions.memo}</span>}
                </Row>
              )}
              {out.state.paymentHash === null ? null : (
                <Row label="On chain">
                  <TxLink hash={out.state.paymentHash} />
                </Row>
              )}
              {out.state.transaction === null ? null : (
                <Row label="Status">
                  <span className="text-carbon">{sep6StatusCopy(out.state.transaction.status, "withdraw", fiat)}</span>{" "}
                  <span className="text-ash">({out.state.transaction.status})</span>
                </Row>
              )}
              {out.state.stage === "handed-over" ? (
                <Row label="Where it stands">The asset is with the anchor; paying the fiat out is its side and is not waited on here.</Row>
              ) : null}
              {out.state.error === null ? null : <Row label="What happened">{out.state.error}</Row>}
            </dl>
          )}
        </div>
      </PanelCard>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-fog pb-2 last:border-b-0">
      <dt className="shrink-0 text-graphite">{label}</dt>
      <dd className="min-w-0 break-words text-right text-carbon">{children}</dd>
    </div>
  );
}

function withdrawLabel(stage: string): string {
  if (stage === "signing") return "Signing in…";
  if (stage === "asking") return "Asking the anchor…";
  if (stage === "sending") return "Sending the asset…";
  return "Waiting for the anchor…";
}

function stageLabel(stage: string): string {
  if (stage === "signing") return "Signing in…";
  if (stage === "quoting") return "Getting a rate…";
  if (stage === "asking") return "Asking the anchor…";
  return "Waiting for the anchor…";
}

/**
 * The asset's Stellar Asset Contract. A SAC id is derived from the asset and
 * the network's passphrase rather than looked up, so the anchor's `code` and
 * `issuer` are the whole input and nothing has to be configured here.
 */
function anchorAssetContract(anchor: Anchor | undefined, code: string): string | undefined {
  const currency = anchor?.currencies.find((entry) => entry.code === code);
  if (currency?.issuer === undefined) return undefined;
  return new Asset(currency.code, currency.issuer).contractId(network.networkPassphrase);
}
