"use client";

import type { ScreeningVerdict } from "@squaresdk/core";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { POLL_MS, useSquare } from "./square";
import { activeChain } from "./wagmi";

export interface PartyScreening {
  role: string;
  address: Address;
  verdict: ScreeningVerdict;
}

export interface ScreeningReport {
  /** The registry the hook reads, or null when the hook screens nobody. */
  registry: Address | null;
  parties: PartyScreening[];
}

/**
 * What the screening registry the hook reads says about each party of a
 * job (square#35): the client and the provider are checked at funding, the
 * payee at release. Read through the SDK's `screeningOf`, which is what
 * `fund` itself consults before it sends.
 */
export function useScreening(parties: { role: string; address: Address }[]) {
  const square = useSquare();
  const key = parties.map((party) => `${party.role}:${party.address.toLowerCase()}`).join(",");
  return useQuery({
    queryKey: ["screening", activeChain.id, key],
    enabled: parties.length > 0,
    refetchInterval: POLL_MS * 3,
    queryFn: async (): Promise<ScreeningReport> => {
      const registry = await square.screening();
      if (registry === null) return { registry: null, parties: [] };
      const verdicts = await Promise.all(parties.map((party) => square.screeningOf(party.address, registry)));
      return { registry, parties: parties.map((party, index) => ({ ...party, verdict: verdicts[index]! })) };
    },
  });
}
