//! Shared by every Square contract: types, error codes, the event schema,
//! storage and TTL helpers, ownership. Written in B1 (#8), from the decisions
//! in docs/decisions/ (call graph, auth and token flow, fees and TTL,
//! upgradeability and governance).
//!
//! MVP scope (milestone "MVP — testnet"): only what the kernel (#9) uses. The
//! hook, module, market and screening types, the hash helpers and the
//! `test-support` doubles are phase 2.
//!
//! Every `#[contracttype]` enum used as a storage key serializes as a vector of
//! its variant's name, without the enum's name. Two enums in one contract with
//! a variant of the same name would share a slot. The owner's keys are
//! `OwnerKey::Owner` and `OwnerKey::PendingOwner`; a contract's own `DataKey`
//! must not reuse those names.
#![no_std]

pub mod amount;
pub mod events;
pub mod job;
pub mod owner;
pub mod ttl;
