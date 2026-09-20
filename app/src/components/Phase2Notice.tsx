import { PanelCard } from "./PanelCard";
import { SectionHeading } from "./SectionHeading";

/**
 * A surface the testnet MVP does not carry yet (#39's MVP scope): the page
 * stays and says what it will hold and which issue brings it, rather than
 * showing figures it cannot read.
 */
export function Phase2Notice({ title, summary, items, issue }: { title: string; summary: string; items: readonly string[]; issue: number }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <SectionHeading title={title} description="Phase 2" />
      <div className="mt-6">
        <PanelCard title="Not in the testnet MVP" description={summary}>
          <ul className="space-y-2 text-body text-graphite">
            {items.map((item) => (
              <li key={item}>— {item}</li>
            ))}
          </ul>
          <p className="mt-6 text-body text-graphite">
            The MVP is one flow: connect a wallet, open a job, fund it, deliver, finalize or dispute, withdraw. This page returns with{" "}
            <a className="underline" href={`https://github.com/Square-StellarNetwork/square-stellar/issues/${issue}`} rel="noreferrer" target="_blank">
              issue #{issue}
            </a>
            .
          </p>
        </PanelCard>
      </div>
    </main>
  );
}
