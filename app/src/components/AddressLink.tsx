import { isContractAddress, isStellarAddress } from "@squaresdk/core/stellar";

import { shortAddress, shortHash } from "@/lib/format";
import { explorerLink } from "@/lib/stellar";

const linkClass = "break-all tabular-nums text-carbon underline decoration-fog underline-offset-4 transition-colors hover:decoration-carbon";

/** A `G…` account or a `C…` contract, linked to the explorer's own page for it. */
export function AddressLink({ address, full = false, label }: { address: string | null; full?: boolean; label?: string }) {
  if (address === null || !isStellarAddress(address)) return <span className="text-ash">Not set</span>;
  const text = label ?? (full ? address : shortAddress(address));
  const href = explorerLink(isContractAddress(address) ? "contract" : "account", address);
  if (href === null) {
    return (
      <span className="break-all tabular-nums text-carbon" title={address}>
        {text}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass} title={address}>
      {text}
    </a>
  );
}

export function TxLink({ hash, full = false }: { hash: string; full?: boolean }) {
  const text = full ? hash : shortHash(hash);
  const href = explorerLink("tx", hash);
  if (href === null) {
    return (
      <span className="break-all tabular-nums text-carbon" title={hash}>
        {text}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass} title={hash}>
      {text}
    </a>
  );
}
