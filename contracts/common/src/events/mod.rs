//! The event schema (#8), one module per contract so the contracts can be
//! written in parallel. `docs/design/storage-and-events.md` is generated from
//! these definitions by `contracts/common/tests/schema.rs`.
//!
//! The rule, for every event:
//!
//! - `topics[0]` is the event's name as a `Symbol`, in snake case
//!   (`JobCreated` → `job_created`);
//! - `topics[1..]` are the fields the EVM event marked `indexed`, in order, so
//!   an event has at most four topics;
//! - `data` is a map of the remaining fields, keyed by field name.
//!
//! Struct names are the EVM event names, so an indexer that knew the EVM
//! schema finds each event under the same name. Types follow one rule:
//! `uint256 jobId` → `u64`, token amounts → `i128` (the SAC's type) unless the
//! EVM field was `uint64` or `uint128`, a zero address or `bytes32(0)` that
//! meant "none" → `Option`, `bytes` revert data → `Option<Error>` (the error
//! a caught call handed back; `None` when it returned the wrong type), a
//! `uint8` code → a `#[contracttype]` enum, and a `bytes32` short string →
//! a `Symbol` of the same text with spaces as underscores.

pub mod arbitration;
pub mod claim_market;
pub mod compliance_module;
pub mod keeper_evaluator;
pub mod policy_registry;
pub mod screening_registry;
pub mod square_hook;
pub mod square_job;
