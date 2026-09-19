//! `IArbitration` types.

use soroban_sdk::{contracttype, Address, BytesN, U256};

/// Same order as the EVM enum; `resolution_hash` hashes the discriminant.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    None,
    Complete,
    Reject,
    Lapsed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub disputer: Address,
    pub bond: u64,
    pub disputed_at: u64,
    pub resolve_by: u64,
    pub set_version: u32,
    /// One bit per arbiter index of `set_version`; `U256` keeps the EVM's
    /// 255-arbiter bound (`MAX_ARBITERS`).
    pub voted: U256,
    pub outcome: Outcome,
    pub provider_bps: u32,
    pub resolution_hash: Option<BytesN<32>>,
    pub bond_settled: bool,
}
