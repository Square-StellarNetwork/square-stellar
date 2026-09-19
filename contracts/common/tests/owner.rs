//! The two-step owner (docs/decisions/upgradeability-and-governance.md), with
//! the owner, the nominee and the stranger as real `G…` accounts whose
//! signatures the host verifies.

use soroban_sdk::testutils::{Events as _, Ledger};
use soroban_sdk::{contract, contractimpl, Address, Env, Event};
use square_common::owner::{
    self, OwnerError, OwnershipRenounced, OwnershipTransferCancelled, OwnershipTransferStarted,
    OwnershipTransferred, PendingOwner,
};
use square_test_support::{authorize, call, Account};

#[contract]
struct Owned;

#[contractimpl]
impl Owned {
    pub fn __constructor(env: Env, owner: Address) {
        owner::init(&env, &owner);
    }
    pub fn owner(env: Env) -> Option<Address> {
        owner::get(&env)
    }
    pub fn pending(env: Env) -> Option<PendingOwner> {
        owner::pending(&env)
    }
    pub fn owner_only(env: Env) -> Address {
        owner::require_owner(&env)
    }
    pub fn transfer_ownership(env: Env, new_owner: Address, live_until_ledger: u32) {
        owner::transfer_ownership(&env, &new_owner, live_until_ledger);
    }
    pub fn accept_ownership(env: Env) {
        owner::accept_ownership(&env);
    }
    pub fn renounce_ownership(env: Env) {
        owner::renounce_ownership(&env);
    }
}

fn owned(env: &Env) -> (OwnedClient<'_>, Account) {
    let owner = Account::new(env);
    let id = env.register(Owned, (owner.address.clone(),));
    (OwnedClient::new(env, &id), owner)
}

fn offer(env: &Env, c: &OwnedClient, owner: &Account, to: &Address, live_until: u32) {
    authorize(
        env,
        &[owner.sign(&call(
            env,
            &c.address,
            "transfer_ownership",
            (to, live_until),
        ))],
    );
    c.transfer_ownership(to, &live_until);
}

#[test]
fn the_constructor_sets_the_first_owner_and_says_so() {
    let env = Env::default();
    let (c, owner) = owned(&env);
    // `all()` holds the last invocation's events: read them before any other call.
    assert_eq!(
        env.events().all().filter_by_contract(&c.address),
        [OwnershipTransferred {
            previous_owner: None,
            new_owner: owner.address.clone()
        }
        .to_xdr(&env, &c.address)]
    );
    assert_eq!(c.owner(), Some(owner.address.clone()));
}

#[test]
fn only_the_stored_owner_passes_require_owner() {
    let env = Env::default();
    let (c, owner) = owned(&env);
    let stranger = Account::new(&env);
    authorize(
        &env,
        &[stranger.sign(&call(&env, &c.address, "owner_only", ()))],
    );
    assert!(
        c.try_owner_only().is_err(),
        "a stranger's valid signature is not the owner's"
    );
    // The positive twin: the owner's signature, and only the owner's.
    authorize(
        &env,
        &[owner.sign(&call(&env, &c.address, "owner_only", ()))],
    );
    assert_eq!(c.owner_only(), owner.address);
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, owner.address);
}

#[test]
fn a_non_owner_cannot_offer_ownership() {
    let env = Env::default();
    let (c, _owner) = owned(&env);
    let stranger = Account::new(&env);
    env.ledger().set_sequence_number(10);
    authorize(
        &env,
        &[stranger.sign(&call(
            &env,
            &c.address,
            "transfer_ownership",
            (&stranger.address, 50u32),
        ))],
    );
    assert!(c.try_transfer_ownership(&stranger.address, &50).is_err());
    assert_eq!(c.pending(), None);
}

