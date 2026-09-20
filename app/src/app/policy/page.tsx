import type { Metadata } from "next";

import { Phase2Notice } from "@/components/Phase2Notice";

export const metadata: Metadata = { title: "Policy" };

export default function PolicyPage() {
  return (
    <Phase2Notice
      title="Policy"
      summary="The compliance gate: an institution commits a policy, proves a payment against it and reads back what the module decided."
      items={[
        "The policy commitment and the daily ceiling, written to policy_registry",
        "A proof from the prover, bound to the release and checked by compliance_module",
        "The buyer list a receivable may be sold into",
      ]}
      issue={40}
    />
  );
}
