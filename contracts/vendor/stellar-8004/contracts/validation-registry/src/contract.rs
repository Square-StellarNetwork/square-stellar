use soroban_sdk::{contract, contractclient, contractimpl, Address, BytesN, Env, String, Vec};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::only_owner;

use crate::errors::ValidationError;
use crate::events;
use crate::storage;
use crate::types::{ValidationStatus, ValidationSummary};

// Cross-contract auth delegates to identity registry; share custody.
#[contractclient(name = "IdentityRegistryClient")]
pub trait IdentityRegistryInterface {
    fn find_owner(e: &Env, agent_id: u32) -> Option<Address>;
    fn agent_exists(e: &Env, agent_id: u32) -> bool;
    fn get_approved(e: &Env, token_id: u32) -> Option<Address>;
    fn is_approved_for_all(e: &Env, owner: Address, operator: Address) -> bool;
}

#[contract]
pub struct ValidationRegistryContract;

#[contractimpl]
impl ValidationRegistryContract {
    pub fn __constructor(e: &Env, owner: Address, identity_registry: Address) {
        ownable::set_owner(e, &owner);
        storage::set_identity_registry(e, &identity_registry);
    }

    pub fn validation_request(
        e: &Env,
        caller: Address,
        validator_address: Address,
        agent_id: u32,
        request_uri: String,
        request_hash: BytesN<32>,
    ) -> Result<(), ValidationError> {
        caller.require_auth();

        let identity_addr = storage::get_identity_registry(e);
        let identity = IdentityRegistryClient::new(e, &identity_addr);
        let owner = identity
            .find_owner(&agent_id)
            .ok_or(ValidationError::AgentNotFound)?;
        if caller != owner {
            let mut authorized = false;
            if let Some(approved) = identity.get_approved(&agent_id) {
                if caller == approved {
                    authorized = true;
                }
            }
            if !authorized && identity.is_approved_for_all(&owner, &caller) {
                authorized = true;
            }
            if !authorized {
                return Err(ValidationError::NotOwnerOrApproved);
            }
        }

        if storage::has_validation(e, &request_hash) {
            return Err(ValidationError::RequestAlreadyExists);
        }

        let status = ValidationStatus {
            validator_address: validator_address.clone(),
            agent_id,
            response: 0,
            response_hash: BytesN::from_array(e, &[0u8; 32]),
            tag: String::from_str(e, ""),
            last_update: e.ledger().sequence() as u64,
            has_response: false,
        };
        storage::set_validation(e, &request_hash, &status);
        storage::add_agent_validation(e, agent_id, &request_hash)?;
        storage::add_validator_request(e, &validator_address, &request_hash)?;

        events::validation_requested(e, &validator_address, agent_id, &request_hash, &request_uri);

        Ok(())
    }

    /// Responses are updateable (progressive validation); only original validator can update.
    pub fn validation_response(
        e: &Env,
        caller: Address,
        request_hash: BytesN<32>,
        response: u32,
        response_uri: String,
        response_hash: BytesN<32>,
        tag: String,
    ) -> Result<(), ValidationError> {
        caller.require_auth();

        if response > 100 {
            return Err(ValidationError::InvalidResponse);
        }

        let mut status =
            storage::get_validation(e, &request_hash).ok_or(ValidationError::RequestNotFound)?;

        if caller != status.validator_address {
            return Err(ValidationError::NotDesignatedValidator);
        }

        status.response = response;
        status.response_hash = response_hash.clone();
        status.tag = tag.clone();
        status.last_update = e.ledger().sequence() as u64;
        status.has_response = true;
        storage::set_validation(e, &request_hash, &status);

        events::validation_responded(
            e,
            &status.validator_address,
            status.agent_id,
            &request_hash,
            response,
            &response_uri,
            &response_hash,
            &tag,
        );

        Ok(())
    }

    // --- Read functions ---

