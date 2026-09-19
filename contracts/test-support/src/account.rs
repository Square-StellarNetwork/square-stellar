//! Classic `G…` accounts with real ed25519 keys, and authorization entries
//! they sign. Nothing here bypasses the host's checks: an account exists as an
//! `AccountEntry` in the test ledger, `require_auth` verifies its signature
//! against that entry exactly as on the network, and a signature over the
//! wrong invocation, by the wrong key or replayed with a used nonce fails.
//!
//! ```ignore
//! let client = Account::new(&env);
//! authorize(&env, &[client.sign(&call(&env, &kernel, "fund", (&client.address, job_id, budget))
//!     .with(call(&env, &usdc.address, "transfer", (&client.address, &kernel, amount))))]);
//! kernel_client.fund(&client.address, &job_id, &budget);
//! ```

use core::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::rc::Rc;
use std::vec::Vec as StdVec;

use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};
use soroban_sdk::testutils::Ledger;
use soroban_sdk::xdr::{
    AccountEntry, AccountEntryExt, AccountId, Hash, HashIdPreimage,
    HashIdPreimageSorobanAuthorization, InvokeContractArgs, LedgerEntry, LedgerEntryData,
    LedgerEntryExt, LedgerKey, LedgerKeyAccount, Limits, PublicKey, ScAddress, ScMap, ScMapEntry,
    ScSymbol, ScVal, ScVec, SequenceNumber, SorobanAddressCredentials, SorobanAuthorizationEntry,
    SorobanAuthorizedFunction, SorobanAuthorizedInvocation, SorobanCredentials, Thresholds,
    Uint256, WriteXdr,
};
use soroban_sdk::{Address, Env, IntoVal, TryFromVal, Val, Vec};

static NEXT_KEY: AtomicU64 = AtomicU64::new(0);
static NEXT_NONCE: AtomicI64 = AtomicI64::new(1);

/// A classic account: an ed25519 key pair whose public key is the account id,
/// with an `AccountEntry` in the ledger (master key weight 1, thresholds 0),
/// the shape `createAccount` leaves on the network.
pub struct Account {
    env: Env,
    key: SigningKey,
    pub address: Address,
}

impl Account {
    /// Keys are derived from a process-wide counter through sha256, so every
    /// account a test run makes is distinct.
    pub fn new(env: &Env) -> Self {
        let n = NEXT_KEY.fetch_add(1, Ordering::Relaxed);
        let seed: [u8; 32] = Sha256::new()
            .chain_update(b"square.test-support.account")
            .chain_update(n.to_be_bytes())
            .finalize()
            .into();
        let key = SigningKey::from_bytes(&seed);
        let public = key.verifying_key().to_bytes();
        let account_id = AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(public)));
        let ledger_key = Rc::new(LedgerKey::Account(LedgerKeyAccount {
            account_id: account_id.clone(),
        }));
        let entry = Rc::new(LedgerEntry {
            last_modified_ledger_seq: 0,
            data: LedgerEntryData::Account(AccountEntry {
                account_id: account_id.clone(),
                balance: 0,
                seq_num: SequenceNumber(0),
                num_sub_entries: 0,
                inflation_dest: None,
                flags: 0,
                home_domain: Default::default(),
                thresholds: Thresholds([1, 0, 0, 0]),
                signers: Default::default(),
                ext: AccountEntryExt::V0,
            }),
            ext: LedgerEntryExt::V0,
        });
        env.host()
            .add_ledger_entry(&ledger_key, &entry, None)
            .expect("the account entry is written");
        let address = Address::try_from_val(env, &ScVal::Address(ScAddress::Account(account_id)))
            .expect("an account address");
        Account {
            env: env.clone(),
            key,
            address,
        }
    }

    pub fn account_id(&self) -> AccountId {
        AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
            self.key.verifying_key().to_bytes(),
        )))
    }

    /// One authorization entry for `invocation` and everything under it, signed
    /// with this account's key, valid for the ledgers the network keeps a
    /// temporary entry (the nonce) alive.
    pub fn sign(&self, invocation: &Invocation) -> SorobanAuthorizationEntry {
        let env = &self.env;
        let nonce = NEXT_NONCE.fetch_add(1, Ordering::Relaxed);
        let info = env.ledger().get();
        let signature_expiration_ledger = info.sequence_number + info.min_temp_entry_ttl - 1;
        let root = invocation.to_xdr(env);
        let preimage = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
            network_id: Hash(env.ledger().network_id().to_array()),
            nonce,
            signature_expiration_ledger,
            invocation: root.clone(),
        });
        let payload: [u8; 32] = Sha256::digest(
            preimage
                .to_xdr(Limits::none())
                .expect("the preimage encodes"),
        )
        .into();
        let signature = self.key.sign(&payload).to_bytes();
        let public = self.key.verifying_key().to_bytes();
        let entry = ScVal::Map(Some(ScMap(
            [
                ScMapEntry {
                    key: symbol("public_key"),
                    val: ScVal::Bytes(public.to_vec().try_into().expect("32 bytes")),
                },
                ScMapEntry {
                    key: symbol("signature"),
                    val: ScVal::Bytes(signature.to_vec().try_into().expect("64 bytes")),
                },
            ]
            .to_vec()
            .try_into()
            .expect("two entries"),
        )));
        SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: ScAddress::Account(self.account_id()),
                nonce,
                signature_expiration_ledger,
                signature: ScVal::Vec(Some(ScVec(
                    [entry].to_vec().try_into().expect("one signature"),
                ))),
            }),
            root_invocation: root,
        }
    }
}

