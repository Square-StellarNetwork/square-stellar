//! Error codes of `square_hook`. The codes are stable: the SDK (#23) maps a
//! simulation's `Error(Contract, #n)` to these names through
//! `contracts/common/errors.json`, which `contracts/common/tests/schema.rs`
//! writes from this file. Names and order follow `contracts/src/SquareHook.sol`;
//! a new error is appended, never inserted, and a code is never reused.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SquareHookError {
    OnlyKernel = 1,
    AgentNotOwnedByProvider = 2,
    ValidationRequestMismatch = 3,
    NotExpired = 4,
    NoPolicy = 5,
    AlreadyRecorded = 6,
    NoAgentBound = 7,
    NotCleared = 8,
}
