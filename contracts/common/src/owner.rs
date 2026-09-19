//! The owner of a contract: a small two-step owner, the `Ownable2Step` of the
//! EVM design (docs/decisions/upgradeability-and-governance.md, "Ownable for
//! #8"). The owner is set once from the constructor and stored in instance
//! storage. Ownership moves in two steps, an offer that expires at a ledger and
//! an acceptance by the offered address, so a typo in the new owner cannot
//! strand a contract. No `renounce_ownership` in the MVP.
//!
//! Every owner function of a contract reads the stored owner and calls
//! `require_auth()` on it through [`require_owner`]; the owner is never a
//! function argument.
//!
//! Error codes are 100–102 so that they never collide with a contract's own
//! codes: the SDK maps a simulation's `Error(Contract, #n)` to a name by the
//! number alone.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, Env};

/// Instance-storage keys. A contract's own `DataKey` must not reuse these
/// variant names (see the crate documentation).
#[contracttype]
#[derive(Clone)]
pub enum OwnerKey {
    Owner,
    PendingOwner,
}

/// An offer of ownership, open until `live_until_ledger` inclusive.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingOwner {
    pub owner: Address,
    pub live_until_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum OwnerError {
    /// `accept_ownership` with no offer open.
    NoPendingOffer = 100,
    /// The offer's ledger has passed: on `accept_ownership`, or on
    /// `transfer_ownership` with a `live_until_ledger` already behind.
    OfferExpired = 101,
    /// Ownership offered to the current owner.
    SameOwner = 102,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnershipOffered {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub live_until_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnershipTransferred {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
}

/// Sets the owner. Constructor only: it has no authorization check.
pub fn set_owner(env: &Env, owner: &Address) {
    env.storage().instance().set(&OwnerKey::Owner, owner);
}

/// The stored owner. Panics when no constructor set one, which is a deploy
/// error and not a runtime one.
pub fn owner(env: &Env) -> Address {
    env.storage().instance().get(&OwnerKey::Owner).unwrap()
}

/// The owner's `require_auth()`, and the owner.
pub fn require_owner(env: &Env) -> Address {
    let owner = owner(env);
    owner.require_auth();
    owner
}

/// The open offer, if any.
pub fn pending_owner(env: &Env) -> Option<PendingOwner> {
    env.storage().instance().get(&OwnerKey::PendingOwner)
}

/// Owner only. Offers ownership to `new_owner` until `live_until_ledger`
/// inclusive. A new offer replaces the open one.
pub fn transfer_ownership(
    env: &Env,
    new_owner: &Address,
    live_until_ledger: u32,
) -> Result<(), OwnerError> {
    let from = require_owner(env);
    if *new_owner == from {
        return Err(OwnerError::SameOwner);
    }
    if live_until_ledger < env.ledger().sequence() {
        return Err(OwnerError::OfferExpired);
    }
    env.storage().instance().set(
        &OwnerKey::PendingOwner,
        &PendingOwner {
            owner: new_owner.clone(),
            live_until_ledger,
        },
    );
    OwnershipOffered {
        from,
        to: new_owner.clone(),
        live_until_ledger,
    }
    .publish(env);
    Ok(())
}

/// The offered address, authorizing, takes ownership while the offer is open.
pub fn accept_ownership(env: &Env) -> Result<(), OwnerError> {
    let pending = pending_owner(env).ok_or(OwnerError::NoPendingOffer)?;
    pending.owner.require_auth();
    if env.ledger().sequence() > pending.live_until_ledger {
        return Err(OwnerError::OfferExpired);
    }
    let from = owner(env);
    env.storage()
        .instance()
        .set(&OwnerKey::Owner, &pending.owner);
    env.storage().instance().remove(&OwnerKey::PendingOwner);
    OwnershipTransferred {
        from,
        to: pending.owner,
    }
    .publish(env);
    Ok(())
}
