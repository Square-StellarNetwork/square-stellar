//! `IScreeningRegistry` types. The EIP-712 `Screening` struct is now the
//! argument the screener authorizes (auth-and-token-flow.md, decision 6).

use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Screening {
    pub subject: Address,
    pub sanctioned: bool,
    pub screened_at: u64,
    pub source: BytesN<32>,
    pub evidence: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScreeningRecord {
    pub screener: Address,
    pub screened_at: u64,
    pub sanctioned: bool,
    pub source: BytesN<32>,
    pub evidence: BytesN<32>,
}
