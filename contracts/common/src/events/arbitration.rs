//! `arbitration` (`IArbitration.sol:25-47`).

use soroban_sdk::{contractevent, Address, BytesN, Error, Vec, U256};

use crate::types::Outcome;

/// A new arbiter set, in full, so the indexer can map vote bits to addresses.
#[contractevent]
pub struct ArbitersUpdated {
    #[topic]
    pub version: u32,
    pub arbiters: Vec<Address>,
    pub threshold: u32,
}

/// Bond parameters for disputes opened from now on.
#[contractevent]
pub struct BondParametersUpdated {
    pub bond_bps: u32,
    pub min_bond: u64,
}

/// A dispute opened and its bond was pulled from the disputer.
#[contractevent]
pub struct DisputeOpened {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub disputer: Address,
    pub bond: u64,
    pub disputed_at: u64,
    pub set_version: u32,
    pub resolve_by: u64,
}

/// An arbiter voted; `approvals` is the running bitmask for that resolution.
#[contractevent]
pub struct VoteCast {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub arbiter: Address,
    #[topic]
    pub resolution_hash: BytesN<32>,
    pub outcome: Outcome,
    pub provider_bps: u32,
    pub approvals: U256,
}

/// The threshold was met.
#[contractevent]
pub struct DecisionReached {
    #[topic]
    pub job_id: u64,
    pub outcome: Outcome,
    pub provider_bps: u32,
    pub resolution_hash: BytesN<32>,
}

/// No decision by `resolve_by`: the dispute lapses to the optimistic outcome.
#[contractevent]
pub struct DisputeExpired {
    #[topic]
    pub job_id: u64,
}

/// The bond was credited to whoever won it.
#[contractevent]
pub struct BondSettled {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub to: Address,
    pub amount: u64,
}

/// A bond ledger debit. Keyed by account, not by job.
#[contractevent]
pub struct BondWithdrawn {
    #[topic]
    pub account: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// The panel decided Reject and the kernel refused to apply it; the decision
/// is still recorded. `error` is what the refused call handed back.
#[contractevent]
pub struct RejectionNotApplied {
    #[topic]
    pub job_id: u64,
    pub error: Option<Error>,
}
