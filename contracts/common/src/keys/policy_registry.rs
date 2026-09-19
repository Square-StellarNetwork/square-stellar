use soroban_sdk::{contracttype, Address};

/// `policy_registry`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PolicyRegistryKey {
    /// persistent, G on write and J on use: `Policy` (`_policies`).
    Policy(Address),
    /// persistent, U until the next policy day: `DailySpend` (`_spend`).
    DailySpend(Address),
    /// persistent, G on write and J on use: `BytesN<32>` (`_buyerRoots`).
    BuyerRoot(Address),
    /// persistent, G: `bool` (`_spenders`).
    Spender(Address),
}
