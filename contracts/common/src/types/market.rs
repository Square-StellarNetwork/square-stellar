//! `IClaimMarket` types.

use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ListingStatus {
    None,
    Listed,
    Sold,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Listing {
    pub seller: Address,
    pub buyer: Option<Address>,
    pub price: u64,
    pub face_value: u64,
    pub status: ListingStatus,
}
