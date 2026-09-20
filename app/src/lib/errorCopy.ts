/**
 * The kernel's errors in words someone new to this can act on (#63).
 *
 * `square_job` answers with a name — `WrongStatus`, `BudgetMismatch` — and the
 * generated bindings carry that name as the message, because a contract has no
 * room for prose. Showing it as-is is accurate and useless: it says what the
 * contract calls the refusal, not what happened or what to do about it.
 *
 * Each entry below is the same refusal written twice: what the chain refused,
 * and the next thing to try. The names come from
 * `contracts/common/src/job.rs`'s `SquareJobError` and the owner primitive's
 * codes, so this table is complete for the deployed kernel; anything it does
 * not know falls back to the name, which is still better than nothing.
 */
export interface ErrorCopy {
  /** What happened, in one sentence, with no contract vocabulary. */
  what: string;
  /** What to do next. Absent when there is nothing the person can do. */
  next?: string;
}

const KERNEL: Record<string, ErrorCopy> = {
  InvalidJob: { what: "There is no job with that id on this contract.", next: "Check the id, or open the job from the dashboard." },
  WrongStatus: {
    what: "The job has moved on since this page was drawn, so this step no longer applies.",
    next: "Reload the page to see where it stands now.",
  },
  NotClient: { what: "Only the client who opened the job can do this.", next: "Connect the wallet that opened it." },
  NotProvider: { what: "Only the provider named on the job can do this.", next: "Connect the wallet the job was opened for." },
  NotParty: { what: "Only the client or the provider can set a budget.", next: "Connect one of the two wallets on the job." },
  SameParty: { what: "A job cannot be opened for your own address.", next: "Use the provider's address, not yours." },
  ExpiryTooShort: { what: "The expiry is already in the past.", next: "Pick a time far enough ahead for the work and the challenge window." },
  TextTooLong: { what: "The text is longer than the 256 bytes the contract stores.", next: "Shorten it and try again." },
  InvalidAmount: { what: "That amount is outside what the contract accepts.", next: "Use a positive amount the wallet can cover." },
  ZeroBudget: { what: "The job has no budget yet, and funding an empty job is refused.", next: "Set the budget first, then fund." },
  BudgetMismatch: {
    what: "The budget changed between this page being drawn and the transaction being sent, so the contract refused rather than take a different amount.",
    next: "Reload to see the current budget, then fund that.",
  },
  Expired: { what: "The job's expiry has passed, so it can no longer be funded or delivered.", next: "The client can claim the refund." },
  NotExpired: { what: "The job has not expired yet, so there is nothing to refund.", next: "Wait until the expiry shown on the job." },
  WindowOpen: {
    what: "The challenge window is still running, so the payout cannot be finalized yet.",
    next: "Wait for the countdown on the job to reach zero.",
  },
  WindowClosed: { what: "The challenge window has closed, so the job can no longer be rejected.", next: "Anyone can finalize it now." },
  InsufficientBalance: { what: "The contract owes this account less than the amount asked for.", next: "Withdraw the amount it shows as withdrawable." },
  NothingToSkim: { what: "There is nothing unaccounted for to sweep." },
  FeeTooHigh: { what: "That fee is above the maximum the contract allows." },
  InvalidTtlConfig: { what: "Those ledger values are not ones the contract accepts." },
  NoPendingOffer: { what: "No ownership transfer is waiting to be accepted." },
  OfferExpired: { what: "The ownership transfer was offered too long ago and has lapsed." },
  SameOwner: { what: "Ownership is already held by that address, so there is nothing to transfer." },
};

/** The plain-language reading of a contract error name, when there is one. */
export function errorCopy(name: string | undefined): ErrorCopy | null {
  if (name === undefined) return null;
  return KERNEL[name] ?? null;
}

/** Every name this table covers, for the test that holds it to the contract. */
export function coveredErrorNames(): string[] {
  return Object.keys(KERNEL);
}
