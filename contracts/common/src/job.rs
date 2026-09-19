//! The kernel's record, status, settings and error codes (`square_job`, #9).
//!
//! MVP settlement is the window model: after the provider submits, a challenge
//! window runs; the client may `reject` inside it (refund), and once it has
//! passed anyone may `finalize` (payout). No evaluator, hook or arbitration.
//!
//! Field widths follow the EVM record where Soroban allows: `uint16` bps are
//! `u32` (no `u16` in `#[contracttype]`), `uint48` timestamps are `u64`.

use soroban_sdk::{contracterror, contracttype, Address, BytesN, String};

/// Basis points in one whole.
pub const BPS: u32 = 10_000;
/// The largest platform fee a deployment may charge, 20 % (`MAX_TOTAL_FEE_BP`).
pub const MAX_PLATFORM_FEE_BPS: u32 = 2_000;
/// The longest description or rejection reason, in bytes (`MAX_DESCRIPTION`).
pub const MAX_TEXT: u32 = 256;

/// The status of a job, in the order the EVM enum had.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    /// Created; the budget may still change; nothing is escrowed.
    Open = 0,
    /// The budget is in the kernel.
    Funded = 1,
    /// The provider delivered; the challenge window runs from `submitted_at`.
    Submitted = 2,
    /// Finalized after the window: the provider was credited, less the fee.
    Completed = 3,
    /// The client rejected: the budget, if escrowed, was credited back.
    Rejected = 4,
    /// Expired before submission: the budget was credited back.
    Expired = 5,
}

/// A job. Timestamps are ledger seconds; a zero timestamp means "not yet".
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Job {
    pub client: Address,
    pub provider: Address,
    pub status: JobStatus,
    /// Escrowed on `fund`; zero until `set_budget`.
    pub budget: u64,
    /// The deployment's fee at creation. Settings do not change, so this is
    /// the fee `finalize` charges.
    pub platform_fee_bps: u32,
    /// The deployment's challenge window at creation, in seconds.
    pub challenge_window: u64,
    pub created_at: u64,
    /// After this, `fund` and `submit` refuse and `claim_refund` opens.
    pub expired_at: u64,
    pub funded_at: u64,
    /// `finalize` opens at `submitted_at + challenge_window`; `reject` closes.
    pub submitted_at: u64,
    /// The hash the provider submitted.
    pub deliverable: Option<BytesN<32>>,
    pub description: String,
}

/// The deployment's settings, fixed by the constructor.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    /// The SEP-41 token every job is paid in: on testnet the native XLM
    /// Stellar Asset Contract.
    pub token: Address,
    /// Seconds the client has after a submission to reject.
    pub challenge_window: u64,
    /// The share of a finalized budget credited to the owner.
    pub platform_fee_bps: u32,
}

/// The kernel's error codes. Numbers are stable: the SDK maps a simulation's
/// `Error(Contract, #n)` to these names. 100–102 belong to
/// [`crate::owner::OwnerError`].
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum SquareJobError {
    /// No job has this id.
    InvalidJob = 1,
    /// The job is not in a status this action applies to.
    WrongStatus = 2,
    /// The signer is not the job's client.
    NotClient = 3,
    /// The signer is not the job's provider.
    NotProvider = 4,
    /// The signer is neither the job's client nor its provider.
    NotParty = 5,
    /// Client and provider are the same address.
    SameParty = 6,
    /// `expired_at` is not after the ledger's time.
    ExpiryTooShort = 7,
    /// A description or reason longer than `MAX_TEXT` bytes.
    TextTooLong = 8,
    /// An amount that is not positive or does not fit `u64`.
    InvalidAmount = 9,
    /// `fund` before `set_budget`.
    ZeroBudget = 10,
    /// `fund`'s `expected_budget` is not the job's budget.
    BudgetMismatch = 11,
    /// `fund` or `submit` at or after `expired_at`.
    Expired = 12,
    /// `claim_refund` before `expired_at`.
    NotExpired = 13,
    /// `finalize` before the challenge window has passed.
    WindowOpen = 14,
    /// `reject` of a submission after the challenge window has passed.
    WindowClosed = 15,
    /// `withdraw_to` of more than the account's balance.
    InsufficientBalance = 16,
    /// `skim` when the token balance is fully accounted for.
    NothingToSkim = 17,
    /// A constructor fee above `MAX_PLATFORM_FEE_BPS`.
    FeeTooHigh = 18,
    /// A `TtlConfig` with a zero field.
    InvalidTtlConfig = 19,
}
