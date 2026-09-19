//! Shared by every Square contract (#8): the types the contracts exchange,
//! one error enum, one event module and one storage key enum per contract,
//! the cross-contract interfaces, BN254 constants, keccak preimages, the
//! address field mapping, the two-step owner and the TTL policy. Decided in docs/decisions/ (call graph, auth and token
//! flow, fees and TTL, upgradeability and governance).
#![no_std]

pub mod address;
pub mod bn254;
pub mod errors;
pub mod events;
pub mod hash;
pub mod interfaces;
pub mod keys;
pub mod owner;
pub mod ttl;
pub mod types;

#[cfg(test)]
mod test;
