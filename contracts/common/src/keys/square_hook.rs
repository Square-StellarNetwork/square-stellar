use soroban_sdk::contracttype;

/// `square_hook`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SquareHookKey {
    /// instance: the kernel whose calls the hook serves (`_squareJob`).
    Kernel,
    /// instance: the USDC SAC (`_paymentToken`).
    PaymentToken,
    /// instance: the claim market (`_claimMarket`).
    ClaimMarket,
    /// instance: the 8004 identity registry (`_identityRegistry`).
    IdentityRegistry,
    /// instance: the 8004 reputation registry (`_reputationRegistry`).
    ReputationRegistry,
    /// instance: the 8004 validation registry (`_validationRegistry`).
    ValidationRegistry,
    /// instance: `Address`, absent while no module is installed (`_complianceModule`).
    ComplianceModule,
    /// instance: `Address`, absent while no screening is installed (`_screening`).
    Screening,
    /// instance: `Address`, whose jobs earn positive reputation (`_trustedEvaluator`).
    TrustedEvaluator,
    /// instance: `u64` (`_minReputationBudget`).
    MinReputationBudget,
    /// instance: `bool`, the reputation write switch (new on Soroban).
    ReputationWrites,
    /// instance: `bool`, the validation write switch (new on Soroban).
    ValidationWrites,
    /// persistent, J: `u32`, the agent bound at submit (`_boundAgentPlusOne`).
    BoundAgent(u64),
    /// persistent, J: `BytesN<32>`, the validation request bound at submit (`_validationOf`).
    ValidationOf(u64),
    /// persistent, J: `bool`, reputation written once (`_recorded`).
    Recorded(u64),
}
