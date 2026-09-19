//! `IPolicyRegistry` types. `daily_limit` and `spent` are USDC base units at
//! 7 decimals, bounded by the circuit's `Num2Bits(64)`.

use soroban_sdk::{contracttype, BytesN};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Verdict {
    Compliant,
    NoPolicy,
    LimitExceeded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    pub commitment: BytesN<32>,
    pub daily_limit: u128,
    pub updated_at: u64,
    pub epoch: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DailySpend {
    pub day: u64,
    pub spent: u128,
}
