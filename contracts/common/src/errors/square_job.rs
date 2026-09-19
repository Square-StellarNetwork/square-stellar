//! Error codes of `square_job`. The codes are stable: the SDK (#23) maps a
//! simulation's `Error(Contract, #n)` to these names through
//! `contracts/common/errors.json`, which `contracts/common/tests/schema.rs`
//! writes from this file. Names and order follow `contracts/src/interfaces/ISquareJob.sol`;
//! a new error is appended, never inserted, and a code is never reused.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SquareJobError {
    InvalidJob = 1,
    WrongStatus = 2,
    Unauthorized = 3,
    ZeroAddress = 4,
    ExpiryInPast = 5,
    ExpiryTooLarge = 6,
    ExpiryTooShort = 7,
    PastExpiry = 8,
    NotExpired = 9,
    ZeroBudget = 10,
    BudgetTooLarge = 11,
    BudgetMismatch = 12,
    ProviderNotSet = 13,
    ProviderAlreadySet = 14,
    FeesTooHigh = 15,
    NothingToSkim = 16,
    ComplianceProofTooLarge = 17,
    HookNotWhitelisted = 18,
    InvalidHook = 19,
    HookReverted = 20,
    InvalidPayee = 21,
    InvalidSplit = 22,
    InsufficientBalance = 23,
    DescriptionTooLong = 24,
    SettledByEvaluator = 25,
    ProviderIsEvaluator = 26,
}
