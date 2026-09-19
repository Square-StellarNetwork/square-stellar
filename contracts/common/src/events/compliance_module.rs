//! `compliance_module` (`ComplianceModule.sol:138-150`).

use soroban_sdk::{contractevent, Address, BytesN, Symbol};

use crate::types::Verdict;

/// The hook whose `check_release` calls this module books.
#[contractevent]
pub struct HookUpdated {
    #[topic]
    pub hook: Address,
}

/// How far a proof's timestamp may sit from the ledger's.
#[contractevent]
pub struct TimestampToleranceUpdated {
    pub seconds: u64,
}

/// A release the proof gated and the module booked: `statement` is spent from
/// here on and the policy counter advanced by `amount`.
#[contractevent]
pub struct ReleaseVerified {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub payee: Address,
    pub amount: i128,
    pub statement: BytesN<32>,
}

/// A proof that passed every binding and still came back `NoPolicy` or
/// `LimitExceeded` from `policy_registry.record_spend`.
#[contractevent]
pub struct VerdictDisagreed {
    #[topic]
    pub job_id: u64,
    pub verdict: Verdict,
}

/// A release the module refused, and why: `reason` is a
/// `RefusalReason::text`, the EVM module's text with underscores
/// (`malformed_proof`, `recipient`, `proof_already_used`, …). `statement` is
/// `None` for the two refusals that come before any signal is read.
#[contractevent]
pub struct ReleaseRefused {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub statement: Option<BytesN<32>>,
    pub reason: Symbol,
}