fn symbol(s: &str) -> ScVal {
    ScVal::Symbol(ScSymbol(s.try_into().expect("a short symbol")))
}

/// A contract call a signer authorizes, with the calls under it that need
/// the same signer's authorization (a token `transfer` the contract makes on
/// the signer's behalf, for example).
#[derive(Clone)]
pub struct Invocation {
    contract: Address,
    function: StdVec<u8>,
    args: Vec<Val>,
    subs: StdVec<Invocation>,
}

/// `contract.function(args…)`, as the signer authorizes it.
pub fn call<A: IntoVal<Env, Vec<Val>>>(
    env: &Env,
    contract: &Address,
    function: &str,
    args: A,
) -> Invocation {
    Invocation {
        contract: contract.clone(),
        function: function.as_bytes().to_vec(),
        args: args.into_val(env),
        subs: StdVec::new(),
    }
}

impl Invocation {
    /// Adds a call made under this one that needs the same authorization.
    pub fn with(mut self, sub: Invocation) -> Self {
        self.subs.push(sub);
        self
    }

    fn to_xdr(&self, env: &Env) -> SorobanAuthorizedInvocation {
        let contract_address =
            match ScVal::try_from_val(env, &self.contract.to_val()).expect("an address") {
                ScVal::Address(address) => address,
                other => panic!("not an address: {other:?}"),
            };
        let args: StdVec<ScVal> = self
            .args
            .iter()
            .map(|v| ScVal::try_from_val(env, &v).expect("an argument"))
            .collect();
        SorobanAuthorizedInvocation {
            function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
                contract_address,
                function_name: ScSymbol(self.function.clone().try_into().expect("a function name")),
                args: args.try_into().expect("the arguments"),
            }),
            sub_invocations: self
                .subs
                .iter()
                .map(|s| s.to_xdr(env))
                .collect::<StdVec<_>>()
                .try_into()
                .expect("the calls under it"),
        }
    }
}

/// The authorization entries the next contract calls consume. Signatures are
/// verified in full; an entry is spent once its nonce is used.
pub fn authorize(env: &Env, entries: &[SorobanAuthorizationEntry]) {
    env.set_auths(entries);
}
