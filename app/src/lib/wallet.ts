"use client";

import type { Signer } from "@squaresdk/core/stellar";
import { useCallback, useEffect, useMemo, useState } from "react";

import { NETWORK_LABEL, NETWORK_PASSPHRASE } from "./stellar";
import { thrownMessage, walletErrorMessage } from "./walletError";

/**
 * The wallet connection (#39): Stellar Wallets Kit, which covers Freighter,
 * xBull, Albedo, Lobstr, Hana and the hardware wallets behind one modal and
 * the two SEP-43 signing calls. It replaces wagmi's injected connector and
 * EIP-6963 discovery.
 *
 * The kit talks to browser extensions, so it is imported only in the browser
 * and only once. The chosen wallet's id is remembered, as the EVM app
 * remembered its connector, and a reconnect goes straight to it.
 */

const STORAGE_KEY = "square.wallet-id";

type KitModule = typeof import("@creit.tech/stellar-wallets-kit");
type Kit = KitModule["StellarWalletsKit"];

let started: Promise<Kit> | null = null;

function remembered(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // A browser that refuses storage still connects; it just forgets.
  }
}

async function kit(): Promise<Kit> {
  if (started === null) {
    started = (async () => {
      const [{ StellarWalletsKit }, { Networks }, freighter, xbull, albedo, lobstr, hana] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit"),
        import("@creit.tech/stellar-wallets-kit/types"),
        import("@creit.tech/stellar-wallets-kit/modules/freighter"),
        import("@creit.tech/stellar-wallets-kit/modules/xbull"),
        import("@creit.tech/stellar-wallets-kit/modules/albedo"),
        import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
        import("@creit.tech/stellar-wallets-kit/modules/hana"),
      ]);
      const network = NETWORK_PASSPHRASE === Networks.TESTNET ? Networks.TESTNET : Networks.STANDALONE;
      const selected = remembered();
      StellarWalletsKit.init({
        modules: [new freighter.FreighterModule(), new xbull.xBullModule(), new albedo.AlbedoModule(), new lobstr.LobstrModule(), new hana.HanaModule()],
        network,
        ...(selected === null ? {} : { selectedWalletId: selected }),
      });
      return StellarWalletsKit;
    })();
  }
  return started;
}

export interface WalletState {
  /** The connected account, `G…`, or null. */
  address: string | null;
  /** The wallet the account is in, as the kit names it. */
  walletId: string | null;
  connecting: boolean;
  /** The last thing the wallet refused, for the button to show. */
  error: string | null;
  /**
   * The network the wallet is on when it says, and it is not this app's. The
   * app only reports it: on Stellar, switching networks is done in the wallet.
   */
  mismatch: { walletNetwork: string; appNetwork: string } | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** The signer `@squaresdk/core`'s client writes with, or undefined while disconnected. */
  signer: Signer | undefined;
}

export function useWallet(): WalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<WalletState["mismatch"]>(null);

  const readNetwork = useCallback(async (): Promise<void> => {
    try {
      const { networkPassphrase } = await (await kit()).getNetwork();
      setMismatch(networkPassphrase === NETWORK_PASSPHRASE ? null : { walletNetwork: networkPassphrase, appNetwork: NETWORK_LABEL });
    } catch {
      // A wallet that does not answer which network it is on is left alone.
      setMismatch(null);
    }
  }, []);

  // A remembered wallet reconnects without a modal, and is forgotten when it
  // no longer answers (uninstalled, locked, permission withdrawn).
  useEffect(() => {
    let cancelled = false;
    const id = remembered();
    if (id === null) return;
    void (async () => {
      try {
        const connected = await kit();
        connected.setWallet(id);
        const { address: account } = await connected.getAddress();
        if (cancelled) return;
        setAddress(account);
        setWalletId(id);
        await readNetwork();
      } catch {
        if (!cancelled) remember(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readNetwork]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const connected = await kit();
      const { address: account } = await connected.authModal();
      const id = connected.selectedModule.productId;
      remember(id);
      setWalletId(id);
      setAddress(account);
      await readNetwork();
    } catch (cause) {
      // An extension that is installed but unreachable rejects here too, and
      // it does it with an object; `String(cause)` made that "[object Object]".
      setError(walletErrorMessage(cause) ?? thrownMessage(cause) ?? "The wallet did not answer.");
    } finally {
      setConnecting(false);
    }
  }, [readNetwork]);

  const disconnect = useCallback(async () => {
    try {
      await (await kit()).disconnect();
    } finally {
      remember(null);
      setAddress(null);
      setWalletId(null);
      setMismatch(null);
    }
  }, []);

  const signer = useMemo<Signer | undefined>(() => {
    if (address === null) return undefined;
    return {
      address,
      networkPassphrase: NETWORK_PASSPHRASE,
      signTransaction: async (xdr, opts) => (await kit()).signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE, address, ...opts }),
      signAuthEntry: async (entry, opts) => (await kit()).signAuthEntry(entry, { networkPassphrase: NETWORK_PASSPHRASE, address, ...opts }),
    };
  }, [address]);

  return { address, walletId, connecting, error, mismatch, connect, disconnect, signer };
}
