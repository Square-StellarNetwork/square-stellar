//! `screening_registry` (`IScreeningRegistry.sol:47-56`). Keyed by the
//! subject.

use soroban_sdk::{contractevent, Address, BytesN};

/// An accepted screening; `evidence` is the hash of the source's raw response.
#[contractevent]
pub struct Screened {
    #[topic]
    pub subject: Address,
    #[topic]
    pub source: BytesN<32>,
    #[topic]
    pub screener: Address,
    pub sanctioned: bool,
    pub screened_at: u64,
    pub evidence: BytesN<32>,
}

/// The owner added or removed a screener; removing one also stops its records
/// from clearing anyone.
#[contractevent]
pub struct ScreenerUpdated {
    #[topic]
    pub screener: Address,
    pub allowed: bool,
}

/// How long a record clears its subject.
#[contractevent]
pub struct MaxAgeUpdated {
    pub max_age: u64,
}
