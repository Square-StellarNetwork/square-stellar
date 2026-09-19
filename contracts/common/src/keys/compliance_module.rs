use soroban_sdk::{contracttype, BytesN};

/// `compliance_module`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ComplianceModuleKey {
    /// instance: the hook whose `check_release` calls are booked (`_hook`).
    Hook,
    /// instance: the Groth16 verifier, fixed at construction (`_verifier`).
    Verifier,
    /// instance: the policy registry, fixed at construction (`_registry`).
    PolicyRegistry,
    /// instance: the kernel, fixed at construction (`_squareJob`).
    Kernel,
    /// instance: `u64`, seconds (`_timestampTolerance`).
    TimestampTolerance,
    /// persistent, U: `bool`, a spent statement (`_consumed`), until the
    /// proof's timestamp plus the tolerance.
    Consumed(BytesN<32>),
}
