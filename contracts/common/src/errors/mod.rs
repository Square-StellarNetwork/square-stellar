//! One `#[contracterror]` enum per contract, each in its own file so the
//! contracts can be written in parallel without touching each other's codes.
//! `owner::OwnerError` (codes 900+) is shared by every contract with an owner.

pub mod arbitration;
pub mod claim_market;
pub mod compliance_module;
pub mod groth16_verifier;
pub mod keeper_evaluator;
pub mod policy_registry;
pub mod screening_registry;
pub mod square_hook;
pub mod square_job;

pub use arbitration::ArbitrationError;
pub use claim_market::ClaimMarketError;
pub use compliance_module::ComplianceModuleError;
pub use groth16_verifier::Groth16VerifierError;
pub use keeper_evaluator::KeeperEvaluatorError;
pub use policy_registry::PolicyRegistryError;
pub use screening_registry::ScreeningRegistryError;
pub use square_hook::SquareHookError;
pub use square_job::SquareJobError;
