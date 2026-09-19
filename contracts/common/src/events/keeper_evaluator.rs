//! `keeper_evaluator` (`IKeeperEvaluator.sol:20-27`).

use soroban_sdk::{contractevent, Address};

use crate::types::Outcome;

/// A new window entry, in force from `effective_from`.
#[contractevent]
pub struct WindowsConfigured {
    pub effective_from: u64,
    pub challenge_window: u64,
    pub dispute_window: u64,
}

/// The finalize grace of the entry `WindowsConfigured` just announced; both
/// are published on every window push.
#[contractevent]
pub struct FinalizeGraceConfigured {
    pub finalize_grace: u64,
}

/// The arbitration contract this evaluator trusts, set exactly once.
#[contractevent]
pub struct ArbitrationSet {
    #[topic]
    pub arbitration: Address,
}

/// Optimistic completion, and who was paid for calling it.
#[contractevent]
pub struct Finalized {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub keeper: Address,
    pub keeper_fee: i128,
}

/// The client disputed; finalize is closed for the job.
#[contractevent]
pub struct DisputeRaised {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub disputer: Address,
    pub disputed_at: u64,
    pub challenge_end: u64,
}

/// An arbitration decision settled on the kernel.
#[contractevent]
pub struct DecisionApplied {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub keeper: Address,
    pub outcome: Outcome,
    pub provider_bps: u32,
    pub keeper_fee: i128,
}
