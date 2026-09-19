//! `policy_registry` (`IPolicyRegistry.sol:68-76`). Keyed by the poster, never
//! by a job.

use soroban_sdk::{contractevent, Address, BytesN};

use crate::types::Verdict;

/// On every `set_policy`, including a replacement; `epoch` tells them apart.
#[contractevent]
pub struct PolicyCommitted {
    #[topic]
    pub poster: Address,
    #[topic]
    pub commitment: BytesN<32>,
    pub daily_limit: u128,
    pub epoch: u64,
}

/// On every release booked, inside the policy or not; `day` is the UTC day
/// index.
#[contractevent]
pub struct SpendRecorded {
    #[topic]
    pub poster: Address,
    #[topic]
    pub day: u64,
    pub amount: u128,
    pub spent_after: u128,
}

/// Beside `SpendRecorded` when the verdict is not `Compliant`. The release
/// still happened; this records that it happened outside the ceiling.
#[contractevent]
pub struct ReleaseOutsidePolicy {
    #[topic]
    pub poster: Address,
    #[topic]
    pub day: u64,
    pub spent_after: u128,
    pub daily_limit: u128,
    pub verdict: Verdict,
}

/// The owner added or removed a spender.
#[contractevent]
pub struct SpenderUpdated {
    #[topic]
    pub spender: Address,
    pub allowed: bool,
}

/// On every `set_buyer_root`, including a replacement. `None` admits nobody;
/// the list itself is never published, only its root.
#[contractevent]
pub struct BuyerRootCommitted {
    #[topic]
    pub poster: Address,
    #[topic]
    pub root: Option<BytesN<32>>,
}
