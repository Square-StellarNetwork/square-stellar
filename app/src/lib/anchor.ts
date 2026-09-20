"use client";

import {
  AnchorNeedsMoreError,
  authenticateWithAnchor,
  discoverAnchor,
  quotePrice,
  Sep6Client,
  sep38Asset,
  type Anchor,
  type AnchorSession,
  type Sep6DepositInstructions,
  type Sep6Transaction,
  type Sep6WithdrawInstructions,
  type SquareClient,
  type TransactionResult,
} from "@squaresdk/core/stellar";
import { nativeToScVal, scValToNative, type xdr } from "@stellar/stellar-sdk";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useSquare } from "./square";
import { anchorDomain, anchorFiat, network, NETWORK_ID } from "./stellar";
import { useWallet } from "./wallet";
import { thrownMessage, walletErrorMessage } from "./walletError";

const addressScVal = (address: string): xdr.ScVal => nativeToScVal(address, { type: "address" });

/**
 * The fiat rail, as the app drives it (#58).
 *
 * SEP-1 finds the anchor from its home domain, SEP-10 signs the wallet in
 * with the same `signTransaction` every kernel write uses, SEP-38 quotes the
 * rate and SEP-6 asks for the deposit and follows it to a final status. None
 * of it touches the kernel: what the anchor puts in the wallet is an ordinary
 * balance, and funding a job with it is the ordinary `fund`.
 *
 * Every step here is a real request to a real anchor. The one on testnet
 * simulates the bank leg — there is no lira in the world moving — and the
 * screens say so rather than leaving it to be assumed.
 */

/** What the anchor says about itself, read once per build's domain. */
export function useAnchor() {
  return useQuery({
    queryKey: ["anchor", NETWORK_ID, anchorDomain],
    staleTime: 5 * 60_000,
    queryFn: (): Promise<Anchor> => discoverAnchor(anchorDomain, { expectedNetwork: network.networkPassphrase }),
  });
}

/** The asset the anchor deposits, and the fiat it is anchored to. */
export function depositableAsset(anchor: Anchor | undefined): { code: string; issuer: string | undefined; fiat: string | undefined } | null {
  const currency = anchor?.currencies.find((entry) => entry.anchorAsset !== undefined) ?? anchor?.currencies[0];
  return currency === undefined ? null : { code: currency.code, issuer: currency.issuer, fiat: currency.anchorAsset };
}

/** `handed-over`: the anchor has the fiat and owes the payout; the balance says when it lands. */
export type DepositStage = "idle" | "signing" | "quoting" | "asking" | "waiting" | "done" | "handed-over" | "failed";

export interface DepositState {
  stage: DepositStage;
  /** What one unit of the asset costs in fiat, when the anchor quotes it. */
  price: string | null;
  instructions: Sep6DepositInstructions | null;
  transaction: Sep6Transaction | null;
  /** SEP-12 fields the anchor asked for before it would serve. */
  needs: string[] | null;
  error: string | null;
}

const IDLE: DepositState = { stage: "idle", price: null, instructions: null, transaction: null, needs: null, error: null };

/** How often the anchor is asked where the deposit has got to. */
const POLL_MS = 4_000;
/** Long enough for a sandbox's simulated bank leg; a real one is followed on the anchor's page. */
const POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * Sign in, quote, ask for the deposit, then follow it. The wallet signs the
 * SEP-10 challenge — the anchor learns which account it is serving from a
 * signature, not from a claim — and nothing else in the flow needs a key.
 */
