//! `square_hook` (`SquareHook.sol:56-80`), and the one event its Soroban-only
//! owner switch adds.

use soroban_sdk::{contractevent, Address, BytesN, Error, Symbol};

use crate::types::{CheckOutcome, ReputationOutcome};

/// At `submit`: the job is bound to the provider's agent and, when one was
/// given, its validation request.
#[contractevent]
pub struct AgentBound {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub agent_id: u32,
    pub validation_request_hash: Option<BytesN<32>>,
}

/// At `complete`: whether the installed compliance module booked the
/// release; `verified` is false while no module is installed.
#[contractevent]
pub struct ComplianceChecked {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub payee: Address,
    pub amount: i128,
    pub verified: bool,
}

/// Feedback written to the reputation registry for the provider's agent.
#[contractevent]
pub struct ReputationRecorded {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub agent_id: u32,
    pub outcome: ReputationOutcome,
    pub value: i128,
}

/// The reputation registry failed; settlement was not rolled back.
#[contractevent]
pub struct ReputationWriteFailed {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub agent_id: u32,
    pub error: Option<Error>,
}

/// The hook's validation response for the job's request: 100 when every
/// installed check passed and the payee was paid, 0 otherwise.
#[contractevent]
pub struct ValidationRecorded {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub request_hash: BytesN<32>,
    pub response: u32,
}

/// The validation registry failed; settlement was not rolled back.
#[contractevent]
pub struct ValidationWriteFailed {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub request_hash: BytesN<32>,
    pub error: Option<Error>,
}

/// The owner installed, replaced or removed the compliance module.
#[contractevent]
pub struct ComplianceModuleUpdated {
    #[topic]
    pub module: Option<Address>,
}

/// The owner installed, replaced or removed the screening registry.
#[contractevent]
pub struct ScreeningUpdated {
    #[topic]
    pub registry: Option<Address>,
}

/// At `complete`, with screening installed: whether the payee was cleared.
#[contractevent]
pub struct ScreeningChecked {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub payee: Address,
    pub cleared: bool,
}

/// The compliance module failed while `before_action` checked the release;
/// settlement continues and `ComplianceChecked` reports `verified = false`.
#[contractevent]
pub struct ComplianceCheckFailed {
    #[topic]
    pub job_id: u64,
    pub error: Option<Error>,
}

/// Whose jobs earn positive reputation, and the budget below which none is
/// written.
#[contractevent]
pub struct ReputationPolicyUpdated {
    #[topic]
    pub trusted_evaluator: Option<Address>,
    pub min_reputation_budget: u64,
}

/// Positive feedback deliberately not written; no registry call was made.
/// `reason` is a `SkipReason::text`: `untrusted_evaluator` or
/// `budget_below_minimum`.
#[contractevent]
pub struct ReputationSkipped {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub agent_id: u32,
    pub reason: Symbol,
}

/// The kernel paid `amount` to `payee` on a preview that passed, and the
/// check that books the release did not pass.
#[contractevent]
pub struct ReleaseUnconfirmed {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub payee: Address,
    pub amount: i128,
}

/// At `fund`, with a compliance module installed: the policy commitment every
/// later proof for this job is checked against.
#[contractevent]
pub struct PolicyPinned {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub client: Address,
    pub commitment: BytesN<32>,
}

/// The settlement facts the evidence commits to were not in the context the
/// kernel pushed, so no validation record is written. Settlement and the
/// reputation write are untouched.
#[contractevent]
pub struct EvidenceUnreadable {
    #[topic]
    pub job_id: u64,
}

/// The preimage of the validation `response_hash`: anyone can recompute
/// `commitment` with `square_common::hash::evidence_hash` and compare it with
/// the registry's record.
#[contractevent]
pub struct EvidenceRecorded {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub payee: Address,
    pub amount: i128,
    pub token: Address,
    pub screening: Option<BytesN<32>>,
    pub compliance_outcome: CheckOutcome,
    pub screening_outcome: CheckOutcome,
    pub commitment: BytesN<32>,
}

/// The owner switched the advisory registry writes on or off
/// (docs/decisions/call-graph-on-soroban.md, decision 5).
#[contractevent]
pub struct RegistryWritesUpdated {
    pub reputation: bool,
    pub validation: bool,
}
