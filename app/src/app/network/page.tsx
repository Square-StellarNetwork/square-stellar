import type { Metadata } from "next";

import { Phase2Notice } from "@/components/Phase2Notice";

export const metadata: Metadata = { title: "Network" };

export default function NetworkPage() {
  return (
    <Phase2Notice
      title="Network"
      summary="What the deployed stack is set to: the keeper's windows, the fees, the arbiter set and bond, and which registries and modules are installed."
      items={[
        "Keeper windows and the settlement horizon, read from keeper_evaluator",
        "Fees and the treasury, read from square_job",
        "The arbiter set, threshold and bond parameters, read from arbitration",
        "The compliance module and screening registry the hook holds",
      ]}
      issue={42}
    />
  );
}