export function useDeposit() {
  const { address, signer } = useWallet();
  const [state, setState] = useState<DepositState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  const start = useCallback(
    async (amount: string): Promise<void> => {
      if (address === null || signer === undefined) {
        setState({ ...IDLE, stage: "failed", error: "Connect a wallet first: the anchor signs you in with it." });
        return;
      }
      let session: AnchorSession;
      let asset: { code: string; issuer: string | undefined; fiat: string | undefined } | null;
      try {
        setState({ ...IDLE, stage: "signing" });
        const anchor = await discoverAnchor(anchorDomain, { expectedNetwork: network.networkPassphrase });
        asset = depositableAsset(anchor);
        if (asset === null) throw new Error(`${anchorDomain} lists no asset to deposit.`);
        session = await authenticateWithAnchor(anchor, signer);
      } catch (error) {
        setState({ ...IDLE, stage: "failed", error: describeAnchorError(error) });
        return;
      }

      // The quote is indicative and the anchor may not serve one; a rail that
      // works without a rate is better than one that stops for it.
      let price: string | null = null;
      try {
        setState((current) => ({ ...current, stage: "quoting" }));
        const fiat = asset.fiat ?? anchorFiat;
        const quote = await quotePrice(session, {
          sellAsset: sep38Asset.fiat(fiat),
          buyAsset: asset.issuer === undefined ? sep38Asset.fiat(asset.code) : sep38Asset.stellar(asset.code, asset.issuer),
          sellAmount: amount,
        });
        price = quote.price;
      } catch {
        price = null;
      }

      let instructions: Sep6DepositInstructions;
      const sep6 = new Sep6Client(session);
      try {
        setState((current) => ({ ...current, stage: "asking", price }));
        instructions = await sep6.deposit({ assetCode: asset.code, amount, type: "bank_account" });
      } catch (error) {
        if (error instanceof AnchorNeedsMoreError) {
          setState({ ...IDLE, stage: "failed", price, needs: error.fields, error: anchorNeedsMore(error) });
          return;
        }
        setState({ ...IDLE, stage: "failed", price, error: describeAnchorError(error) });
        return;
      }

      const id = instructions.id;
      setState({ stage: "waiting", price, instructions, transaction: null, needs: null, error: null });
      if (id === undefined) {
        // An anchor that gives instructions and no id has nothing to follow;
        // the wallet's balance is then the only thing that says it arrived.
        setState((current) => ({ ...current, stage: "done" }));
        return;
      }

      try {
        // The SDK polls and reports each change, so the screen moves while the
        // anchor works rather than sitting on one word for five minutes.
        const settled = await sep6.follow(id, {
          intervalMs: POLL_MS,
          timeoutMs: POLL_TIMEOUT_MS,
          onStatus: (transaction) => setState((current) => ({ ...current, transaction })),
        });
        setState((current) => ({ ...current, transaction: settled, stage: settled.status === "completed" ? "done" : "failed" }));
      } catch {
        // Observed on the sandbox: it takes the fiat, says "TRY received;
        // paying USDC on Stellar", and can sit in `pending_anchor` past any
        // wait worth making someone watch. The customer's side is finished at
        // that point, and the balance is what says when the payout lands — so
        // this is a handover, not a failure.
        setState((current) => ({ ...current, stage: "handed-over" }));
      }
    },
    [address, signer],
  );

  return { state, start, reset };
}

function anchorNeedsMore(error: AnchorNeedsMoreError): string {
  if (error.fields.length === 0) {
    return `The anchor wants to know more about you before it will take this deposit${error.customerStatus ? ` (${error.customerStatus})` : ""}. Its own page is where that is done.`;
  }
  return `The anchor asks for ${error.fields.join(", ")} before it will take this deposit. Its own page is where that is given.`;
}

/** An anchor's refusal in words, with the step it refused at. */
export function describeAnchorError(error: unknown): string {
  if (error instanceof AnchorNeedsMoreError) return anchorNeedsMore(error);
  if (error instanceof Error && error.name === "AnchorError") return error.message;
  // Signing in to the anchor is the wallet's work (SEP-10), so a wallet that
  // has stopped answering fails here — and blaming the anchor for it sends
  // someone looking in the wrong place.
  const wallet = walletErrorMessage(error);
  if (wallet !== null) return wallet;
  return thrownMessage(error) ?? "The anchor did not answer.";
}

// ---- the trustline the anchor's asset needs --------------------------------

/**
 * An issued asset reaches an account only if that account has opted in, and
 * the anchor pays USDC while this kernel is paid in XLM — so the opt-in is
 * not the deployment's `trustToken` but a `trust` on the asset's own Stellar
 * Asset Contract (CAP-0073), which is one signed invocation and no classic
 * transaction.
 */
export function useAnchorTrustline(assetContractId: string | undefined) {
  const { address } = useWallet();
  const client = useSquare();
  return useQuery({
    queryKey: ["anchor-trustline", NETWORK_ID, assetContractId ?? null, address],
    enabled: client !== null && address !== null && assetContractId !== undefined,
    refetchInterval: 10_000,
    queryFn: async (): Promise<{ open: boolean; balance: bigint }> => {
      if (client === null || address === null || assetContractId === undefined) throw new Error("not ready");
      try {
        const balance = await client.read<bigint>({
          contract: { id: assetContractId, name: "usdc" },
          method: "balance",
          args: [addressScVal(address)],
          parse: (value) => scValToNative(value) as bigint,
        });
        return { open: true, balance };
      } catch {
        // The SAC refuses a balance read for an account with no trustline;
        // that refusal is the answer, not an error to show.
        return { open: false, balance: 0n };
      }
    },
  });
}

/** Open the trustline: `trust` on the asset's SAC, signed by the connected wallet. */
export async function openAnchorTrustline(client: SquareClient, address: string, assetContractId: string): Promise<TransactionResult<void>> {
  return client.write<void>({
    contract: { id: assetContractId, name: "usdc" },
    method: "trust",
    args: [addressScVal(address)],
    parse: () => undefined,
  });
}

