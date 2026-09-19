//! Error codes of `screening_registry`. The codes are stable: the SDK (#23) maps a
//! simulation's `Error(Contract, #n)` to these names through
//! `contracts/common/errors.json`, which `contracts/common/tests/schema.rs`
//! writes from this file. Names and order follow `contracts/src/interfaces/IScreeningRegistry.sol`;
//! a new error is appended, never inserted, and a code is never reused.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ScreeningRegistryError {
    ZeroAddress = 1,
    NotAScreener = 2,
    ScreenedInTheFuture = 3,
    ScreeningTooOld = 4,
    NotNewerThanRecorded = 5,
    MaxAgeOutOfRange = 6,
    LengthMismatch = 7,
    RenounceDisabled = 8,
}
