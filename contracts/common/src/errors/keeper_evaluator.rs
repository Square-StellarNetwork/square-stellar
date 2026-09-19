//! Error codes of `keeper_evaluator`. The codes are stable: the SDK (#23) maps a
//! simulation's `Error(Contract, #n)` to these names through
//! `contracts/common/errors.json`, which `contracts/common/tests/schema.rs`
//! writes from this file. Names and order follow `contracts/src/interfaces/IKeeperEvaluator.sol`;
//! a new error is appended, never inserted, and a code is never reused.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum KeeperEvaluatorError {
    ZeroAddress = 1,
    ZeroWindow = 2,
    NotOurJob = 3,
    NotSubmitted = 4,
    WindowOpen = 5,
    WindowClosed = 6,
    Disputed = 7,
    NotDisputed = 8,
    AlreadyResolved = 9,
    NotDecided = 10,
    OnlyClient = 11,
    OnlyArbitration = 12,
    ArbitrationAlreadySet = 13,
    ArbitrationNotSet = 14,
    SplitNeedsAPayoutResolver = 15,
    ProofRequired = 16,
}
