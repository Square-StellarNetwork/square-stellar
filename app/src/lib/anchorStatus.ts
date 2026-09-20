/**
 * SEP-6's statuses in words (#58).
 *
 * The same status means opposite things on the two legs. `completed` on a
 * deposit is the asset arriving in the wallet; on a withdrawal it is the asset
 * leaving it and the fiat being paid out. `pending_user_transfer_start` waits
 * for a bank transfer one way and for the customer's payment on Stellar the
 * other. One table for both told someone who had just withdrawn that the asset
 * was in their wallet, which is the reverse of what had happened.
 */
export type Sep6Direction = "deposit" | "withdraw";

const SHARED: Record<string, string> = {
  incomplete: "The anchor is waiting for something before it can start.",
  pending_anchor: "The anchor is processing it.",
  pending_stellar: "The anchor is settling it on Stellar.",
  expired: "The anchor gave up waiting.",
  error: "The anchor stopped with an error.",
};

function depositCopy(status: string, fiat: string): string | undefined {
  switch (status) {
    case "pending_user_transfer_start":
      return `Waiting for the bank transfer. On this sandbox you make it happen from the anchor's own page — the link below.`;
    case "pending_user_transfer_complete":
      return `The ${fiat} is in; the anchor is working on it.`;
    case "pending_external":
      return "The anchor is waiting on the banking side.";
    case "pending_trust":
      return "Your account has no trustline for the asset, so the anchor cannot pay it.";
    case "completed":
      return "Done. The asset is in your wallet.";
    case "refunded":
      return `The anchor sent the ${fiat} back.`;
    default:
      return undefined;
  }
}

function withdrawCopy(status: string, fiat: string): string | undefined {
  switch (status) {
    case "pending_user_transfer_start":
      return "Waiting for your payment to reach the anchor, with the memo it asked for.";
    case "pending_user_transfer_complete":
      return "Your payment is in; the anchor is working on it.";
    case "pending_external":
      return `The anchor is paying the ${fiat} out through the bank.`;
    case "pending_trust":
      return "The anchor's account cannot hold what was sent.";
    case "completed":
      return `Done. The asset left your wallet and the ${fiat} was paid out.`;
    case "refunded":
      return "The anchor sent the asset back.";
    default:
      return undefined;
  }
}

/** What the anchor's status means on this leg, in a sentence. */
export function sep6StatusCopy(status: string, direction: Sep6Direction, fiat: string): string {
  const own = direction === "deposit" ? depositCopy(status, fiat) : withdrawCopy(status, fiat);
  return own ?? SHARED[status] ?? "The anchor is working on it.";
}
