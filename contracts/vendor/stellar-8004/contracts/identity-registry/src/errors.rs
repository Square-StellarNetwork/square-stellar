use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum IdentityError {
    NotOwnerOrApproved = 1,
    UriNotSet = 2,
    AgentNotFound = 3,
    MetadataKeyTooLong = 4,
    MetadataValueTooLong = 5,
    TooManyMetadataKeys = 6,
    ReservedMetadataKey = 7,
    EmptyValue = 8,
    NoUpgradeProposed = 9,
    TimelockNotExpired = 10,
    UpgradeAlreadyProposed = 11,
}
