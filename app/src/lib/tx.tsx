"use client";

import {
  ArchivedStateError,
  NeedsMoreSignaturesError,
  SimulationFailedError,
  SquareContractError,
  TransactionFailedError,
  TransactionPendingError,
  TransactionSendError,
  TrustlineMissingError,
  WalletRequiredError,
  type TransactionResult,
} from "@squaresdk/core/stellar";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { errorCopy } from "./errorCopy";
import { shortHash } from "./format";
import { explorerLink } from "./stellar";
import { thrownMessage, walletErrorMessage } from "./walletError";

export type TxState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string; hash: string; link: string | null }
  | { status: "error"; label: string; message: string };

interface TxContextValue {
  state: TxState;
  busy: boolean;
  run: <T>(label: string, fn: () => Promise<TransactionResult<T>>) => Promise<TransactionResult<T> | undefined>;
  notify: (state: TxState) => void;
  dismiss: () => void;
}

const TxContext = createContext<TxContextValue | null>(null);

/**
 * What went wrong, in the words the chain used. A refusal names the
 * contract's own error, because the client decodes it from the simulation's
 * diagnostics before anything is sent.
 */
export function describeError(error: unknown): string {
  if (error instanceof SquareContractError) {
    // The contract answers with a name. Say what it means and what to do,
    // and keep the name at the end so it can still be looked up.
    const copy = errorCopy(error.errorName);
    if (copy === null) return error.message;
    return `${copy.what}${copy.next === undefined ? "" : ` ${copy.next}`}${error.errorName === undefined ? "" : ` (${error.errorName})`}`;
  }
  if (error instanceof SimulationFailedError) return `${error.contract}.${error.method} was refused: ${error.reason}`;
  if (error instanceof ArchivedStateError) {
    return `${error.contract}.${error.method} touches an archived ledger entry; it has to be restored before this call works.`;
  }
  if (error instanceof NeedsMoreSignaturesError) {
    return `This call also needs ${error.addresses.join(", ")} to sign, which this wallet cannot do here.`;
  }
  if (error instanceof TrustlineMissingError) {
    // A trustline is the account's own opt-in to hold an asset; nothing can be
    // sent to an account that has not made it.
    return `That account has not opted in to hold ${error.asset}, so it cannot be paid in it. Open a trustline for ${error.asset} on ${shortHash(error.account)} first.`;
  }
  if (error instanceof TransactionSendError) return `The network would not accept the transaction (${error.status}). Nothing was charged; try again.`;
  if (error instanceof TransactionFailedError) {
    return `The transaction reached the chain in ledger ${error.ledger} but changed nothing, so only its fee was spent. Reload and try again (${shortHash(error.hash)}).`;
  }
  if (error instanceof TransactionPendingError) {
    return `The network has not answered after ${error.waitedSeconds}s. It may still land, so check before sending it again (${shortHash(error.hash)}).`;
  }
  if (error instanceof WalletRequiredError) return "Connect a wallet first: this sends a transaction.";
  // The wallet is an extension, and it rejects with its own object rather
  // than an Error; this reads both, and names the two failures that are the
  // extension's doing rather than the chain's.
  const wallet = walletErrorMessage(error);
  if (wallet !== null) return wallet;
  return thrownMessage(error) ?? "Unknown error";
}

/** On Stellar the network is chosen inside the wallet, so this only says so. */
export function switchNetworkGuidance(networkLabel: string, walletNetwork: string): string {
  return `This wallet is on ${walletNetwork}. Switch it to ${networkLabel} in the wallet itself, then reconnect here.`;
}

export function TxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TxState>({ status: "idle" });
  const queryClient = useQueryClient();

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<TransactionResult<T>>): Promise<TransactionResult<T> | undefined> => {
      setState({ status: "pending", label });
      try {
        const result = await fn();
        setState({ status: "success", label, hash: result.hash, link: explorerLink("tx", result.hash) });
        await queryClient.invalidateQueries();
        return result;
      } catch (error) {
        setState({ status: "error", label, message: describeError(error) });
        return undefined;
      }
    },
    [queryClient],
  );

  const notify = useCallback((next: TxState) => setState(next), []);
  const dismiss = useCallback(() => setState({ status: "idle" }), []);

  const value = useMemo<TxContextValue>(() => ({ state, busy: state.status === "pending", run, notify, dismiss }), [state, run, notify, dismiss]);

  return <TxContext.Provider value={value}>{children}</TxContext.Provider>;
}

export function useTx(): TxContextValue {
  const context = useContext(TxContext);
  if (!context) throw new Error("useTx must be used inside TxProvider");
  return context;
}
