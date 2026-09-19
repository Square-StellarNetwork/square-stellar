use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReputationError {
    SelfFeedback = 1,
    FeedbackNotFound = 2,
    InvalidValueDecimals = 3,
    /// Retained for ABI stability (now unused).
    NotOwnerOrApproved = 4,
    AggregateOverflow = 5,
    AgentNotFound = 6,
    EmptyValue = 7,
    ValueOutOfRange = 8,
    ClientAddressesRequired = 9,
    NoUpgradeProposed = 10,
    TimelockNotExpired = 11,
    UpgradeAlreadyProposed = 12,
}
