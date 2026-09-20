"use client";

import { useState } from "react";

import { PanelCard } from "@/components/PanelCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { WalletButton } from "@/components/WalletButton";
import { formatAmount } from "@/lib/format";
import { usePaymentTokenLabel, usePositions } from "@/lib/square";
import { friendbotUrl, NETWORK_LABEL } from "@/lib/stellar";
import { useWallet } from "@/lib/wallet";

/**
 * The first screen for someone who has not done this before (#63).
 *
 * It is not a tour: it reads where the person actually is — no wallet, a
 * wallet with nothing in it, or ready — and shows only the next thing. It
 * disappears once they have a funded account and a job, because a panel that
 * stays after it is answered is furniture.
 */

/** Enough to pay a fee and fund a small job; below this the first job fails at the wallet. */
const ENOUGH_TO_START = 10_000_000n; // 1 token

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-mist text-caption tabular-nums text-graphite">
        {n}
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-body font-medium text-carbon">{title}</p>
        <div className="flex flex-col gap-2 text-caption text-graphite">{children}</div>
      </div>
    </li>
  );
}

export function StartHere({ jobCount }: { jobCount: number }) {
  const { address } = useWallet();
  const positions = usePositions(address ?? undefined);
  const token = usePaymentTokenLabel();
  const [funding, setFunding] = useState<"idle" | "asking" | "failed">("idle");

  const balance = positions.data?.token;
  const funded = balance !== undefined && balance >= ENOUGH_TO_START;

  // Once there is a wallet with something in it and a job on screen, the
  // person is past this and the panel goes away.
  if (address !== null && funded && jobCount > 0) return null;

  async function fund(): Promise<void> {
    if (address === null || friendbotUrl === undefined) return;
    setFunding("asking");
    try {
      const response = await fetch(`${friendbotUrl}?addr=${encodeURIComponent(address)}`);
      // Friendbot answers 400 for an account it has already funded, which is
      // not a failure worth shouting about; the balance below says the truth.
      setFunding(response.ok || response.status === 400 ? "idle" : "failed");
      await positions.refetch();
    } catch {
      setFunding("failed");
    }
  }

  return (
    <PanelCard
      title="Start here"
      description={`Three steps, all on ${NETWORK_LABEL}. Nothing here costs real money, and no account of yours is touched but the one you connect.`}
    >
      <ol className="flex flex-col gap-5">
        <Step n={1} title={address === null ? "Connect a Stellar wallet" : "Wallet connected"}>
          {address === null ? (
            <>
              <p>
                Freighter, xBull, Albedo, Lobstr or Hana. The wallet holds your key and signs each step; this page never sees it, and nothing is
                sent without you approving it in the wallet first.
              </p>
              <WalletButton />
            </>
          ) : (
            <p>Every action below is signed by this wallet, one signature each.</p>
          )}
        </Step>

        <Step n={2} title={funded ? `Funded with ${formatAmount(balance ?? 0n)} ${token}` : `Get some test ${token || "tokens"}`}>
          {address === null ? (
            <p>A test account starts empty. Once a wallet is connected, this step fills it.</p>
          ) : funded ? (
            <p>Enough to open and fund a job, and to pay the network&apos;s fee, which is a fraction of a cent.</p>
          ) : friendbotUrl === undefined ? (
            <p>This network has no faucet. Fund {NETWORK_LABEL} account {address} however that network is funded.</p>
          ) : (
            <>
              <p>
                Friendbot is the test network&apos;s faucet: it pays a new account 10,000 test XLM, which have no value anywhere. It is the
                reason nothing here can cost you anything.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryButton size="sm" onClick={() => void fund()} disabled={funding === "asking"}>
                  {funding === "asking" ? "Asking Friendbot…" : "Fund this account"}
                </PrimaryButton>
                {funding === "failed" ? <span className="text-magenta">Friendbot did not answer. Try again in a moment.</span> : null}
                {positions.isError ? <span className="text-magenta">The balance could not be read.</span> : null}
              </div>
            </>
          )}
        </Step>

        <Step n={3} title="Open a job for an agent">
          <p>
            You name the agent&apos;s address and what you want done, the agent sets its price, and you accept by funding exactly that amount.
            The money sits in the contract — not with us and not with the agent — until the work is delivered and the challenge window passes.
          </p>
          <div>
            <PrimaryButton size="sm" href="/new" disabled={address === null || !funded}>
              New job
            </PrimaryButton>
          </div>
        </Step>
      </ol>
    </PanelCard>
  );
}
