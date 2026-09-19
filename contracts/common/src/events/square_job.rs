//! `square_job` (`ISquareJob.sol:47-84`). The first twelve are ERC-8183's
//! normative set; the rest are Square's extensions.

use soroban_sdk::{contractevent, Address, BytesN, Error, String, Symbol};

/// A job was created, Open.
#[contractevent]
pub struct JobCreated {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub client: Address,
    /// Unset until `set_provider` when the client leaves it open.
    #[topic]
    pub provider: Option<Address>,
    pub evaluator: Address,
    pub expired_at: u64,
    pub hook: Option<Address>,
}

/// The provider was filled in.
#[contractevent]
pub struct ProviderSet {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub provider: Address,
}

/// The price was agreed.
#[contractevent]
pub struct BudgetSet {
    #[topic]
    pub job_id: u64,
    pub amount: i128,
}

/// The budget moved into escrow: Funded.
#[contractevent]
pub struct JobFunded {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub client: Address,
    pub amount: i128,
}

/// The provider submitted: Submitted.
#[contractevent]
pub struct JobSubmitted {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub provider: Address,
    pub deliverable: BytesN<32>,
}

/// The evaluator completed the job: Completed.
#[contractevent]
pub struct JobCompleted {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub evaluator: Address,
    pub reason: BytesN<32>,
}

/// The client (while Open) or the evaluator rejected the job: Rejected.
#[contractevent]
pub struct JobRejected {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub rejector: Address,
    pub reason: BytesN<32>,
}

/// `claim_refund` after expiry: Expired.
#[contractevent]
pub struct JobExpired {
    #[topic]
    pub job_id: u64,
}

/// The provider-side share was credited. `provider` is the payee, which is
/// the buyer when the receivable was sold.
#[contractevent]
pub struct PaymentReleased {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub provider: Address,
    pub amount: i128,
}

/// The evaluator fee was credited.
#[contractevent]
pub struct EvaluatorFeePaid {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub evaluator: Address,
    pub amount: i128,
}

/// The client was credited: its share of a split, a rejection or an expiry.
#[contractevent]
pub struct Refunded {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub client: Address,
    pub amount: i128,
}

/// The owner admitted or removed a hook. `None` is "no hook", which is
/// whitelisted at construction as the EVM kernel whitelisted `address(0)`.
#[contractevent]
pub struct HookWhitelistUpdated {
    #[topic]
    pub hook: Option<Address>,
    pub status: bool,
}

/// The description and creation time, beside `JobCreated`.
#[contractevent]
pub struct JobDescribed {
    #[topic]
    pub job_id: u64,
    pub created_at: u64,
    pub description: String,
}

/// The fee basis points the payout will use, snapshotted at `fund`.
#[contractevent]
pub struct FeesSnapshotted {
    #[topic]
    pub job_id: u64,
    pub platform_fee_bp: u32,
    pub evaluator_fee_bp: u32,
    pub funded_at: u64,
}

/// The time the challenge window counts from.
#[contractevent]
pub struct SubmissionTimed {
    #[topic]
    pub job_id: u64,
    pub submitted_at: u64,
    pub expired_at: u64,
}

/// The routing decision at `complete`: who receives the provider-side share,
/// and how the net payout was split.
#[contractevent]
pub struct PayoutRouted {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub payee: Address,
    pub provider_bps: u32,
    pub provider_share: i128,
    pub client_share: i128,
}

/// The platform fee was credited to the treasury.
#[contractevent]
pub struct PlatformFeeAccrued {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub treasury: Address,
    pub amount: i128,
}

/// A ledger debit: the balance holder moved `amount` out to `to`. Keyed by
/// account, not by job.
#[contractevent]
pub struct Withdrawn {
    #[topic]
    pub account: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// The fee basis points in force and the treasury, after `set_fees` or once a
/// scheduled change took effect.
#[contractevent]
pub struct FeesUpdated {
    pub platform_fee_bp: u32,
    pub evaluator_fee_bp: u32,
    pub treasury: Address,
}

/// New fee basis points a later `fund` pins once `effective_from` passes.
#[contractevent]
pub struct FeesScheduled {
    pub platform_fee_bp: u32,
    pub evaluator_fee_bp: u32,
    pub effective_from: u64,
}

/// A balance no ledger entry and no escrow claimed, moved out by the owner.
#[contractevent]
pub struct Skimmed {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// The client bound a compliance proof; `digest` is its keccak256, so the
/// event carries no witness.
#[contractevent]
pub struct ComplianceProofSet {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub client: Address,
    pub digest: BytesN<32>,
}

/// A tolerant hook call failed and the transition went ahead. `action` is
/// the kernel function that was running (`complete`, `reject`), `hook_fn`
/// the hook entry point (`before_action`, `after_action`), `error` the error
/// the call handed back, or `None` when the hook returned the wrong type.
#[contractevent]
pub struct HookFailed {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub hook: Address,
    pub action: Symbol,
    pub hook_fn: Symbol,
    pub error: Option<Error>,
}

/// `claim_refund` on a Submitted job whose hook can no longer name a usable
/// payee: the refund proceeds.
#[contractevent]
pub struct PayoutUnresolvable {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub hook: Address,
}
