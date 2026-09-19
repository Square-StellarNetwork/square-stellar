use soroban_sdk::{contractevent, Address, BytesN, Env, String};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationRequest {
    #[topic]
    pub validator_address: Address,
    #[topic]
    pub agent_id: u32,
    #[topic]
    pub request_hash: BytesN<32>,
    pub request_uri: String,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationResponse {
    #[topic]
    pub validator_address: Address,
    #[topic]
    pub agent_id: u32,
    #[topic]
    pub request_hash: BytesN<32>,
    pub response: u32,
    pub response_uri: String,
    pub response_hash: BytesN<32>,
    pub tag: String,
}

pub fn validation_requested(
    e: &Env,
    validator_address: &Address,
    agent_id: u32,
    request_hash: &BytesN<32>,
    request_uri: &String,
) {
    ValidationRequest {
        validator_address: validator_address.clone(),
        agent_id,
        request_hash: request_hash.clone(),
        request_uri: request_uri.clone(),
    }
    .publish(e);
}

#[allow(clippy::too_many_arguments)]
pub fn validation_responded(
    e: &Env,
    validator_address: &Address,
    agent_id: u32,
    request_hash: &BytesN<32>,
    response: u32,
    response_uri: &String,
    response_hash: &BytesN<32>,
    tag: &String,
) {
    ValidationResponse {
        validator_address: validator_address.clone(),
        agent_id,
        request_hash: request_hash.clone(),
        response,
        response_uri: response_uri.clone(),
        response_hash: response_hash.clone(),
        tag: tag.clone(),
    }
    .publish(e);
}
