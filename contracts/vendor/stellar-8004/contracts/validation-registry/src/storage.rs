use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

use crate::errors::ValidationError;
use crate::types::ValidationStatus;

pub const TTL_THRESHOLD: u32 = 518_400;
pub const TTL_BUMP: u32 = 1_036_800;
pub const TIMELOCK_LEDGERS: u32 = 51_840;

pub fn extend_instance_ttl(e: &Env) {
    e.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    IdentityRegistry,
    Validation(BytesN<32>),
    AgentValidationCount(u32),
    AgentValidationAt(u32, u32),
    ValidatorRequestCount(Address),
    ValidatorRequestAt(Address, u32),
    PendingUpgrade,
}

#[contracttype]
#[derive(Clone)]
pub struct UpgradeProposal {
    pub wasm_hash: BytesN<32>,
    pub proposed_at: u32,
}

pub fn set_pending_upgrade(e: &Env, proposal: &UpgradeProposal) {
    e.storage()
        .instance()
        .set(&DataKey::PendingUpgrade, proposal);
}

pub fn get_pending_upgrade(e: &Env) -> Option<UpgradeProposal> {
    e.storage().instance().get(&DataKey::PendingUpgrade)
}

pub fn remove_pending_upgrade(e: &Env) {
    e.storage().instance().remove(&DataKey::PendingUpgrade);
}

// --- Identity Registry ---

pub fn set_identity_registry(e: &Env, addr: &Address) {
    e.storage().instance().set(&DataKey::IdentityRegistry, addr);
}

pub fn get_identity_registry(e: &Env) -> Address {
    e.storage()
        .instance()
        .get(&DataKey::IdentityRegistry)
        .expect("identity registry not set")
}

// --- Validation ---

pub fn has_validation(e: &Env, request_hash: &BytesN<32>) -> bool {
    let key = DataKey::Validation(request_hash.clone());
    if e.storage().persistent().has(&key) {
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
        true
    } else {
        false
    }
}

pub fn set_validation(e: &Env, request_hash: &BytesN<32>, status: &ValidationStatus) {
    let key = DataKey::Validation(request_hash.clone());
    e.storage().persistent().set(&key, status);
    e.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
}

pub fn get_validation(e: &Env, request_hash: &BytesN<32>) -> Option<ValidationStatus> {
    let key = DataKey::Validation(request_hash.clone());
    let status = e.storage().persistent().get(&key);
    if status.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
    }
    status
}

// --- Agent Validations (indexed) ---

pub fn get_agent_validation_count(e: &Env, agent_id: u32) -> u32 {
    let key = DataKey::AgentValidationCount(agent_id);
    if let Some(count) = e.storage().persistent().get::<_, u32>(&key) {
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
        count
    } else {
        0
    }
}

pub fn add_agent_validation(
    e: &Env,
    agent_id: u32,
    request_hash: &BytesN<32>,
) -> Result<(), ValidationError> {
    let count = get_agent_validation_count(e, agent_id);
    let next = count
        .checked_add(1)
        .ok_or(ValidationError::CounterOverflow)?;

    let at_key = DataKey::AgentValidationAt(agent_id, count);
    e.storage().persistent().set(&at_key, request_hash);
    e.storage()
        .persistent()
        .extend_ttl(&at_key, TTL_THRESHOLD, TTL_BUMP);

    let count_key = DataKey::AgentValidationCount(agent_id);
    e.storage().persistent().set(&count_key, &next);
    e.storage()
        .persistent()
        .extend_ttl(&count_key, TTL_THRESHOLD, TTL_BUMP);
    Ok(())
}

pub fn get_agent_validation_at(e: &Env, agent_id: u32, index: u32) -> Option<BytesN<32>> {
    let key = DataKey::AgentValidationAt(agent_id, index);
    let hash = e.storage().persistent().get(&key);
    if hash.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
    }
    hash
}

pub fn get_agent_validations_paginated(
    e: &Env,
    agent_id: u32,
    start: u32,
    limit: u32,
) -> Vec<BytesN<32>> {
    let count = get_agent_validation_count(e, agent_id);
    let mut result = Vec::new(e);
    let end = core::cmp::min(start.saturating_add(limit), count);
    for i in start..end {
        if let Some(hash) = get_agent_validation_at(e, agent_id, i) {
            result.push_back(hash);
        }
    }
    result
}

// --- Validator Requests (indexed) ---

fn get_validator_request_count(e: &Env, validator: &Address) -> u32 {
    let key = DataKey::ValidatorRequestCount(validator.clone());
    if let Some(count) = e.storage().persistent().get::<_, u32>(&key) {
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
        count
    } else {
        0
    }
}

pub fn add_validator_request(
    e: &Env,
    validator: &Address,
    request_hash: &BytesN<32>,
) -> Result<(), ValidationError> {
    let count = get_validator_request_count(e, validator);
    let next = count
        .checked_add(1)
        .ok_or(ValidationError::CounterOverflow)?;

    let at_key = DataKey::ValidatorRequestAt(validator.clone(), count);
    e.storage().persistent().set(&at_key, request_hash);
    e.storage()
        .persistent()
        .extend_ttl(&at_key, TTL_THRESHOLD, TTL_BUMP);

    let count_key = DataKey::ValidatorRequestCount(validator.clone());
    e.storage().persistent().set(&count_key, &next);
    e.storage()
        .persistent()
        .extend_ttl(&count_key, TTL_THRESHOLD, TTL_BUMP);
    Ok(())
}

pub fn get_validator_requests_paginated(
    e: &Env,
    validator: &Address,
    start: u32,
    limit: u32,
) -> Vec<BytesN<32>> {
    let count = get_validator_request_count(e, validator);
    let mut result = Vec::new(e);
    let end = core::cmp::min(start.saturating_add(limit), count);
    for i in start..end {
        let key = DataKey::ValidatorRequestAt(validator.clone(), i);
        if let Some(hash) = e.storage().persistent().get::<_, BytesN<32>>(&key) {
            e.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
            result.push_back(hash);
        }
    }
    result
}
