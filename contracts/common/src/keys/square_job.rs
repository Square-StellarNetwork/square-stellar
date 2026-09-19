use soroban_sdk::{contracttype, Address};

/// `square_job`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SquareJobKey {
    /// instance: the USDC SAC, fixed at construction (`_paymentToken`).
    PaymentToken,
    /// instance: `u64`, the last job id issued (`_jobCounter`).
    JobCounter,
    /// instance: `u32`, the platform fee in force (`_platformFeeBP`).
    PlatformFeeBp,
    /// instance: `u32`, the evaluator fee in force (`_evaluatorFeeBP`).
    EvaluatorFeeBp,
    /// instance: `Address`, where platform fees are credited (`_platformTreasury`).
    Treasury,
    /// instance: the fee change waiting for its notice to pass
    /// (`_pendingPlatformFeeBP`, `_pendingEvaluatorFeeBP`, `_feesEffectiveFrom`).
    PendingFees,
    /// instance: `i128`, the sum of every `Withdrawable` (`_totalWithdrawable`).
    TotalWithdrawable,
    /// instance: `i128`, the budgets of Funded and Submitted jobs (`_totalEscrowed`).
    TotalEscrowed,
    /// persistent, J: `JobRecord` (`_jobs`).
    Job(u64),
    /// persistent, J: `Bytes`, at most 1 024 (`_complianceProofs`).
    ComplianceProof(u64),
    /// persistent, J of the crediting job: `i128` (`_withdrawable`); removed at zero.
    Withdrawable(Address),
    /// persistent, G: `bool` (`_whitelistedHooks`); `None` is "no hook".
    HookWhitelisted(Option<Address>),
}