#[test]
fn a_transfer_needs_the_nominee_to_accept_before_expiry() {
    let env = Env::default();
    let (c, owner) = owned(&env);
    let next = Account::new(&env);
    env.ledger().set_sequence_number(100);
    offer(&env, &c, &owner, &next.address, 110);
    assert_eq!(
        env.events().all().filter_by_contract(&c.address),
        [OwnershipTransferStarted {
            owner: owner.address.clone(),
            pending_owner: next.address.clone(),
            live_until_ledger: 110
        }
        .to_xdr(&env, &c.address)]
    );
    assert_eq!(
        c.owner(),
        Some(owner.address.clone()),
        "ownership moves only on accept"
    );
    assert_eq!(
        c.pending(),
        Some(PendingOwner {
            account: next.address.clone(),
            live_until_ledger: 110
        })
    );

    // Past the offer's last ledger, even the nominee's valid signature is too late.
    env.ledger().set_sequence_number(111);
    authorize(
        &env,
        &[next.sign(&call(&env, &c.address, "accept_ownership", ()))],
    );
    assert_eq!(
        c.try_accept_ownership(),
        Err(Ok(OwnerError::TransferExpired.into()))
    );

    // A stranger cannot accept an offer made to someone else.
    offer(&env, &c, &owner, &next.address, 120);
    let stranger = Account::new(&env);
    authorize(
        &env,
        &[stranger.sign(&call(&env, &c.address, "accept_ownership", ()))],
    );
    assert!(c.try_accept_ownership().is_err());

    authorize(
        &env,
        &[next.sign(&call(&env, &c.address, "accept_ownership", ()))],
    );
    c.accept_ownership();
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(
        auths[0].0, next.address,
        "the nominee authorized the accept"
    );
    assert_eq!(
        env.events().all().filter_by_contract(&c.address),
        [OwnershipTransferred {
            previous_owner: Some(owner.address.clone()),
            new_owner: next.address.clone()
        }
        .to_xdr(&env, &c.address)]
    );
    assert_eq!(c.owner(), Some(next.address.clone()));
    assert_eq!(c.pending(), None);
}

#[test]
fn a_zero_expiry_cancels_and_renounce_waits_for_no_pending_offer() {
    let env = Env::default();
    let (c, owner) = owned(&env);
    let next = Account::new(&env);
    env.ledger().set_sequence_number(10);

    authorize(
        &env,
        &[owner.sign(&call(
            &env,
            &c.address,
            "transfer_ownership",
            (&next.address, 0u32),
        ))],
    );
    assert_eq!(
        c.try_transfer_ownership(&next.address, &0),
        Err(Ok(OwnerError::NoPendingTransfer.into()))
    );
    authorize(
        &env,
        &[owner.sign(&call(
            &env,
            &c.address,
            "transfer_ownership",
            (&next.address, 9u32),
        ))],
    );
    assert_eq!(
        c.try_transfer_ownership(&next.address, &9),
        Err(Ok(OwnerError::ExpiryInPast.into()))
    );

    offer(&env, &c, &owner, &next.address, 20);
    authorize(
        &env,
        &[owner.sign(&call(&env, &c.address, "renounce_ownership", ()))],
    );
    assert_eq!(
        c.try_renounce_ownership(),
        Err(Ok(OwnerError::TransferInProgress.into()))
    );

    offer(&env, &c, &owner, &next.address, 0);
    assert_eq!(
        env.events().all().filter_by_contract(&c.address),
        [OwnershipTransferCancelled {
            owner: owner.address.clone()
        }
        .to_xdr(&env, &c.address)]
    );
    assert_eq!(c.pending(), None);

    authorize(
        &env,
        &[owner.sign(&call(&env, &c.address, "renounce_ownership", ()))],
    );
    c.renounce_ownership();
    assert_eq!(
        env.events().all().filter_by_contract(&c.address),
        [OwnershipRenounced {
            previous_owner: owner.address.clone()
        }
        .to_xdr(&env, &c.address)]
    );
    assert_eq!(c.owner(), None);
    authorize(
        &env,
        &[owner.sign(&call(&env, &c.address, "owner_only", ()))],
    );
    assert_eq!(c.try_owner_only(), Err(Ok(OwnerError::OwnerNotSet.into())));
}

#[test]
fn a_renounce_is_the_owners_alone() {
    let env = Env::default();
    let (c, owner) = owned(&env);
    let stranger = Account::new(&env);
    authorize(
        &env,
        &[stranger.sign(&call(&env, &c.address, "renounce_ownership", ()))],
    );
    assert!(c.try_renounce_ownership().is_err());
    assert_eq!(c.owner(), Some(owner.address));
}
