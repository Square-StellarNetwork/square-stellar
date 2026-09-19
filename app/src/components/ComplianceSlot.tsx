"use client";

import { AddressLink } from "@/components/AddressLink";
import { isZeroAddress } from "@/lib/format";
import { useNetwork } from "@/lib/square";

export function ComplianceSlot() {
  const network = useNetwork();
  const data = network.data;
  if (!data) return null;
  if (isZeroAddress(data.complianceModule)) {
    return (
      <p className="max-w-2xl text-caption text-graphite">
        Read from the deployed hook right now: the compliance slot is open, so no release on this deployment is proof
        gated. The circuit and the prover are live, and a proof built from them verifies against Stellar&apos;s BN254 host
        functions. The Groth16 verifier deployed there is keyed to a development proving key and is temporary: the
        ceremony (#51) fixes the key that gets a permanent address.
      </p>
    );
  }
  return (
    <p className="max-w-2xl text-caption text-graphite">
      Read from the deployed hook right now: a compliance module is installed at{" "}
      <AddressLink address={data.complianceModule} />, so every release is proof gated.
    </p>
  );
}
