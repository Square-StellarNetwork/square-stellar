use soroban_sdk::{contractevent, Address, Bytes, Env, String};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Registered {
    #[topic]
    pub agent_id: u32,
    #[topic]
    pub owner: Address,
    pub agent_uri: String,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UriUpdated {
    #[topic]
    pub agent_id: u32,
    #[topic]
    pub updated_by: Address,
    pub new_uri: String,
}

/// All metadata writes (including agentWallet) flow through this event.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataSet {
    #[topic]
    pub agent_id: u32,
    #[topic]
    pub key: String,
    pub value: Bytes,
}

pub fn registered(e: &Env, agent_id: u32, owner: &Address, agent_uri: &String) {
    Registered {
        agent_id,
        owner: owner.clone(),
        agent_uri: agent_uri.clone(),
    }
    .publish(e);
}

pub fn uri_updated(e: &Env, agent_id: u32, updated_by: &Address, new_uri: &String) {
    UriUpdated {
        agent_id,
        updated_by: updated_by.clone(),
        new_uri: new_uri.clone(),
    }
    .publish(e);
}

pub fn metadata_set(e: &Env, agent_id: u32, key: &String, value: &Bytes) {
    MetadataSet {
        agent_id,
        key: key.clone(),
        value: value.clone(),
    }
    .publish(e);
}
