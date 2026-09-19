//! Error codes of `groth16_verifier`. The codes are stable: the SDK (#23) maps a
//! simulation's `Error(Contract, #n)` to these names through
//! `contracts/common/errors.json`, which `contracts/common/tests/schema.rs`
//! writes from this file. Names and order follow `contracts/src/Groth16Verifier.sol`;
//! a new error is appended, never inserted, and a code is never reused.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Groth16VerifierError {
    ProofLength = 1,
    KeyLength = 2,
}
