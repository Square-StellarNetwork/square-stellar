use soroban_sdk::{contracttype, Address, Bytes, BytesN, Env, String, Vec};
use stellar_tokens::non_fungible::{
    NFTStorageKey, BALANCE_EXTEND_AMOUNT, BALANCE_TTL_THRESHOLD, OWNER_EXTEND_AMOUNT,
    OWNER_TTL_THRESHOLD,
};

/// Encodes Address into StrKey ASCII bytes (56 bytes).
pub fn address_to_strkey_bytes(e: &Env, addr: &Address) -> Bytes {
    let s = addr.to_string();
    let len = s.len() as usize;
    let mut buf = [0u8; 56];
    s.copy_into_slice(&mut buf[..len]);
    Bytes::from_slice(e, &buf[..len])
}

// TTL: 30d threshold, 60d bump at 5s/ledger. Duplicated across registries.
pub const TTL_THRESHOLD: u32 = 518_400;
pub const TTL_BUMP: u32 = 1_036_800;

pub const MAX_METADATA_KEY_LEN: u32 = 64;
pub const MAX_METADATA_VALUE_LEN: u32 = 4096;
pub const MAX_METADATA_KEYS: u32 = 100;

/// Non-panicking `owner_of` (safe for cross-contract calls).
pub fn find_owner(e: &Env, agent_id: u32) -> Option<Address> {
    e.storage()
        .persistent()
        .get::<_, Address>(&NFTStorageKey::Owner(agent_id))
}

// 3 days at 5s/ledger. Changing this requires an upgrade (which is itself timelocked).
pub const TIMELOCK_LEDGERS: u32 = 51_840;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    AgentUri(u32),
    Metadata(u32, String),
    AgentWallet(u32),
    MetadataKeys(u32),
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

pub fn extend_instance_ttl(e: &Env) {
    e.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
}

pub fn extend_agent_ttl(e: &Env, agent_id: u32) {
    let key = DataKey::AgentUri(agent_id);
    if e.storage().persistent().has(&key) {
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
    }
    let wallet_key = DataKey::AgentWallet(agent_id);
    if e.storage().persistent().has(&wallet_key) {
        e.storage()
            .persistent()
            .extend_ttl(&wallet_key, TTL_THRESHOLD, TTL_BUMP);
    }

    let keys_key = DataKey::MetadataKeys(agent_id);
    if let Some(keys) = e.storage().persistent().get::<_, Vec<String>>(&keys_key) {
        e.storage()
            .persistent()
            .extend_ttl(&keys_key, TTL_THRESHOLD, TTL_BUMP);
        for key in keys.iter() {
            let entry = DataKey::Metadata(agent_id, key);
            if e.storage().persistent().has(&entry) {
                e.storage()
                    .persistent()
                    .extend_ttl(&entry, TTL_THRESHOLD, TTL_BUMP);
            }
        }
    }

    // OZ Owner/Balance entries also need bumping to prevent archival.
    let owner_key = NFTStorageKey::Owner(agent_id);
    if let Some(owner) = e.storage().persistent().get::<_, Address>(&owner_key) {
        e.storage()
            .persistent()
            .extend_ttl(&owner_key, OWNER_TTL_THRESHOLD, OWNER_EXTEND_AMOUNT);
        let balance_key = NFTStorageKey::Balance(owner);
        if e.storage().persistent().has(&balance_key) {
            e.storage().persistent().extend_ttl(
                &balance_key,
                BALANCE_TTL_THRESHOLD,
                BALANCE_EXTEND_AMOUNT,
            );
        }
    }
}

// --- Agent URI ---

pub fn set_agent_uri(e: &Env, agent_id: u32, uri: &String) {
    let key = DataKey::AgentUri(agent_id);
    e.storage().persistent().set(&key, uri);
    e.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
}

pub fn get_agent_uri(e: &Env, agent_id: u32) -> Option<String> {
    let key = DataKey::AgentUri(agent_id);
    let value = e.storage().persistent().get(&key);
    if value.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
    }
    value
}

// --- Agent Metadata ---

fn record_metadata_key(e: &Env, agent_id: u32, key: &String) -> bool {
    let keys_key = DataKey::MetadataKeys(agent_id);
    let mut keys: Vec<String> = e
        .storage()
        .persistent()
        .get(&keys_key)
        .unwrap_or_else(|| Vec::new(e));

    for existing in keys.iter() {
        if existing == *key {
            return false;
        }
    }

    keys.push_back(key.clone());
    e.storage().persistent().set(&keys_key, &keys);
    e.storage()
        .persistent()
        .extend_ttl(&keys_key, TTL_THRESHOLD, TTL_BUMP);
    true
}

pub fn metadata_key_count(e: &Env, agent_id: u32) -> u32 {
    e.storage()
        .persistent()
        .get::<_, Vec<String>>(&DataKey::MetadataKeys(agent_id))
        .map(|keys| keys.len())
        .unwrap_or(0)
}

pub fn set_metadata(e: &Env, agent_id: u32, key: &String, value: &Bytes) {
    record_metadata_key(e, agent_id, key);
    let entry = DataKey::Metadata(agent_id, key.clone());
    e.storage().persistent().set(&entry, value);
    e.storage()
        .persistent()
        .extend_ttl(&entry, TTL_THRESHOLD, TTL_BUMP);
}

pub fn get_metadata(e: &Env, agent_id: u32, key: &String) -> Option<Bytes> {
    let entry = DataKey::Metadata(agent_id, key.clone());
    let value = e.storage().persistent().get(&entry);
    if value.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&entry, TTL_THRESHOLD, TTL_BUMP);
    }
    value
}

pub fn clear_all_metadata(e: &Env, agent_id: u32) {
    let keys_key = DataKey::MetadataKeys(agent_id);
    if let Some(keys) = e.storage().persistent().get::<_, Vec<String>>(&keys_key) {
        for key in keys.iter() {
            e.storage()
                .persistent()
                .remove(&DataKey::Metadata(agent_id, key));
        }
        e.storage().persistent().remove(&keys_key);
    }
}

// --- Agent Wallet ---

pub fn set_agent_wallet(e: &Env, agent_id: u32, wallet: &Address) {
    let key = DataKey::AgentWallet(agent_id);
    e.storage().persistent().set(&key, wallet);
    e.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
}

pub fn get_agent_wallet(e: &Env, agent_id: u32) -> Option<Address> {
    let key = DataKey::AgentWallet(agent_id);
    let value = e.storage().persistent().get(&key);
    if value.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
    }
    value
}

pub fn remove_agent_wallet(e: &Env, agent_id: u32) {
    e.storage()
        .persistent()
        .remove(&DataKey::AgentWallet(agent_id));
}
