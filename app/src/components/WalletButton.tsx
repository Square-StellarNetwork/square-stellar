"use client";

import { shortAddress } from "@/lib/format";
import { NETWORK_LABEL } from "@/lib/stellar";
import { switchNetworkGuidance } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import { StellarMark } from "./marks";

const pill =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-iris px-4 text-caption font-medium text-carbon transition-colors hover:bg-iris/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender disabled:cursor-not-allowed disabled:bg-mist disabled:text-ash";

const quietPill =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-fog bg-paper-white px-4 text-caption font-medium text-carbon transition-colors hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender";

const addressBadge = "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-mist px-4 text-caption font-medium text-carbon";

/**
 * The wallet connection (#39). Stellar Wallets Kit brings its own chooser, so
 * this is a button over it: connect opens the kit's modal, and the connected
 * state shows the account with a way out. A wallet on another network is
 * reported, not switched: on Stellar that is done in the wallet.
 */
export function WalletButton() {
  const { address, connect, connecting, disconnect, error, mismatch } = useWallet();

  if (address === null) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" className={pill} onClick={() => void connect()} disabled={connecting}>
          <StellarMark className="size-4" />
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {error === null ? null : <p className="max-w-xs text-right text-caption text-magenta">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className={addressBadge} title={address}>
          <StellarMark className="size-4" />
          {shortAddress(address)}
        </span>
        <button type="button" className={quietPill} onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
      {mismatch === null ? null : (
        <p className="max-w-xs text-right text-caption text-magenta">{switchNetworkGuidance(NETWORK_LABEL, mismatch.walletNetwork)}</p>
      )}
      {error === null ? null : <p className="max-w-xs text-right text-caption text-magenta">{error}</p>}
    </div>
  );
}
