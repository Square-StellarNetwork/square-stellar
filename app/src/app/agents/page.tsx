import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentsView } from "@/components/views/AgentsView";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentsView />
    </Suspense>
  );
}
