"use client";

import type { ScreeningState } from "@squaresdk/core";
import type { Address } from "viem";
import { AddressLink } from "@/components/AddressLink";
import { Chip, type DotTone } from "@/components/Chip";
import { PanelCard } from "@/components/PanelCard";
import { isZeroAddress } from "@/lib/format";
import { useScreening } from "@/lib/screening";
import { describeError } from "@/lib/tx";

const STATES: Record<ScreeningState, { label: string; dot: DotTone }> = {
  cleared: { label: "Cleared", dot: "mint" },
  sanctioned: { label: "Sanctioned", dot: "magenta" },
  unscreened: { label: "Not screened", dot: "amber" },
  "no-screening": { label: "Not screened", dot: "ash" },
};

/**
 * The parties of a job and what the hook's screening registry says about
 * each (square#35). Funding needs the client and the provider cleared; the
 * release pays the payee only if it is. Without a registry on the hook the
 * panel says so instead of showing an empty table.
 */
export function PartiesPanel({ client, provider, payee, submitted }: { client: Address; provider: Address; payee: Address; submitted: boolean }) {
  const parties: { role: string; address: Address }[] = [{ role: "Client", address: client }];
  if (!isZeroAddress(provider)) parties.push({ role: "Provider", address: provider });
  if (submitted && !isZeroAddress(payee) && payee.toLowerCase() !== provider.toLowerCase()) parties.push({ role: "Payee", address: payee });
  const screening = useScreening(parties);
  return (
    <PanelCard title="Parties and screening" description="Who the job binds, and whether the sanctions screening the hook reads has cleared them.">
      {screening.isPending ? <p className="text-caption text-graphite">Reading the hook's screening registry…</p> : null}
      {screening.isError ? <p className="text-caption text-magenta">{describeError(screening.error)}</p> : null}
      {screening.data ? (
        screening.data.registry === null ? (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {parties.map((party) => (
                <li key={party.role} className="flex flex-wrap items-center gap-3 text-body">
                  <span className="w-20 text-caption text-graphite">{party.role}</span>
                  <AddressLink address={party.address} />
                </li>
              ))}
            </ul>
            <p className="text-caption text-graphite">The hook holds no screening registry, so funding and release are not gated by sanctions screening on this deployment.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {screening.data.parties.map((party) => {
                const state = STATES[party.verdict.state];
                return (
                  <li key={party.role} className="flex flex-wrap items-center gap-3 text-body">
                    <span className="w-20 text-caption text-graphite">{party.role}</span>
                    <AddressLink address={party.address} />
                    <Chip dot={state.dot}>{state.label}</Chip>
                  </li>
                );
              })}
            </ul>
            <p className="text-caption text-graphite">
              Registry <AddressLink address={screening.data.registry} />. A party without a fresh, clean record cannot be funded; a payee without one is paid nothing at release. The fund step asks the screener for whoever lacks a record when the app names one.
            </p>
          </div>
        )
      ) : null}
    </PanelCard>
  );
}
