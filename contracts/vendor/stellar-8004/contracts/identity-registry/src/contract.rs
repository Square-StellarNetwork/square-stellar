use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, String, Vec};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::only_owner;
use stellar_tokens::non_fungible::{Base, ContractOverrides, NonFungibleToken};

use crate::errors::IdentityError;
use crate::events;
use crate::storage::{
    self, address_to_strkey_bytes, MAX_METADATA_KEYS, MAX_METADATA_KEY_LEN, MAX_METADATA_VALUE_LEN,
};
use crate::types::MetadataEntry;

fn agent_wallet_key(e: &Env) -> String {
    String::from_str(e, "agentWallet")
}

// Clears wallet and metadata on transfer to prevent claim inheritance.
pub struct IdentityBase;

impl ContractOverrides for IdentityBase {
    fn transfer(e: &Env, from: &Address, to: &Address, token_id: u32) {
        storage::remove_agent_wallet(e, token_id);
        storage::clear_all_metadata(e, token_id);
        events::metadata_set(e, token_id, &agent_wallet_key(e), &Bytes::new(e));
        Base::transfer(e, from, to, token_id);
    }

    fn transfer_from(e: &Env, spender: &Address, from: &Address, to: &Address, token_id: u32) {
        storage::remove_agent_wallet(e, token_id);
        storage::clear_all_metadata(e, token_id);
        events::metadata_set(e, token_id, &agent_wallet_key(e), &Bytes::new(e));
        Base::transfer_from(e, spender, from, to, token_id);
    }

    /// Returns per-agent URI instead of OZ default empty string.
    /// Panics on missing token per NFT spec.
    fn token_uri(e: &Env, token_id: u32) -> String {
        let _ = Base::owner_of(e, token_id);
        storage::get_agent_uri(e, token_id).unwrap_or_else(|| String::from_str(e, ""))
    }
}

#[contract]
pub struct IdentityRegistryContract;

#[contractimpl]
impl IdentityRegistryContract {
    pub fn __constructor(e: &Env, owner: Address, name: String, symbol: String) {
        Base::set_metadata(e, String::from_str(e, ""), name, symbol);
        ownable::set_owner(e, &owner);
    }

    // --- Registration ---

    pub fn register(e: &Env, caller: Address) -> u32 {
        caller.require_auth();
        let agent_id = Base::sequential_mint(e, &caller);
        Self::init_agent_wallet(e, agent_id, &caller);
        events::registered(e, agent_id, &caller, &String::from_str(e, ""));
        agent_id
    }

    pub fn register_with_uri(e: &Env, caller: Address, agent_uri: String) -> u32 {
        caller.require_auth();
        let agent_id = Base::sequential_mint(e, &caller);
        storage::set_agent_uri(e, agent_id, &agent_uri);
        Self::init_agent_wallet(e, agent_id, &caller);
        events::registered(e, agent_id, &caller, &agent_uri);
        agent_id
    }

    pub fn register_full(
        e: &Env,
        caller: Address,
        agent_uri: String,
        metadata: Vec<MetadataEntry>,
    ) -> u32 {
        caller.require_auth();
        // Panics on invalid input (returns u32, not Result).
        let reserved_wallet_key = agent_wallet_key(e);
        assert!(
            metadata.len() <= MAX_METADATA_KEYS,
            "too many metadata entries"
        );
        for entry in metadata.iter() {
            assert!(
                entry.key.len() <= MAX_METADATA_KEY_LEN,
                "metadata key too long"
            );
            assert!(
                entry.value.len() <= MAX_METADATA_VALUE_LEN,
                "metadata value too long"
            );
            assert!(
                entry.key != reserved_wallet_key,
                "agentWallet is a reserved metadata key - use set_agent_wallet"
            );
        }
        let agent_id = Base::sequential_mint(e, &caller);
        storage::set_agent_uri(e, agent_id, &agent_uri);
        Self::init_agent_wallet(e, agent_id, &caller);
        for entry in metadata.iter() {
            storage::set_metadata(e, agent_id, &entry.key, &entry.value);
            events::metadata_set(e, agent_id, &entry.key, &entry.value);
        }
        events::registered(e, agent_id, &caller, &agent_uri);
        agent_id
    }

    fn init_agent_wallet(e: &Env, agent_id: u32, owner: &Address) {
        storage::set_agent_wallet(e, agent_id, owner);
        let bytes = address_to_strkey_bytes(e, owner);
        events::metadata_set(e, agent_id, &agent_wallet_key(e), &bytes);
    }

    // --- URI ---

    pub fn set_agent_uri(
        e: &Env,
        caller: Address,
        agent_id: u32,
        new_uri: String,
    ) -> Result<(), IdentityError> {
        caller.require_auth();
        if new_uri.is_empty() {
            return Err(IdentityError::EmptyValue);
        }
        Self::require_owner_or_approved(e, &caller, agent_id)?;
        storage::set_agent_uri(e, agent_id, &new_uri);
        events::uri_updated(e, agent_id, &caller, &new_uri);
        Ok(())
    }

    pub fn agent_uri(e: &Env, agent_id: u32) -> Result<String, IdentityError> {
        storage::get_agent_uri(e, agent_id).ok_or(IdentityError::UriNotSet)
    }

    // --- Metadata ---

