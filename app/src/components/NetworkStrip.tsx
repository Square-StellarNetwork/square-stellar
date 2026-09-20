"use client";

import { formatBigint, formatDuration } from "@/lib/format";
import { useNetwork } from "@/lib/square";
import { deployment, isTestnet, NETWORK_LABEL } from "@/lib/stellar";
import { AddressLink } from "./AddressLink";
import { StellarMark } from "./marks";

/**
 * What this build's record names. Only the kernel is certain on the MVP
 * stack; the rest join as their contracts are deployed, so a missing one is
 * left out rather than drawn empty.
 */
const contracts: { label: string; address: string }[] =
  deployment === null
    ? []
    : (
        [
          ["square_job", deployment.squareJob],
          ["keeper_evaluator", deployment.keeperEvaluator],
          ["square_hook", deployment.squareHook],
          ["arbitration", deployment.arbitration],
          ["claim_market", deployment.claimMarket],
          ["policy_registry", deployment.policyRegistry],
          [`${deployment.token.code} (token)`, deployment.token.contractId],
        ] as const
      ).flatMap(([label, address]) => (address === undefined ? [] : [{ label, address }]));

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="text-caption text-graphite">{label}</span>
      <span className="text-body font-medium tabular-nums text-carbon">{children}</span>
    </div>
  );
}

function Skeleton() {
  return <span aria-label="Loading" className="inline-block h-4 w-16 rounded-full bg-mist align-middle" />;
}

export function NetworkStrip() {
  const network = useNetwork();
  const data = network.data;
  const window = data === undefined ? null : Number(data.config.challengeWindow);

  return (
    <div className="overflow-hidden rounded-2xl border border-fog bg-paper-white">
      <div className="grid divide-y divide-fog sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Cell label="Network">
          <span className="inline-flex items-center gap-2">
            {isTestnet ? <StellarMark className="size-4" /> : null}
            {NETWORK_LABEL}
            {data ? <span className="text-graphite">(protocol {data.protocolVersion})</span> : null}
          </span>
        </Cell>
        <Cell label="Ledger">{data ? formatBigint(BigInt(data.ledger)) : network.isError ? "Unavailable" : <Skeleton />}</Cell>
        <Cell label="Challenge window">
          {window !== null ? (
            <>
              {formatDuration(window)} <span className="text-graphite">({window} s on square_job)</span>
            </>
          ) : network.isError ? (
            "Unavailable"
          ) : (
            <Skeleton />
          )}
        </Cell>
      </div>
      {contracts.length > 0 ? (
        <div className="grid gap-x-6 gap-y-2 border-t border-fog px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {contracts.map((contract) => (
            <p key={contract.label} className="flex items-center justify-between gap-3 text-caption">
              <span className="text-graphite">{contract.label}</span>
              <AddressLink address={contract.address} />
            </p>
          ))}
        </div>
      ) : (
        <p className="border-t border-fog px-5 py-4 text-caption text-graphite">
          This build names no deployment for {NETWORK_LABEL}: set NEXT_PUBLIC_DEPLOYMENT to the record the deploy script writes.
        </p>
      )}
    </div>
  );
}
