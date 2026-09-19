//! Storage keys, one `#[contracttype]` enum per contract, laid out as
//! docs/decisions/fees-and-ttl.md's TTL table decides (#6). Each variant's
//! doc says where it lives and its TTL class:
//!
//! - **instance**: extended by the instance rule (`ttl::extend_instance`);
//! - **J**: job-scoped (`ttl::bump_job`);
//! - **D**: dispute-scoped (`ttl::bump_dispute`);
//! - **U**: until a timestamp (`ttl::extend_until`);
//! - **G**: global configuration (`ttl::extend_config`, then the keeper's sweep).
//!
//! The owner, a pending owner offer and the `TtlConfig` are not here: they
//! live under `Symbol` keys in `owner` and `ttl`, which cannot collide with
//! these (an enum key encodes as a vector).

pub mod arbitration;
pub mod claim_market;
pub mod compliance_module;
pub mod keeper_evaluator;
pub mod policy_registry;
pub mod screening_registry;
pub mod square_hook;
pub mod square_job;

pub use arbitration::ArbitrationKey;
pub use claim_market::ClaimMarketKey;
pub use compliance_module::ComplianceModuleKey;
pub use keeper_evaluator::KeeperEvaluatorKey;
pub use policy_registry::PolicyRegistryKey;
pub use screening_registry::ScreeningRegistryKey;
pub use square_hook::SquareHookKey;
pub use square_job::SquareJobKey;
