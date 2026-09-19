//! Error codes of `claim_market`. The codes are stable: the SDK (#23) maps a
//! simulation's `Error(Contract, #n)` to these names through
//! `contracts/common/errors.json`, which `contracts/common/tests/schema.rs`
//! writes from this file. Names and order follow `contracts/src/interfaces/IClaimMarket.sol`;
//! a new error is appended, never inserted, and a code is never reused.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ClaimMarketError {
    NotSubmitted = 1,
    NotOptimisticJob = 2,
    OnlyProvider = 3,
    OnlySeller = 4,
    Disputed = 5,
    ListingActive = 6,
    NotListed = 7,
    BadPrice = 8,
    BuyerIsSeller = 9,
    BuyerIsClient = 10,
    PayoutNotRouted = 11,
    PriceMismatch = 12,
    BuyerNotEligible = 13,
}
