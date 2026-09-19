//! A two-step owner (docs/decisions/upgradeability-and-governance.md, #49). It
//! follows OpenZeppelin `stellar-access::ownable`'s semantics, which cannot be
//! linked against this workspace's `soroban-sdk` (docs/upstream/foundry-to-soroban.md).
//!
//! The owner and a pending offer live in instance storage under `Symbol` keys,
//! which cannot collide with a contract's `#[contracttype]` enum keys (those
//! encode as a vector). There is no upgrade helper here, by design.

use soroban_sdk::{
    contracterror, contractevent, contracttype, panic_with_error, symbol_short, Address, Env,
    Symbol,
};

const OWNER: Symbol = symbol_short!("owner");
const PENDING: Symbol = symbol_short!("pending");

/// Shared by every contract with an owner. Codes 900+ so they never meet a
/// contract's own codes.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum OwnerError {
    OwnerNotSet = 900,
    OwnerAlreadySet = 901,
    NoPendingTransfer = 902,
    TransferExpired = 903,
    TransferInProgress = 904,
    RenounceDisabled = 905,
    ExpiryInPast = 906,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingOwner {
    pub account: Address,
    pub live_until_ledger: u32,
}

/// The owner offered ownership; nothing changes until `accept_ownership`.
#[contractevent]
pub struct OwnershipTransferStarted {
    #[topic]
    pub owner: Address,
    #[topic]
    pub pending_owner: Address,
    pub live_until_ledger: u32,
}

/// The owner withdrew a pending offer.
#[contractevent]
pub struct OwnershipTransferCancelled {
    #[topic]
    pub owner: Address,
}

/// The pending owner accepted, or the constructor set the first owner
/// (`previous_owner` is `None`).
#[contractevent]
pub struct OwnershipTransferred {
    #[topic]
    pub previous_owner: Option<Address>,
    #[topic]
    pub new_owner: Address,
}

/// The owner renounced; the contract has no owner from here on.
#[contractevent]
pub struct OwnershipRenounced {
    #[topic]
    pub previous_owner: Address,
}

/// Set once, from `__constructor`. No authorization: the constructor runs once.
pub fn init(env: &Env, owner: &Address) {
    if env.storage().instance().has(&OWNER) {
        panic_with_error!(env, OwnerError::OwnerAlreadySet);
    }
    env.storage().instance().set(&OWNER, owner);
    OwnershipTransferred {
        previous_owner: None,
        new_owner: owner.clone(),
    }
    .publish(env);
}

pub fn get(env: &Env) -> Option<Address> {
    env.storage().instance().get(&OWNER)
}

pub fn pending(env: &Env) -> Option<PendingOwner> {
    env.storage().instance().get(&PENDING)
}

/// The stored owner, authorized. Every owner function starts here.
pub fn require_owner(env: &Env) -> Address {
    let owner = get(env).unwrap_or_else(|| panic_with_error!(env, OwnerError::OwnerNotSet));
    owner.require_auth();
    owner
}

/// Offer ownership to `new_owner` until `live_until_ledger`; 0 cancels a pending offer.
pub fn transfer_ownership(env: &Env, new_owner: &Address, live_until_ledger: u32) {
    let owner = require_owner(env);
    if live_until_ledger == 0 {
        if env.storage().instance().has(&PENDING) {
            env.storage().instance().remove(&PENDING);
            OwnershipTransferCancelled { owner }.publish(env);
            return;
        }
        panic_with_error!(env, OwnerError::NoPendingTransfer);
    }
    if live_until_ledger < env.ledger().sequence() {
        panic_with_error!(env, OwnerError::ExpiryInPast);
    }
    env.storage().instance().set(
        &PENDING,
        &PendingOwner {
            account: new_owner.clone(),
            live_until_ledger,
        },
    );
    OwnershipTransferStarted {
        owner,
        pending_owner: new_owner.clone(),
        live_until_ledger,
    }
    .publish(env);
}

/// The pending owner accepts, up to `live_until_ledger`.
pub fn accept_ownership(env: &Env) {
    let offer =
        pending(env).unwrap_or_else(|| panic_with_error!(env, OwnerError::NoPendingTransfer));
    if env.ledger().sequence() > offer.live_until_ledger {
        panic_with_error!(env, OwnerError::TransferExpired);
    }
    offer.account.require_auth();
    let previous = get(env).unwrap_or_else(|| panic_with_error!(env, OwnerError::OwnerNotSet));
    env.storage().instance().set(&OWNER, &offer.account);
    env.storage().instance().remove(&PENDING);
    OwnershipTransferred {
        previous_owner: Some(previous),
        new_owner: offer.account,
    }
    .publish(env);
}

/// Exported only by contracts whose owner table says "enabled". Refused while
/// a transfer is pending, as OpenZeppelin's is.
pub fn renounce_ownership(env: &Env) {
    let owner = require_owner(env);
    if env.storage().instance().has(&PENDING) {
        panic_with_error!(env, OwnerError::TransferInProgress);
    }
    env.storage().instance().remove(&OWNER);
    OwnershipRenounced {
        previous_owner: owner,
    }
    .publish(env);
}
