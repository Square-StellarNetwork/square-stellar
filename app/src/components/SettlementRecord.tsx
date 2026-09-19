"use client";

import { JobStatus } from "@squaresdk/core";
import { AddressLink, TxLink } from "@/components/AddressLink";
import { AmountUsdc } from "@/components/AmountUsdc";
import { Chip, type DotTone } from "@/components/Chip";
import { PanelCard } from "@/components/PanelCard";
import { formatBps, shortHash } from "@/lib/format";
import { indexerUrl, useJobEvents } from "@/lib/indexer";
import { settlementRecord, type Verdict } from "@/lib/settlement";
import { describeError } from "@/lib/tx";

const VERDICTS: { [K in Verdict]: { label: string; dot: DotTone; text: string } } = {
  verified: { label: "Verified", dot: "mint", text: "The compliance module verified the proof bound to this job against the client's commitment, the payee, the net, the day's counter and the clock, and the counter was advanced." },
  refused: { label: "Refused", dot: "magenta", text: "The module refused the release: the provider was paid nothing and the net went back to the client. The reason is the module's own." },
  unconfirmed: { label: "Paid, unconfirmed", dot: "amber", text: "The preview accepted the proof and the payment went out, but the module could not book it: the counter and the replay mark did not land. The hook reported it by name (#225)." },
  "not-gated": { label: "Not gated", dot: "sky", text: "The hook held no compliance module when this job settled, so finalize paid the split without a proof check." },
  unknown: { label: "No verdict recorded", dot: "ash", text: "The journal holds no compliance event for this job." },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-ash">{label}</dt>
      <dd className="text-body text-carbon">{children}</dd>
    </div>
  );
}

/**
 * What the hook and the compliance module said when the job settled, read
 * from the indexer's journal. The kernel's record keeps where the money went;
 * the reason lives only in the events, so this panel needs an indexer and
 * says so when the app has none.
 */
export function SettlementRecord({ jobId, status }: { jobId: bigint; status: number }) {
  const terminal = status === JobStatus.Completed || status === JobStatus.Rejected || status === JobStatus.Expired;
  const events = useJobEvents(jobId, terminal);
  if (!terminal) return null;
  if (indexerUrl === null) {
    return (
      <PanelCard title="Settlement record" description="Why the release went the way it did: the compliance verdict, the screening of the payee and what was written to the registries.">
        <p className="text-caption text-graphite">
          The verdict lives in the events the contracts emitted at settlement, which the chain does not serve by job. Point the app at an indexer (NEXT_PUBLIC_INDEXER_URL) to read them here; until then the explorer has the transaction.
        </p>
      </PanelCard>
    );
  }
  if (events.isPending) {
    return (
      <PanelCard title="Settlement record" description="Reading the journal from the indexer.">
        <p className="text-caption text-graphite">Reading…</p>
      </PanelCard>
    );
  }
  if (events.isError) {
    return (
      <PanelCard title="Settlement record" description="The indexer could not be read.">
        <p className="text-caption text-magenta">{describeError(events.error)}</p>
      </PanelCard>
    );
  }
  const record = settlementRecord(events.data);
  const verdict = VERDICTS[record.verdict];
  return (
    <PanelCard title="Settlement record" description={`From ${record.events} journaled events across ${record.transactions.length} transaction${record.transactions.length === 1 ? "" : "s"}, read from the indexer.`}>
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Compliance verdict">
          <span className="flex flex-col gap-2">
            <span>
              <Chip dot={verdict.dot}>{verdict.label}</Chip>
              {record.refusalReason ? <Chip className="ml-2">{record.refusalReason}</Chip> : null}
            </span>
            <span className="text-caption text-graphite">{verdict.text}</span>
          </span>
        </Row>
        <Row label="Payee screening">
          {record.screening === "cleared" ? <Chip dot="mint">Cleared</Chip> : record.screening === "not-cleared" ? <Chip dot="magenta">Not cleared, paid nothing</Chip> : <Chip dot="ash">No registry installed</Chip>}
        </Row>
        <Row label="Policy pinned at funding">
          {record.policyCommitment ? (
            <span className="font-mono text-[13px]" title={record.policyCommitment}>
              {shortHash(record.policyCommitment)}
            </span>
          ) : (
            <span className="text-ash">None</span>
          )}
        </Row>
        <Row label="Payout routed">
          {record.payout ? (
            <span className="flex flex-wrap items-center gap-2">
              <AddressLink address={record.payout.payee} />
              <span className="text-caption text-graphite">{formatBps(record.payout.providerBps)} of net</span>
              <AmountUsdc value={BigInt(record.payout.providerShare)} />
              {BigInt(record.payout.clientShare) > 0n ? (
                <span className="text-caption text-graphite">
                  and <AmountUsdc value={BigInt(record.payout.clientShare)} /> back to the client
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-ash">No payout: the budget was refunded</span>
          )}
        </Row>
        <Row label="Reputation">
          {record.reputation.state === "recorded" ? (
            <Chip dot="mint">
              {record.reputation.outcome} written for agent #{record.reputation.agentId}
            </Chip>
          ) : record.reputation.state === "skipped" ? (
            <Chip dot="amber">
              Skipped for agent #{record.reputation.agentId}: {record.reputation.reason}
            </Chip>
          ) : record.reputation.state === "failed" ? (
            <Chip dot="magenta">Registry write failed for agent #{record.reputation.agentId}</Chip>
          ) : (
            <span className="text-ash">No agent was bound</span>
          )}
        </Row>
        <Row label="Validation">
          {record.validation === "recorded" ? <Chip dot="mint">Response recorded</Chip> : record.validation === "failed" ? <Chip dot="magenta">Registry write failed</Chip> : <span className="text-ash">No validation request was bound</span>}
        </Row>
        {record.hookFailures > 0 ? (
          <Row label="Hook">
            <Chip dot="magenta">
              {record.hookFailures} tolerated failure{record.hookFailures === 1 ? "" : "s"}
            </Chip>
          </Row>
        ) : null}
        <Row label="Transactions">
          <span className="flex flex-col gap-1">
            {record.transactions.map((hash) => (
              <TxLink key={hash} hash={hash} />
            ))}
          </span>
        </Row>
      </dl>
    </PanelCard>
  );
}
