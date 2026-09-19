//! The kernel's events (`square_job`, #9), one struct each with
//! `#[contractevent]`: `topics[0]` is the struct's name in snake case, the
//! `#[topic]` fields follow (at most three, so the total stays within
//! Soroban's four), and the other fields form the data map. The event
//! definitions are in the contract spec, so the generated bindings and the
//! SDK's event decoder read them from the Wasm rather than from this file.
//!
//! What EVM logged as `JobCreated` + `JobDescribed`, `JobFunded` +
//! `FeesSnapshotted`, `JobSubmitted` + `SubmissionTimed`, `JobCompleted` +
//! `PaymentReleased` + `PlatformFeeAccrued`, `JobRejected` + `Refunded`,
//! `JobExpired` + `Refunded` and `Withdrawn` is one event each here.

use soroban_sdk::{contractevent, Address, BytesN, String};

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobCreated {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub client: Address,
    #[topic]
    pub provider: Address,
    pub expired_at: u64,
    pub challenge_window: u64,
    pub platform_fee_bps: u32,
    pub description: String,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BudgetSet {
    #[topic]
    pub job_id: u64,
    pub by: Address,
    pub amount: u64,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Funded {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub client: Address,
    pub amount: u64,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Submitted {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub provider: Address,
    pub deliverable: BytesN<32>,
    pub submitted_at: u64,
    /// `submitted_at + challenge_window`: when `finalize` opens and `reject`
    /// closes.
    pub finalize_after: u64,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finalized {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub provider: Address,
    pub payout: u64,
    pub fee: u64,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rejected {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub client: Address,
    /// Zero for a job rejected while Open.
    pub refund: u64,
    pub reason: String,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refunded {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub client: Address,
    pub amount: u64,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Withdrawn {
    #[topic]
    pub account: Address,
    #[topic]
    pub to: Address,
    pub amount: u64,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Skimmed {
    #[topic]
    pub to: Address,
    pub amount: u64,
}
