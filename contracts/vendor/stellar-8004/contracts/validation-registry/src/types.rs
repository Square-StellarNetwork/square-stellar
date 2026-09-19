use soroban_sdk::{contracttype, Address, BytesN, String};

#[contracttype]
#[derive(Clone)]
pub struct ValidationStatus {
    pub validator_address: Address,
    pub agent_id: u32,
    pub response: u32,
    pub response_hash: BytesN<32>,
    pub tag: String,
    pub last_update: u64,
    pub has_response: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct ValidationSummary {
    pub count: u64,
    pub average_response: u32,
}
