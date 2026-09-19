//! The `#[contracttype]`s the contracts share, one module per owner so the
//! contracts can be written in parallel.

pub mod arbitration;
pub mod compliance;
pub mod hook;
pub mod job;
pub mod keeper;
pub mod market;
pub mod policy;
pub mod screening;

pub use arbitration::{Dispute, Outcome};
pub use compliance::{ProofState, RefusalReason};
pub use hook::{ReputationOutcome, SkipReason};
pub use job::{
    Action, BeforeOutcome, CheckOutcome, CompleteParams, HookContext, JobRecord, JobStatus, Payout,
    PayoutStatus, Release, SubmitParams,
};
pub use keeper::{DisputeRef, Window};
pub use market::{Listing, ListingStatus};
pub use policy::{DailySpend, Policy, Verdict};
pub use screening::{Screening, ScreeningRecord};
