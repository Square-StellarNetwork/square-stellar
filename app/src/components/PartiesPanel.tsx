"use client";

import { AddressLink } from "@/components/AddressLink";
import { PanelCard } from "@/components/PanelCard";
import { addressKindLabel } from "@/lib/format";

/**
 * Who the job binds. Sanctions screening, which the hook reads at funding and
 * at release, is Phase 2 of #39's MVP scope, so this panel names the parties
 * and says nothing it cannot read.
 */
export function PartiesPanel({ client, provider, payee, submitted }: { client: string; provider: string | null; payee: string | null; submitted: boolean }) {
  const parties: { role: string; address: string }[] = [{ role: "Client", address: client }];
  if (provider !== null) parties.push({ role: "Provider", address: provider });
  if (submitted && payee !== null && payee !== provider) parties.push({ role: "Payee", address: payee });
  return (
    <PanelCard title="Parties" description="Who the job binds. An account signs; a contract authorizes itself as the caller.">
      <ul className="flex flex-col gap-2">
        {parties.map((party) => (
          <li key={party.role} className="flex flex-wrap items-center gap-3 text-body">
            <span className="w-20 text-caption text-graphite">{party.role}</span>
            <AddressLink address={party.address} />
            <span className="text-caption text-ash">{addressKindLabel(party.address)}</span>
          </li>
        ))}
      </ul>
    </PanelCard>
  );
}
