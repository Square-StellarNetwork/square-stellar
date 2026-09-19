//! `claim_market` (`IClaimMarket.sol:20-22`).

use soroban_sdk::{contractevent, Address};

/// The provider listed the job's receivable.
#[contractevent]
pub struct ClaimListed {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub seller: Address,
    pub price: u64,
    pub face_value: u64,
}

/// A buyer bought it; the job's payee is now the buyer.
#[contractevent]
pub struct ClaimBought {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub buyer: Address,
    #[topic]
    pub seller: Address,
    pub price: u64,
}

/// The seller withdrew the listing.
#[contractevent]
pub struct ClaimCancelled {
    #[topic]
    pub job_id: u64,
    #[topic]
    pub seller: Address,
}
