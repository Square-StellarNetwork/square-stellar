use soroban_sdk::{contracttype, Address};

/// `screening_registry`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ScreeningRegistryKey {
    /// instance: `u64`, seconds a record clears its subject (`_maxAge`).
    MaxAge,
    /// persistent, U until `screened_at + max_age`: `ScreeningRecord` (`_records`).
    Record(Address),
    /// persistent, G: `bool` (`_screeners`).
    Screener(Address),
}
