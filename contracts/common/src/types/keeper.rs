//! `IKeeperEvaluator` types.

use soroban_sdk::{contracttype, Address};

/// A window version: every job reads the version in force when it was submitted.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Window {
    pub effective_from: u64,
    pub challenge_window: u64,
    pub dispute_window: u64,
    pub finalize_grace: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeRef {
    pub disputer: Address,
    pub disputed_at: u64,
    pub resolved: bool,
}