    pub fn set_metadata(
        e: &Env,
        caller: Address,
        agent_id: u32,
        key: String,
        value: Bytes,
    ) -> Result<(), IdentityError> {
        caller.require_auth();
        if key.is_empty() {
            return Err(IdentityError::EmptyValue);
        }
        if key.len() > MAX_METADATA_KEY_LEN {
            return Err(IdentityError::MetadataKeyTooLong);
        }
        if value.len() > MAX_METADATA_VALUE_LEN {
            return Err(IdentityError::MetadataValueTooLong);
        }
        if key == agent_wallet_key(e) {
            return Err(IdentityError::ReservedMetadataKey);
        }
        Self::require_owner_or_approved(e, &caller, agent_id)?;
        let existing_value = storage::get_metadata(e, agent_id, &key);
        if existing_value.is_none() && storage::metadata_key_count(e, agent_id) >= MAX_METADATA_KEYS
        {
            return Err(IdentityError::TooManyMetadataKeys);
        }
        storage::set_metadata(e, agent_id, &key, &value);
        events::metadata_set(e, agent_id, &key, &value);
        Ok(())
    }

    /// Routes `agentWallet` key to the dedicated wallet storage slot.
    pub fn get_metadata(e: &Env, agent_id: u32, key: String) -> Option<Bytes> {
        if key == agent_wallet_key(e) {
            return storage::get_agent_wallet(e, agent_id)
                .map(|addr| address_to_strkey_bytes(e, &addr));
        }
        storage::get_metadata(e, agent_id, &key)
    }

    // --- Agent Wallet ---

    pub fn set_agent_wallet(
        e: &Env,
        caller: Address,
        agent_id: u32,
        new_wallet: Address,
    ) -> Result<(), IdentityError> {
        caller.require_auth();
        new_wallet.require_auth();
        Self::require_owner_or_approved(e, &caller, agent_id)?;
        storage::set_agent_wallet(e, agent_id, &new_wallet);
        let bytes = address_to_strkey_bytes(e, &new_wallet);
        events::metadata_set(e, agent_id, &agent_wallet_key(e), &bytes);
        Ok(())
    }

    pub fn get_agent_wallet(e: &Env, agent_id: u32) -> Option<Address> {
        storage::get_agent_wallet(e, agent_id)
    }

    pub fn unset_agent_wallet(
        e: &Env,
        caller: Address,
        agent_id: u32,
    ) -> Result<(), IdentityError> {
        caller.require_auth();
        Self::require_owner_or_approved(e, &caller, agent_id)?;
        storage::remove_agent_wallet(e, agent_id);
        events::metadata_set(e, agent_id, &agent_wallet_key(e), &Bytes::new(e));
        Ok(())
    }

    // --- TTL ---

    pub fn extend_ttl(e: &Env, agent_id: u32) {
        storage::extend_instance_ttl(e);
        storage::extend_agent_ttl(e, agent_id);
    }

    // --- Timelocked upgrade ---

    #[only_owner]
    pub fn propose_upgrade(e: &Env, new_wasm_hash: BytesN<32>) -> Result<(), IdentityError> {
        if storage::get_pending_upgrade(e).is_some() {
            return Err(IdentityError::UpgradeAlreadyProposed);
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
    pub fn cancel_upgrade(e: &Env) -> Result<(), IdentityError> {
        if storage::get_pending_upgrade(e).is_none() {
            return Err(IdentityError::NoUpgradeProposed);
        }
        storage::remove_pending_upgrade(e);
        Ok(())
    }

    #[only_owner]
    pub fn execute_upgrade(e: &Env) -> Result<(), IdentityError> {
        let proposal = storage::get_pending_upgrade(e).ok_or(IdentityError::NoUpgradeProposed)?;
        let elapsed = e.ledger().sequence().saturating_sub(proposal.proposed_at);
        if elapsed < storage::TIMELOCK_LEDGERS {
            return Err(IdentityError::TimelockNotExpired);
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

    /// Non-panicking `owner_of` (safe for cross-contract calls).
    pub fn find_owner(e: &Env, agent_id: u32) -> Option<Address> {
        storage::find_owner(e, agent_id)
    }

    pub fn agent_exists(e: &Env, agent_id: u32) -> bool {
        storage::find_owner(e, agent_id).is_some()
    }

    /// Returns true if spender is owner or approved. False if agent missing.
    pub fn is_authorized_or_owner(e: &Env, spender: Address, agent_id: u32) -> bool {
        let owner = match storage::find_owner(e, agent_id) {
            Some(o) => o,
            None => return false,
        };
        if spender == owner {
            return true;
        }
        if let Some(approved) = Base::get_approved(e, agent_id) {
            if spender == approved {
                return true;
            }
        }
        Base::is_approved_for_all(e, &owner, &spender)
    }

    pub fn total_agents(e: &Env) -> u32 {
        stellar_tokens::non_fungible::sequential::next_token_id(e)
    }

    // --- Internal ---

    fn require_owner_or_approved(
        e: &Env,
        caller: &Address,
        agent_id: u32,
    ) -> Result<(), IdentityError> {
        let owner = storage::find_owner(e, agent_id).ok_or(IdentityError::AgentNotFound)?;
        if *caller == owner {
            return Ok(());
        }
        if let Some(approved) = Base::get_approved(e, agent_id) {
            if *caller == approved {
                return Ok(());
            }
        }
        if Base::is_approved_for_all(e, &owner, caller) {
            return Ok(());
        }
        Err(IdentityError::NotOwnerOrApproved)
    }
}

#[contractimpl(contracttrait)]
impl NonFungibleToken for IdentityRegistryContract {
    type ContractType = IdentityBase;
}

#[contractimpl(contracttrait)]
impl Ownable for IdentityRegistryContract {}