    pub fn get_validation_status(
        e: &Env,
        request_hash: BytesN<32>,
    ) -> Result<ValidationStatus, ValidationError> {
        storage::get_validation(e, &request_hash).ok_or(ValidationError::RequestNotFound)
    }

    pub fn request_exists(e: &Env, request_hash: BytesN<32>) -> bool {
        storage::has_validation(e, &request_hash)
    }

    pub fn get_summary(
        e: &Env,
        agent_id: u32,
        validator_addresses: Vec<Address>,
        tag: String,
    ) -> ValidationSummary {
        let count = storage::get_agent_validation_count(e, agent_id);
        let mut total_response = 0u64;
        let mut match_count = 0u64;

        for i in 0..count {
            if let Some(hash) = storage::get_agent_validation_at(e, agent_id, i) {
                if let Some(status) = storage::get_validation(e, &hash) {
                    if !status.has_response {
                        continue;
                    }
                    if !validator_addresses.is_empty() {
                        let mut found = false;
                        for va in validator_addresses.iter() {
                            if va == status.validator_address {
                                found = true;
                                break;
                            }
                        }
                        if !found {
                            continue;
                        }
                    }
                    if !tag.is_empty() && status.tag != tag {
                        continue;
                    }
                    total_response += status.response as u64;
                    match_count += 1;
                }
            }
        }

        // Integer division (50 not 50.5); use raw responses for precision.
        ValidationSummary {
            count: match_count,
            average_response: if match_count > 0 {
                (total_response / match_count) as u32
            } else {
                0
            },
        }
    }

    pub fn get_agent_validations_paginated(
        e: &Env,
        agent_id: u32,
        start: u32,
        limit: u32,
    ) -> Vec<BytesN<32>> {
        storage::get_agent_validations_paginated(e, agent_id, start, limit)
    }

    pub fn get_validator_requests_paginated(
        e: &Env,
        validator_address: Address,
        start: u32,
        limit: u32,
    ) -> Vec<BytesN<32>> {
        storage::get_validator_requests_paginated(e, &validator_address, start, limit)
    }

    pub fn get_identity_registry(e: &Env) -> Address {
        storage::get_identity_registry(e)
    }

    // --- TTL ---

    pub fn extend_ttl(e: &Env) {
        storage::extend_instance_ttl(e);
    }

    // --- Timelocked upgrade ---

    #[only_owner]
    pub fn propose_upgrade(e: &Env, new_wasm_hash: BytesN<32>) -> Result<(), ValidationError> {
        if storage::get_pending_upgrade(e).is_some() {
            return Err(ValidationError::UpgradeAlreadyProposed);
        }
        storage::set_pending_upgrade(
            e,
            &storage::UpgradeProposal {
                wasm_hash: new_wasm_hash,
                proposed_at: e.ledger().sequence(),
            },
        );
        Ok(())
    }

    #[only_owner]
    pub fn cancel_upgrade(e: &Env) -> Result<(), ValidationError> {
        if storage::get_pending_upgrade(e).is_none() {
            return Err(ValidationError::NoUpgradeProposed);
        }
        storage::remove_pending_upgrade(e);
        Ok(())
    }

    #[only_owner]
    pub fn execute_upgrade(e: &Env) -> Result<(), ValidationError> {
        let proposal = storage::get_pending_upgrade(e).ok_or(ValidationError::NoUpgradeProposed)?;
        let elapsed = e.ledger().sequence().saturating_sub(proposal.proposed_at);
        if elapsed < storage::TIMELOCK_LEDGERS {
            return Err(ValidationError::TimelockNotExpired);
        }
        storage::remove_pending_upgrade(e);
        e.deployer()
            .update_current_contract_wasm(proposal.wasm_hash);
        Ok(())
    }

    pub fn pending_upgrade(e: &Env) -> Option<storage::UpgradeProposal> {
        storage::get_pending_upgrade(e)
    }

    pub fn version(e: &Env) -> String {
        String::from_str(e, "0.1.0")
    }
}

#[contractimpl(contracttrait)]
impl Ownable for ValidationRegistryContract {}
