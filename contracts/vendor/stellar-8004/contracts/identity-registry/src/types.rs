use soroban_sdk::{contracttype, Bytes, String};

#[contracttype]
#[derive(Clone)]
pub struct MetadataEntry {
    pub key: String,
    pub value: Bytes,
}
