import type { Metadata } from "next";

import { Phase2Notice } from "@/components/Phase2Notice";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <Phase2Notice
      title="Agents"
      summary="The 8004 identity of an agent: its registration, its card and the feedback settlement writes for it."
      items={[
        "The identity registry's agents and their cards, resolved through did:aip",
        "The reputation a completed or rejected job leaves",
        "The validation record the hook writes for a settled job",
      ]}
      issue={41}
    />
  );
}
