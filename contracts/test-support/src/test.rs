//! The helpers are only worth anything if the host really checks what they
//! produce: each positive case has a twin the host refuses.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

use crate::{authorize, call, Account, Usdc};

const TEN_USDC: i128 = 100_000_000;

fn usdc_with_holder() -> (Env, Usdc, Account) {
    let env = Env::default();
    let usdc = Usdc::new(&env);
    let holder = usdc.holder(TEN_USDC);
    (env, usdc, holder)
}

#[test]
fn usdc_is_a_seven_decimal_asset_administered_by_its_issuer() {
    let (_env, usdc, holder) = usdc_with_holder();
    assert_eq!(usdc.token().decimals(), 7);
    assert_eq!(
        usdc.token().symbol(),
        soroban_sdk::String::from_str(&_env, "USDC")
    );
    assert_eq!(usdc.balance(&holder.address), TEN_USDC);
}

#[test]
fn a_signed_transfer_moves_the_balance() {
    let (env, usdc, holder) = usdc_with_holder();
    let to = Address::generate(&env);
    authorize(
        &env,
        &[holder.sign(&call(
            &env,
            &usdc.address,
            "transfer",
            (&holder.address, &to, 1i128),
        ))],
    );
    usdc.token().transfer(&holder.address, &to, &1);
    assert_eq!(usdc.balance(&to), 1);
    assert_eq!(usdc.balance(&holder.address), TEN_USDC - 1);
}

#[test]
fn a_transfer_signed_by_another_key_is_refused() {
    let (env, usdc, holder) = usdc_with_holder();
    let thief = Account::new(&env);
    let to = Address::generate(&env);
    authorize(
        &env,
        &[thief.sign(&call(
            &env,
            &usdc.address,
            "transfer",
            (&holder.address, &to, 1i128),
        ))],
    );
    assert!(usdc.token().try_transfer(&holder.address, &to, &1).is_err());
    assert_eq!(usdc.balance(&holder.address), TEN_USDC);
}

#[test]
fn a_signature_covers_only_the_arguments_it_signed() {
    let (env, usdc, holder) = usdc_with_holder();
    let to = Address::generate(&env);
    authorize(
        &env,
        &[holder.sign(&call(
            &env,
            &usdc.address,
            "transfer",
            (&holder.address, &to, 1i128),
        ))],
    );
    assert!(usdc.token().try_transfer(&holder.address, &to, &2).is_err());
    assert_eq!(usdc.balance(&to), 0);
}

#[test]
fn a_used_authorization_cannot_be_replayed() {
    let (env, usdc, holder) = usdc_with_holder();
    let to = Address::generate(&env);
    let entry = holder.sign(&call(
        &env,
        &usdc.address,
        "transfer",
        (&holder.address, &to, 1i128),
    ));
    authorize(&env, std::slice::from_ref(&entry));
    usdc.token().transfer(&holder.address, &to, &1);
    authorize(&env, &[entry]);
    assert!(usdc.token().try_transfer(&holder.address, &to, &1).is_err());
    assert_eq!(usdc.balance(&to), 1);
}

#[test]
fn an_account_without_a_trustline_cannot_receive_usdc() {
    let env = Env::default();
    let usdc = Usdc::new(&env);
    let stranger = Account::new(&env);
    authorize(
        &env,
        &[usdc.issuer.sign(&call(
            &env,
            &usdc.address,
            "mint",
            (&stranger.address, 1i128),
        ))],
    );
    let refused = soroban_sdk::token::StellarAssetClient::new(&env, &usdc.address)
        .try_mint(&stranger.address, &1);
    // TrustlineMissingError, the SAC's contract error #13.
    assert_eq!(
        refused.err().and_then(|e| e.ok()),
        Some(soroban_sdk::Error::from_contract_error(13))
    );
}

#[test]
fn only_the_issuer_can_mint() {
    let (env, usdc, holder) = usdc_with_holder();
    authorize(
        &env,
        &[holder.sign(&call(&env, &usdc.address, "mint", (&holder.address, 1i128)))],
    );
    let refused = soroban_sdk::token::StellarAssetClient::new(&env, &usdc.address)
        .try_mint(&holder.address, &1);
    assert!(refused.is_err());
    assert_eq!(usdc.balance(&holder.address), TEN_USDC);
}

#[cfg(feature = "registries")]
mod registries {
    use soroban_sdk::{BytesN, Env};

    use crate::{Account, Registries};

    #[test]
    fn the_registries_deploy_as_upstream_orders_them_and_register_a_signed_agent() {
        let env = Env::default();
        let registries = Registries::deploy(&env);
        assert_eq!(registries.reputation(&env).get_identity_registry(), registries.identity);
        assert_eq!(registries.validation(&env).get_identity_registry(), registries.identity);
        let provider = Account::new(&env);
        let agent = registries.register_agent(&env, &provider);
        assert_eq!(registries.identity(&env).owner_of(&agent), provider.address);
        assert_eq!(registries.identity(&env).find_owner(&agent), Some(provider.address.clone()));
        // A request names its validator; the hook is one, and here any address is.
        let validator = Account::new(&env);
        let request: BytesN<32> = env.crypto().sha256(&soroban_sdk::Bytes::from_slice(&env, b"square.test.validation-request")).into();
        registries.request_validation(&env, &provider, &validator.address, agent, "", &request);
        let status = registries.validation(&env).get_validation_status(&request);
        assert_eq!(status.validator_address, validator.address);
        assert_eq!(status.agent_id, agent);
    }

    #[test]
    fn a_stranger_cannot_register_for_someone_else() {
        let env = Env::default();
        let registries = Registries::deploy(&env);
        let owner = Account::new(&env);
        let stranger = Account::new(&env);
        crate::authorize(&env, &[stranger.sign(&crate::call(&env, &registries.identity, "register", (&owner.address,)))]);
        assert!(registries.identity(&env).try_register(&owner.address).is_err());
    }
}
