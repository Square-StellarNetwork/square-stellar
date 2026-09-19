//! `IProofState` (docs/decisions/proof-required.md): what a bound proof is, as
//! far as a keeper deciding whether to finalize can tell.

use soroban_sdk::{contracttype, Env, Symbol};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProofState {
    /// The job's hook has no compliance module: nothing to prove.
    NotGated,
    Missing,
    Malformed,
    Unverifiable,
    Decidable,
}

/// Why the compliance module refused a release: the EVM module's `R_*`
/// strings (`ComplianceModule.sol:168-183`), in their order. On the wire
/// (`ReleaseRefused.reason`) each is its [`RefusalReason::text`], the EVM text
/// with spaces as underscores, because a `Symbol` holds `[a-zA-Z0-9_]` only.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RefusalReason {
    NoProof,
    MalformedProof,
    InvalidProof,
    NotCompliant,
    PolicyCommitment,
    Recipient,
    Amount,
    Token,
    DailySpentBefore,
    TimestampOutsideWindow,
    StripeReceiptHash,
    ProofAlreadyUsed,
    DailyCeiling,
    HookNotAuthorised,
    NotASpender,
    SpendNotRecorded,
}

impl RefusalReason {
    pub const ALL: [RefusalReason; 16] = [
        Self::NoProof,
        Self::MalformedProof,
        Self::InvalidProof,
        Self::NotCompliant,
        Self::PolicyCommitment,
        Self::Recipient,
        Self::Amount,
        Self::Token,
        Self::DailySpentBefore,
        Self::TimestampOutsideWindow,
        Self::StripeReceiptHash,
        Self::ProofAlreadyUsed,
        Self::DailyCeiling,
        Self::HookNotAuthorised,
        Self::NotASpender,
        Self::SpendNotRecorded,
    ];

    pub const fn text(self) -> &'static str {
        match self {
            Self::NoProof => "no_proof_bound",
            Self::MalformedProof => "malformed_proof",
            Self::InvalidProof => "invalid_proof",
            Self::NotCompliant => "is_compliant_is_0",
            Self::PolicyCommitment => "policy_commitment",
            Self::Recipient => "recipient",
            Self::Amount => "amount",
            Self::Token => "token",
            Self::DailySpentBefore => "daily_spent_before",
            Self::TimestampOutsideWindow => "timestamp_outside_window",
            Self::StripeReceiptHash => "stripe_receipt_hash",
            Self::ProofAlreadyUsed => "proof_already_used",
            Self::DailyCeiling => "daily_ceiling",
            Self::HookNotAuthorised => "hook_not_authorised",
            Self::NotASpender => "not_a_spender",
            Self::SpendNotRecorded => "spend_not_recorded",
        }
    }

    pub fn symbol(self, env: &Env) -> Symbol {
        Symbol::new(env, self.text())
    }
}
