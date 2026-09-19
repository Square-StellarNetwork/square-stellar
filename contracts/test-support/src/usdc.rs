//! USDC as it exists on the network: a classic credit asset `USDC:<issuer>`
//! wrapped in the host's own Stellar Asset Contract, 7 decimals, with the
//! issuer as the contract's admin. Holders open their trustline through the
//! SAC's `trust` (CAP-0073) and the issuer mints with a signed `mint`, so
//! every balance here moved through the same code the network runs.

use soroban_sdk::testutils::Ledger;
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::xdr::{
    AccountEntry, AlphaNum4, Asset, AssetCode4, ContractExecutable, ContractIdPreimage,
    CreateContractArgs, HostFunction, LedgerEntryData, LedgerKey, LedgerKeyAccount,
};
use soroban_sdk::{Address, Env, TryFromVal};
use std::rc::Rc;

use crate::account::{authorize, call, Account};

pub struct Usdc {
    env: Env,
    pub issuer: Account,
    pub address: Address,
}

impl Usdc {
    pub fn new(env: &Env) -> Self {
        let issuer = Account::new(env);
        let asset = Asset::CreditAlphanum4(AlphaNum4 {
            asset_code: AssetCode4(*b"USDC"),
            issuer: issuer.account_id(),
        });
        let created = env
            .host()
            .invoke_function(HostFunction::CreateContract(CreateContractArgs {
                contract_id_preimage: ContractIdPreimage::Asset(asset),
                executable: ContractExecutable::StellarAsset,
            }))
            .expect("the Stellar Asset Contract is deployed");
        let address = Address::try_from_val(env, &created).expect("the contract's address");
        Usdc {
            env: env.clone(),
            issuer,
            address,
        }
    }

    pub fn token(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.address)
    }

    pub fn balance(&self, of: &Address) -> i128 {
        self.token().balance(of)
    }

    /// Opens `holder`'s USDC trustline through the SAC's `trust`, signed by
    /// the holder. The account first receives the XLM the network requires
    /// for one more subentry, as a wallet does before `changeTrust`.
    pub fn trust(&self, holder: &Account) {
        fund_reserve_for_one_more_subentry(&self.env, holder);
        authorize(
            &self.env,
            &[holder.sign(&call(&self.env, &self.address, "trust", (&holder.address,)))],
        );
        StellarAssetClient::new(&self.env, &self.address).trust(&holder.address);
    }

    /// The issuer signs `mint(to, amount)` and the SAC runs it. A `G…`
    /// holder needs its trustline first, as on the network.
    pub fn mint(&self, to: &Address, amount: i128) {
        authorize(
            &self.env,
            &[self
                .issuer
                .sign(&call(&self.env, &self.address, "mint", (to, amount)))],
        );
        StellarAssetClient::new(&self.env, &self.address).mint(to, &amount);
    }

    /// A funded holder: an account with a trustline and `amount` minted to it.
    pub fn holder(&self, amount: i128) -> Account {
        let holder = Account::new(&self.env);
        self.trust(&holder);
        if amount > 0 {
            self.mint(&holder.address, amount);
        }
        holder
    }
}

/// Raises the account's XLM to the minimum balance of one more subentry:
/// `(2 + num_sub_entries + 1) × base_reserve`, the reserve rule
/// docs/decisions/auth-and-token-flow.md cites.
fn fund_reserve_for_one_more_subentry(env: &Env, holder: &Account) {
    let key = Rc::new(LedgerKey::Account(LedgerKeyAccount {
        account_id: holder.account_id(),
    }));
    let (entry, live_until) = env
        .host()
        .get_ledger_entry(&key)
        .expect("readable")
        .expect("the account exists");
    let mut entry = (*entry).clone();
    let base_reserve = i64::from(env.ledger().get().base_reserve);
    if let LedgerEntryData::Account(AccountEntry {
        balance,
        num_sub_entries,
        ..
    }) = &mut entry.data
    {
        let needed = (2 + i64::from(*num_sub_entries) + 1) * base_reserve;
        if *balance < needed {
            *balance = needed;
        }
    }
    env.host()
        .add_ledger_entry(&key, &Rc::new(entry), live_until)
        .expect("the account is updated");
}
