//! Error codes of `arbitration`. The codes are stable: the SDK (#23) maps a
//! simulation's `Error(Contract, #n)` to these names through
//! `contracts/common/errors.json`, which `contracts/common/tests/schema.rs`
//! writes from this file. Names and order follow `contracts/src/interfaces/IArbitration.sol`;
//! a new error is appended, never inserted, and a code is never reused.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ArbitrationError {
    ZeroAddress = 1,
    OnlyKeeperEvaluator = 2,
    NoArbiters = 3,
    BadArbiterSet = 4,
    BadBondParameters = 5,
    DisputeExists = 6,
    UnknownDispute = 7,
    AlreadyDecided = 8,
    NotAnArbiter = 9,
    AlreadyVoted = 10,
    BadResolution = 11,
    NotLapsed = 12,
    NothingToSettle = 13,
    InsufficientBalance = 14,
    SplitNeedsAPayoutResolver = 15,
    JobNoLongerVotable = 16,
}