// ---- the way out: USDC back to fiat ---------------------------------------

export type WithdrawStage = "idle" | "signing" | "asking" | "sending" | "waiting" | "done" | "handed-over" | "failed";

export interface WithdrawState {
  stage: WithdrawStage;
  /** Where the anchor wants the asset sent, and with which memo. */
  instructions: Sep6WithdrawInstructions | null;
  transaction: Sep6Transaction | null;
  /** The payment that sent the asset to the anchor. */
  paymentHash: string | null;
  needs: string[] | null;
  error: string | null;
}

const WITHDRAW_IDLE: WithdrawState = { stage: "idle", instructions: null, transaction: null, paymentHash: null, needs: null, error: null };

/**
 * The mirror of a deposit: the anchor names an account and a memo, the asset
 * is sent there, and the fiat leaves at the other end. The send is an
 * ordinary SAC `transfer` signed by the wallet — the same one `fund` makes —
 * so nothing new is trusted with the money.
 */
export function useWithdraw(assetContractId: string | undefined) {
  const { address, signer } = useWallet();
  const client = useSquare();
  const [state, setState] = useState<WithdrawState>(WITHDRAW_IDLE);

  const reset = useCallback(() => setState(WITHDRAW_IDLE), []);

  const start = useCallback(
    async (amount: string, destination: string): Promise<void> => {
      if (address === null || signer === undefined || client === null || assetContractId === undefined) {
        setState({ ...WITHDRAW_IDLE, stage: "failed", error: "Connect a wallet first: the anchor signs you in with it." });
        return;
      }
      let session: AnchorSession;
      let code: string;
      try {
        setState({ ...WITHDRAW_IDLE, stage: "signing" });
        const anchor = await discoverAnchor(anchorDomain, { expectedNetwork: network.networkPassphrase });
        const asset = depositableAsset(anchor);
        if (asset === null) throw new Error(`${anchorDomain} lists no asset to withdraw.`);
        code = asset.code;
        session = await authenticateWithAnchor(anchor, signer);
      } catch (error) {
        setState({ ...WITHDRAW_IDLE, stage: "failed", error: describeAnchorError(error) });
        return;
      }

      const sep6 = new Sep6Client(session);
      let instructions: Sep6WithdrawInstructions;
      try {
        setState((current) => ({ ...current, stage: "asking" }));
        instructions = await sep6.withdraw({ assetCode: code, amount, type: "bank_account", dest: destination });
      } catch (error) {
        if (error instanceof AnchorNeedsMoreError) {
          setState({ ...WITHDRAW_IDLE, stage: "failed", needs: error.fields, error: describeAnchorError(error) });
          return;
        }
        setState({ ...WITHDRAW_IDLE, stage: "failed", error: describeAnchorError(error) });
        return;
      }

      const to = instructions.accountId;
      if (to === undefined) {
        setState({ ...WITHDRAW_IDLE, stage: "failed", instructions, error: "The anchor named no account to send the asset to." });
        return;
      }

      // The asset goes to the anchor as an ordinary transfer on its own SAC.
      let paymentHash: string;
      try {
        setState((current) => ({ ...current, stage: "sending", instructions }));
        const sent = await client.write<void>({
          contract: { id: assetContractId, name: "usdc" },
          method: "transfer",
          args: [addressScVal(address), addressScVal(to), nativeToScVal(toBaseUnits(amount), { type: "i128" })],
          parse: () => undefined,
        });
        paymentHash = sent.hash;
      } catch (error) {
        setState((current) => ({ ...current, stage: "failed", error: describeAnchorError(error) }));
        return;
      }

      setState((current) => ({ ...current, stage: "waiting", paymentHash }));
      const id = instructions.id;
      if (id === undefined) {
        setState((current) => ({ ...current, stage: "handed-over" }));
        return;
      }
      try {
        const settled = await sep6.follow(id, {
          intervalMs: POLL_MS,
          timeoutMs: POLL_TIMEOUT_MS,
          onStatus: (transaction) => setState((current) => ({ ...current, transaction })),
        });
        setState((current) => ({ ...current, transaction: settled, stage: settled.status === "completed" ? "done" : "failed" }));
      } catch {
        setState((current) => ({ ...current, stage: "handed-over" }));
      }
    },
    [address, signer, client, assetContractId],
  );

  return { state, start, reset };
}

/** Seven decimals, as a Stellar Asset Contract counts. */
function toBaseUnits(amount: string): bigint {
  const [whole, fraction = ""] = amount.trim().split(".");
  return BigInt(`${whole || "0"}${fraction.padEnd(7, "0").slice(0, 7)}`);
}
