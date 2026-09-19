use soroban_sdk::{contractevent, Address, BytesN, Env, String};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NewFeedback {
    #[topic]
    pub agent_id: u32,
    #[topic]
    pub client_address: Address,
    #[topic]
    pub tag1: String,
    pub feedback_index: u64,
    pub value: i128,
    pub value_decimals: u32,
    pub tag2: String,
    pub endpoint: String,
    pub feedback_uri: String,
    pub feedback_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeedbackRevoked {
    #[topic]
    pub agent_id: u32,
    #[topic]
    pub client_address: Address,
    #[topic]
    pub feedback_index: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResponseAppended {
    #[topic]
    pub agent_id: u32,
    #[topic]
    pub client_address: Address,
    #[topic]
    pub responder: Address,
    pub feedback_index: u64,
    pub response_uri: String,
    pub response_hash: BytesN<32>,
}

#[allow(clippy::too_many_arguments)]
pub fn new_feedback(
    e: &Env,
    agent_id: u32,
    client_address: &Address,
    feedback_index: u64,
    value: i128,
    value_decimals: u32,
    tag1: &String,
    tag2: &String,
    endpoint: &String,
    feedback_uri: &String,
    feedback_hash: &BytesN<32>,
) {
    NewFeedback {
        agent_id,
        client_address: client_address.clone(),
        tag1: tag1.clone(),
        feedback_index,
        value,
        value_decimals,
        tag2: tag2.clone(),
        endpoint: endpoint.clone(),
        feedback_uri: feedback_uri.clone(),
        feedback_hash: feedback_hash.clone(),
    }
    .publish(e);
}

pub fn feedback_revoked(e: &Env, agent_id: u32, client_address: &Address, feedback_index: u64) {
    FeedbackRevoked {
        agent_id,
        client_address: client_address.clone(),
        feedback_index,
    }
    .publish(e);
}

pub fn response_appended(
    e: &Env,
    agent_id: u32,
    client_address: &Address,
    responder: &Address,
    feedback_index: u64,
    response_uri: &String,
    response_hash: &BytesN<32>,
) {
    ResponseAppended {
        agent_id,
        client_address: client_address.clone(),
        responder: responder.clone(),
        feedback_index,
        response_uri: response_uri.clone(),
        response_hash: response_hash.clone(),
    }
    .publish(e);
}
