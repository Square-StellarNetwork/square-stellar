//! The kernel against a Stellar Asset Contract in soroban-sdk's test host: the
//! optimistic path, the reject and refund paths, expiry, unauthorized and
//! unsigned calls, double funding and double withdrawal, the fee, ownership,
//! TTL, and the solvency invariant under random action sequences.

extern crate std;

use super::*;
use soroban_sdk::testutils::{
    storage::{Instance as _, Persistent as _},
    Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
};
use soroban_sdk::{Event as _, IntoVal};
use square_common::owner::{OwnerError, OwnershipTransferred, PendingOwner};
use std::vec::Vec as StdVec;

/// 2026-09-19T00:00:00Z, so the timestamps look like the network's.
const T0: u64 = 1_789_776_000;
/// Ten minutes, the testnet deployment's window.
const WINDOW: u64 = 600;
/// 2.5 %.
const FEE_BPS: u32 = 250;
/// Testnet's values, docs/decisions/fees-and-ttl.md.
const CLOSE_MS: u32 = 5_000;
const MIN_TTL: u32 = 120_960;
const DAY: u64 = 86_400;
/// 50 tokens at 7 decimals; MINT is 1,000.
const BUDGET: i128 = 50 * 10_000_000;
const MINT: i128 = 1_000 * 10_000_000;

struct Stack<'a> {
    env: &'a Env,
    kernel: SquareJobClient<'a>,
    kernel_id: Address,
    token: token::Client<'a>,
    owner: Address,
    client: Address,
    provider: Address,
}

fn setup_with(env: &Env, window: u64, fee_bps: u32) -> Stack<'_> {
    env.mock_all_auths();
    env.ledger().set_timestamp(T0);
    env.ledger().set_sequence_number(1_000);
    let admin = Address::generate(env);
    let owner = Address::generate(env);
    let client = Address::generate(env);
    let provider = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    token::StellarAssetClient::new(env, &sac.address()).mint(&client, &MINT);
    let kernel_id = env.register(
        SquareJob,
        (
            &owner,
            &sac.address(),
            &window,
            &fee_bps,
            &CLOSE_MS,
            &MIN_TTL,
        ),
    );
    Stack {
        env,
        kernel: SquareJobClient::new(env, &kernel_id),
        kernel_id,
        token: token::Client::new(env, &sac.address()),
        owner,
        client,
        provider,
    }
}

fn setup(env: &Env) -> Stack<'_> {
    setup_with(env, WINDOW, FEE_BPS)
}

fn text(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn advance(env: &Env, seconds: u64) {
    env.ledger().with_mut(|l| {
        l.timestamp += seconds;
        l.sequence_number += u32::try_from(seconds / 5).unwrap();
    });
}

impl Stack<'_> {
    fn open_job(&self) -> u64 {
        let id = self.kernel.create_job(
            &self.client,
            &self.provider,
            &(T0 + DAY),
            &text(self.env, "summarise the quarterly report"),
        );
        self.kernel.set_budget(&self.provider, &id, &BUDGET);
        id
    }

    fn funded_job(&self) -> u64 {
        let id = self.open_job();
        self.kernel.fund(&self.client, &id, &BUDGET);
        id
    }

    fn submitted_job(&self) -> u64 {
        let id = self.funded_job();
        self.kernel.submit(&self.provider, &id, &hash(self.env, 7));
        id
    }

    fn status(&self, id: u64) -> JobStatus {
        self.kernel.get_job(&id).status
    }

    /// The event of the write just made. The test host keeps only the last
    /// invocation's events, so this is read before any view or token call.
    fn last_event(&self) -> soroban_sdk::xdr::ContractEvent {
        self.env
            .events()
            .all()
            .filter_by_contract(&self.kernel_id)
            .events()
            .last()
            .unwrap()
            .clone()
    }

    /// The kernel's token balance is exactly the two totals: nothing is lost,
    /// nothing is promised twice.
    fn assert_solvent(&self) {
        let balance = self.token.balance(&self.kernel_id);
        let escrowed = i128::from(self.kernel.total_escrowed());
        let withdrawable = i128::from(self.kernel.total_withdrawable());
        assert_eq!(
            balance,
            escrowed + withdrawable,
            "balance {balance} vs escrowed {escrowed} + withdrawable {withdrawable}"
        );
    }
}

// ---- construction ----------------------------------------------------------

#[test]
fn constructor_stores_the_settings() {
    let env = Env::default();
    let s = setup(&env);
    assert_eq!(
        s.kernel.config(),
        Config {
            token: s.token.address.clone(),
            challenge_window: WINDOW,
            platform_fee_bps: FEE_BPS,
        }
    );
    assert_eq!(
        s.kernel.ttl_config(),
        TtlConfig {
            ledger_close_ms: CLOSE_MS,
            min_persistent_ttl: MIN_TTL,
        }
    );
    assert_eq!(s.kernel.owner(), s.owner);
    assert_eq!(s.kernel.job_counter(), 0);
    assert_eq!(s.kernel.total_escrowed(), 0);
    assert_eq!(s.kernel.total_withdrawable(), 0);
    assert_eq!(s.kernel.unaccounted(), 0);
    assert_eq!(
        s.kernel.try_get_job(&1),
        Err(Ok(SquareJobError::InvalidJob))
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn constructor_refuses_a_fee_above_twenty_percent() {
    let env = Env::default();
    let s = setup(&env);
    env.register(
        SquareJob,
        (
            &s.owner,
            &s.token.address,
            &WINDOW,
            &(MAX_PLATFORM_FEE_BPS + 1),
            &CLOSE_MS,
            &MIN_TTL,
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn constructor_refuses_a_zero_ttl_config() {
    let env = Env::default();
    let s = setup(&env);
    env.register(
        SquareJob,
        (
            &s.owner,
            &s.token.address,
            &WINDOW,
            &FEE_BPS,
            &0u32,
            &MIN_TTL,
        ),
    );
}

// ---- the optimistic path -----------------------------------------------------

#[test]
fn optimistic_path_create_fund_submit_finalize_withdraw() {
    let env = Env::default();
    let s = setup(&env);

    let id = s.kernel.create_job(
        &s.client,
        &s.provider,
        &(T0 + DAY),
        &text(&env, "translate the deck"),
    );
    let created = s.last_event();
    assert_eq!(id, 1);
    assert_eq!(s.kernel.job_counter(), 1);
    let job = s.kernel.get_job(&id);
    assert_eq!(job.client, s.client);
    assert_eq!(job.provider, s.provider);
    assert_eq!(job.status, JobStatus::Open);
    assert_eq!(job.budget, 0);
    assert_eq!(job.platform_fee_bps, FEE_BPS);
    assert_eq!(job.challenge_window, WINDOW);
    assert_eq!(job.created_at, T0);
    assert_eq!(job.expired_at, T0 + DAY);
    assert_eq!(job.deliverable, None);
    assert_eq!(
        created,
        JobCreated {
            job_id: id,
            client: s.client.clone(),
            provider: s.provider.clone(),
            expired_at: T0 + DAY,
            challenge_window: WINDOW,
            platform_fee_bps: FEE_BPS,
            description: text(&env, "translate the deck"),
        }
        .to_xdr(&env, &s.kernel_id)
    );

    // The provider prices the job; the client accepts the price by funding it.
    s.kernel.set_budget(&s.provider, &id, &BUDGET);
    let budget_set = s.last_event();
    assert_eq!(s.kernel.get_job(&id).budget, BUDGET as u64);
    assert_eq!(
        budget_set,
        BudgetSet {
            job_id: id,
            by: s.provider.clone(),
            amount: BUDGET as u64
        }
        .to_xdr(&env, &s.kernel_id)
    );

    s.kernel.fund(&s.client, &id, &BUDGET);
    let funded = s.last_event();
    let job = s.kernel.get_job(&id);
    assert_eq!(job.status, JobStatus::Funded);
    assert_eq!(job.funded_at, T0);
    assert_eq!(s.token.balance(&s.client), MINT - BUDGET);
    assert_eq!(s.token.balance(&s.kernel_id), BUDGET);
    assert_eq!(s.kernel.total_escrowed(), BUDGET as u64);
    assert_eq!(
        funded,
        Funded {
            job_id: id,
            client: s.client.clone(),
            amount: BUDGET as u64
        }
        .to_xdr(&env, &s.kernel_id)
    );
    s.assert_solvent();

    advance(&env, 3_600);
    s.kernel.submit(&s.provider, &id, &hash(&env, 7));
    let submitted = s.last_event();
    let job = s.kernel.get_job(&id);
    assert_eq!(job.status, JobStatus::Submitted);
    assert_eq!(job.submitted_at, T0 + 3_600);
    assert_eq!(job.deliverable, Some(hash(&env, 7)));
    assert_eq!(
        submitted,
        Submitted {
            job_id: id,
            provider: s.provider.clone(),
            deliverable: hash(&env, 7),
            submitted_at: T0 + 3_600,
            finalize_after: T0 + 3_600 + WINDOW,
        }
        .to_xdr(&env, &s.kernel_id)
    );

    // Inside the window nobody can finalize; one second before the end still not.
    assert_eq!(
        s.kernel.try_finalize(&id),
        Err(Ok(SquareJobError::WindowOpen))
    );
    advance(&env, WINDOW - 1);
    assert_eq!(
        s.kernel.try_finalize(&id),
        Err(Ok(SquareJobError::WindowOpen))
    );
    advance(&env, 1);
    s.kernel.finalize(&id);
    let finalized = s.last_event();

    let fee = (BUDGET as u64) * u64::from(FEE_BPS) / u64::from(BPS);
    let payout = BUDGET as u64 - fee;
    assert_eq!(fee, 1_2500000);
    assert_eq!(s.status(id), JobStatus::Completed);
    assert_eq!(s.kernel.withdrawable(&s.provider), payout);
    assert_eq!(s.kernel.withdrawable(&s.owner), fee);
    assert_eq!(s.kernel.total_escrowed(), 0);
    assert_eq!(s.kernel.total_withdrawable(), BUDGET as u64);
    assert_eq!(
        finalized,
        Finalized {
            job_id: id,
            provider: s.provider.clone(),
            payout,
            fee
        }
        .to_xdr(&env, &s.kernel_id)
    );
    s.assert_solvent();

    // Finalizing twice, or rejecting a completed job, is refused.
    assert_eq!(
        s.kernel.try_finalize(&id),
        Err(Ok(SquareJobError::WrongStatus))
    );
    assert_eq!(
        s.kernel.try_reject(&s.client, &id, &text(&env, "late")),
        Err(Ok(SquareJobError::WrongStatus))
    );

    // Pull payment: the provider pays part of its balance to a third address.
    let payee = Address::generate(&env);
    s.kernel.withdraw_to(&s.provider, &payee, &10_0000000);
    let withdrawn = s.last_event();
    assert_eq!(s.token.balance(&payee), 10_0000000);
    assert_eq!(s.kernel.withdrawable(&s.provider), payout - 10_0000000);
    assert_eq!(
        withdrawn,
        Withdrawn {
            account: s.provider.clone(),
            to: payee.clone(),
            amount: 10_0000000
        }
        .to_xdr(&env, &s.kernel_id)
    );
    s.kernel
        .withdraw_to(&s.provider, &s.provider, &i128::from(payout - 10_0000000));
    assert_eq!(
        s.token.balance(&s.provider),
        i128::from(payout) - 10_0000000
    );
    assert_eq!(s.kernel.withdrawable(&s.provider), 0);
    s.kernel.withdraw_to(&s.owner, &s.owner, &i128::from(fee));
    assert_eq!(s.token.balance(&s.kernel_id), 0);
    assert_eq!(s.kernel.total_withdrawable(), 0);
    s.assert_solvent();
}

#[test]
fn a_zero_window_finalizes_at_once_and_never_rejects_a_submission() {
    let env = Env::default();
    let s = setup_with(&env, 0, 0);
    let id = s.submitted_job();
    assert_eq!(
        s.kernel.try_reject(&s.client, &id, &text(&env, "no")),
        Err(Ok(SquareJobError::WindowClosed))
    );
    s.kernel.finalize(&id);
    assert_eq!(s.kernel.withdrawable(&s.provider), BUDGET as u64);
    assert_eq!(s.kernel.withdrawable(&s.owner), 0);
    s.assert_solvent();
}

#[test]
fn fee_rounds_down_and_cannot_overflow() {
    assert_eq!(fee_of(0, FEE_BPS), 0);
    assert_eq!(fee_of(1, FEE_BPS), 0);
    assert_eq!(fee_of(39, FEE_BPS), 0);
    assert_eq!(fee_of(40, FEE_BPS), 1);
    assert_eq!(fee_of(BUDGET as u64, FEE_BPS), 1_2500000);
    assert_eq!(fee_of(u64::MAX, MAX_PLATFORM_FEE_BPS), u64::MAX / 5);
    assert_eq!(fee_of(u64::MAX, 0), 0);
}

// ---- guards ----------------------------------------------------------------

#[test]
fn create_job_guards() {
    let env = Env::default();
    let s = setup(&env);
    let long = text(
        &env,
        core::str::from_utf8(&[b'x'; MAX_TEXT as usize + 1]).unwrap(),
    );
    let ok = text(
        &env,
        core::str::from_utf8(&[b'x'; MAX_TEXT as usize]).unwrap(),
    );
    assert_eq!(
        s.kernel
            .try_create_job(&s.client, &s.client, &(T0 + DAY), &ok),
        Err(Ok(SquareJobError::SameParty))
    );
    assert_eq!(
        s.kernel.try_create_job(&s.client, &s.provider, &T0, &ok),
        Err(Ok(SquareJobError::ExpiryTooShort))
    );
    assert_eq!(
        s.kernel
            .try_create_job(&s.client, &s.provider, &(T0 - 1), &ok),
        Err(Ok(SquareJobError::ExpiryTooShort))
    );
    assert_eq!(
        s.kernel
            .try_create_job(&s.client, &s.provider, &(T0 + DAY), &long),
        Err(Ok(SquareJobError::TextTooLong))
    );
    assert_eq!(
        s.kernel.create_job(&s.client, &s.provider, &(T0 + 1), &ok),
        1
    );
    assert_eq!(
        s.kernel
            .create_job(&s.client, &s.provider, &(T0 + DAY), &ok),
        2
    );
    assert_eq!(s.kernel.job_counter(), 2);
}

#[test]
fn set_budget_guards() {
    let env = Env::default();
    let s = setup(&env);
    let id = s
        .kernel
        .create_job(&s.client, &s.provider, &(T0 + DAY), &text(&env, "x"));
    let outsider = Address::generate(&env);
    assert_eq!(
        s.kernel.try_set_budget(&outsider, &id, &BUDGET),
        Err(Ok(SquareJobError::NotParty))
    );
    assert_eq!(
        s.kernel.try_set_budget(&s.client, &id, &0),
        Err(Ok(SquareJobError::InvalidAmount))
    );
    assert_eq!(
        s.kernel.try_set_budget(&s.client, &id, &-1),
        Err(Ok(SquareJobError::InvalidAmount))
    );
    assert_eq!(
        s.kernel
            .try_set_budget(&s.client, &id, &(i128::from(u64::MAX) + 1)),
        Err(Ok(SquareJobError::InvalidAmount))
    );
    assert_eq!(
        s.kernel.try_set_budget(&s.client, &99, &BUDGET),
        Err(Ok(SquareJobError::InvalidJob))
    );
    // Either party, any number of times while Open; the record keeps the last.
    s.kernel.set_budget(&s.client, &id, &1);
    s.kernel.set_budget(&s.provider, &id, &i128::from(u64::MAX));
    assert_eq!(s.kernel.get_job(&id).budget, u64::MAX);
    s.kernel.set_budget(&s.client, &id, &BUDGET);
    s.kernel.fund(&s.client, &id, &BUDGET);
    assert_eq!(
        s.kernel.try_set_budget(&s.client, &id, &1),
        Err(Ok(SquareJobError::WrongStatus))
    );
}

#[test]
fn fund_guards() {
    let env = Env::default();
    let s = setup(&env);
    let id = s
        .kernel
        .create_job(&s.client, &s.provider, &(T0 + DAY), &text(&env, "x"));
    assert_eq!(
        s.kernel.try_fund(&s.client, &id, &BUDGET),
        Err(Ok(SquareJobError::ZeroBudget))
    );
    s.kernel.set_budget(&s.provider, &id, &BUDGET);
    assert_eq!(
        s.kernel.try_fund(&s.provider, &id, &BUDGET),
        Err(Ok(SquareJobError::NotClient))
    );
    assert_eq!(
        s.kernel.try_fund(&s.client, &id, &(BUDGET + 1)),
        Err(Ok(SquareJobError::BudgetMismatch))
    );
    assert_eq!(
        s.kernel.try_fund(&s.client, &99, &BUDGET),
        Err(Ok(SquareJobError::InvalidJob))
    );
    // Nothing moved on any refusal.
    assert_eq!(s.token.balance(&s.kernel_id), 0);
    assert_eq!(s.kernel.total_escrowed(), 0);

    s.kernel.fund(&s.client, &id, &BUDGET);
    assert_eq!(
        s.kernel.try_fund(&s.client, &id, &BUDGET),
        Err(Ok(SquareJobError::WrongStatus))
    );
    assert_eq!(s.token.balance(&s.kernel_id), BUDGET);
    s.assert_solvent();

    // At expiry the job can no longer be funded.
    let late = s
        .kernel
        .create_job(&s.client, &s.provider, &(T0 + DAY), &text(&env, "y"));
    s.kernel.set_budget(&s.client, &late, &BUDGET);
    advance(&env, DAY);
    assert_eq!(
        s.kernel.try_fund(&s.client, &late, &BUDGET),
        Err(Ok(SquareJobError::Expired))
    );
}

#[test]
fn fund_fails_when_the_client_cannot_pay() {
    let env = Env::default();
    let s = setup(&env);
    let id = s
        .kernel
        .create_job(&s.client, &s.provider, &(T0 + DAY), &text(&env, "x"));
    s.kernel.set_budget(&s.client, &id, &(MINT + 1));
    // The SAC refuses the transfer; the kernel's state is untouched.
    assert!(s.kernel.try_fund(&s.client, &id, &(MINT + 1)).is_err());
    assert_eq!(s.status(id), JobStatus::Open);
    assert_eq!(s.kernel.total_escrowed(), 0);
}

#[test]
fn submit_guards() {
    let env = Env::default();
    let s = setup(&env);
    let id = s.open_job();
    assert_eq!(
        s.kernel.try_submit(&s.provider, &id, &hash(&env, 1)),
        Err(Ok(SquareJobError::WrongStatus))
    );
    s.kernel.fund(&s.client, &id, &BUDGET);
    assert_eq!(
        s.kernel.try_submit(&s.client, &id, &hash(&env, 1)),
        Err(Ok(SquareJobError::NotProvider))
    );
    assert_eq!(
        s.kernel.try_submit(&s.provider, &99, &hash(&env, 1)),
        Err(Ok(SquareJobError::InvalidJob))
    );
    s.kernel.submit(&s.provider, &id, &hash(&env, 1));
    assert_eq!(
        s.kernel.try_submit(&s.provider, &id, &hash(&env, 2)),
        Err(Ok(SquareJobError::WrongStatus))
    );
    assert_eq!(s.kernel.get_job(&id).deliverable, Some(hash(&env, 1)));

    let late = s.funded_job();
    advance(&env, DAY);
    assert_eq!(
        s.kernel.try_submit(&s.provider, &late, &hash(&env, 1)),
        Err(Ok(SquareJobError::Expired))
    );
}

// ---- reject and refund -------------------------------------------------------

#[test]
fn reject_while_open_credits_nothing() {
    let env = Env::default();
    let s = setup(&env);
    let id = s.open_job();
    s.kernel
        .reject(&s.client, &id, &text(&env, "changed my mind"));
    let rejected = s.last_event();
    assert_eq!(s.status(id), JobStatus::Rejected);
    assert_eq!(s.kernel.withdrawable(&s.client), 0);
    assert_eq!(s.kernel.total_withdrawable(), 0);
    assert_eq!(
        rejected,
        Rejected {
            job_id: id,
            client: s.client.clone(),
            refund: 0,
            reason: text(&env, "changed my mind")
        }
        .to_xdr(&env, &s.kernel_id)
    );
    assert_eq!(
        s.kernel.try_fund(&s.client, &id, &BUDGET),
        Err(Ok(SquareJobError::WrongStatus))
    );
}

#[test]
fn reject_while_funded_refunds_the_client() {
    let env = Env::default();
    let s = setup(&env);
    let id = s.funded_job();
    s.kernel
        .reject(&s.client, &id, &text(&env, "no longer needed"));
    let rejected = s.last_event();
    assert_eq!(s.status(id), JobStatus::Rejected);
    assert_eq!(s.kernel.withdrawable(&s.client), BUDGET as u64);
    assert_eq!(s.kernel.total_escrowed(), 0);
    assert_eq!(
        rejected,
        Rejected {
            job_id: id,
            client: s.client.clone(),
            refund: BUDGET as u64,
            reason: text(&env, "no longer needed")
        }
        .to_xdr(&env, &s.kernel_id)
    );
    s.assert_solvent();
    s.kernel.withdraw_to(&s.client, &s.client, &BUDGET);
    assert_eq!(s.token.balance(&s.client), MINT);
    s.assert_solvent();
}

#[test]
fn reject_inside_the_window_refunds_after_it_is_refused() {
    let env = Env::default();
    let s = setup(&env);
    let id = s.submitted_job();
    advance(&env, WINDOW - 1);
    s.kernel
        .reject(&s.client, &id, &text(&env, "wrong language"));
    assert_eq!(s.status(id), JobStatus::Rejected);
    assert_eq!(s.kernel.withdrawable(&s.client), BUDGET as u64);
    assert_eq!(s.kernel.withdrawable(&s.provider), 0);
    assert_eq!(
        s.kernel.try_finalize(&id),
        Err(Ok(SquareJobError::WrongStatus))
    );
    s.assert_solvent();

    let id = s.submitted_job();
    advance(&env, WINDOW);
    assert_eq!(
        s.kernel.try_reject(&s.client, &id, &text(&env, "too late")),
        Err(Ok(SquareJobError::WindowClosed))
    );
    assert_eq!(s.status(id), JobStatus::Submitted);
    s.kernel.finalize(&id);
    s.assert_solvent();
}

#[test]
fn reject_guards() {
    let env = Env::default();
    let s = setup(&env);
    let id = s.funded_job();
    let long = text(
        &env,
        core::str::from_utf8(&[b'r'; MAX_TEXT as usize + 1]).unwrap(),
    );
    assert_eq!(
        s.kernel.try_reject(&s.provider, &id, &text(&env, "x")),
        Err(Ok(SquareJobError::NotClient))
    );
    assert_eq!(
        s.kernel.try_reject(&s.client, &id, &long),
        Err(Ok(SquareJobError::TextTooLong))
    );
    assert_eq!(
        s.kernel.try_reject(&s.client, &99, &text(&env, "x")),
        Err(Ok(SquareJobError::InvalidJob))
    );
    assert_eq!(s.status(id), JobStatus::Funded);
    // Once, and once only.
    s.kernel.reject(&s.client, &id, &text(&env, "x"));
    assert_eq!(
        s.kernel.try_reject(&s.client, &id, &text(&env, "x")),
        Err(Ok(SquareJobError::WrongStatus))
    );
    assert_eq!(s.kernel.withdrawable(&s.client), BUDGET as u64);
}

#[test]
fn claim_refund_after_expiry_without_a_submission() {
    let env = Env::default();
    let s = setup(&env);
    let open = s.open_job();
    let funded = s.funded_job();
    let submitted = s.submitted_job();
    assert_eq!(
        s.kernel.try_claim_refund(&funded),
        Err(Ok(SquareJobError::NotExpired))
    );
    advance(&env, DAY - 1);
    assert_eq!(
        s.kernel.try_claim_refund(&funded),
        Err(Ok(SquareJobError::NotExpired))
    );
    advance(&env, 1);
    // Nothing to refund on an Open job, and a submission stopped the clock.
    assert_eq!(
        s.kernel.try_claim_refund(&open),
        Err(Ok(SquareJobError::WrongStatus))
    );
    assert_eq!(
        s.kernel.try_claim_refund(&submitted),
        Err(Ok(SquareJobError::WrongStatus))
    );
    assert_eq!(
        s.kernel.try_claim_refund(&99),
        Err(Ok(SquareJobError::InvalidJob))
    );

    s.kernel.claim_refund(&funded);
    let refunded = s.last_event();
    assert_eq!(s.status(funded), JobStatus::Expired);
    assert_eq!(s.kernel.withdrawable(&s.client), BUDGET as u64);
    assert_eq!(
        refunded,
        Refunded {
            job_id: funded,
            client: s.client.clone(),
            amount: BUDGET as u64
        }
        .to_xdr(&env, &s.kernel_id)
    );
    assert_eq!(
        s.kernel.try_claim_refund(&funded),
        Err(Ok(SquareJobError::WrongStatus))
    );
    s.assert_solvent();

    // The submitted job still settles through the window after expiry.
    s.kernel.finalize(&submitted);
    assert_eq!(s.status(submitted), JobStatus::Completed);
    s.assert_solvent();
}

// ---- withdrawals ---------------------------------------------------------------

#[test]
fn withdraw_guards() {
    let env = Env::default();
    let s = setup(&env);
    let id = s.funded_job();
    s.kernel.reject(&s.client, &id, &text(&env, "x"));
    let budget = BUDGET as u64;
    assert_eq!(
        s.kernel.try_withdraw_to(&s.client, &s.client, &0),
        Err(Ok(SquareJobError::InvalidAmount))
    );
    assert_eq!(
        s.kernel.try_withdraw_to(&s.client, &s.client, &-5),
        Err(Ok(SquareJobError::InvalidAmount))
    );
    assert_eq!(
        s.kernel
            .try_withdraw_to(&s.client, &s.client, &(BUDGET + 1)),
        Err(Ok(SquareJobError::InsufficientBalance))
    );
    // Someone with no balance cannot withdraw anything, however they sign.
    assert_eq!(
        s.kernel.try_withdraw_to(&s.provider, &s.provider, &1),
        Err(Ok(SquareJobError::InsufficientBalance))
    );
    // In two parts, and not a third time.
    s.kernel.withdraw_to(&s.client, &s.client, &(BUDGET - 1));
    s.kernel.withdraw_to(&s.client, &s.client, &1);
    assert_eq!(
        s.kernel.try_withdraw_to(&s.client, &s.client, &1),
        Err(Ok(SquareJobError::InsufficientBalance))
    );
    assert_eq!(s.token.balance(&s.client), MINT);
    assert_eq!(s.kernel.withdrawable(&s.client), 0);
    assert_eq!(s.kernel.total_withdrawable(), 0);
    let _ = budget;
    s.assert_solvent();
}

// ---- authorization -----------------------------------------------------------

#[test]
fn unsigned_calls_are_refused_and_cranks_are_not() {
    let env = Env::default();
    let s = setup(&env);
    let refund_me = s.funded_job();
    let settle_me = s.submitted_job();
    let open = s.open_job();
    // From here on nothing is signed.
    env.set_auths(&[]);
    assert!(s
        .kernel
        .try_create_job(&s.client, &s.provider, &(T0 + DAY), &text(&env, "x"))
        .is_err());
    assert!(s.kernel.try_set_budget(&s.client, &open, &1).is_err());
    assert!(s.kernel.try_fund(&s.client, &open, &BUDGET).is_err());
    assert!(s
        .kernel
        .try_submit(&s.provider, &refund_me, &hash(&env, 1))
        .is_err());
    assert!(s
        .kernel
        .try_reject(&s.client, &refund_me, &text(&env, "x"))
        .is_err());
    assert!(s.kernel.try_withdraw_to(&s.client, &s.client, &1).is_err());
    assert!(s.kernel.try_skim(&s.owner).is_err());
    assert!(s.kernel.try_set_ttl_config(&CLOSE_MS, &MIN_TTL).is_err());
    assert!(s.kernel.try_transfer_ownership(&s.client, &2_000).is_err());
    assert_eq!(s.status(refund_me), JobStatus::Funded);
    assert_eq!(s.status(settle_me), JobStatus::Submitted);
    assert_eq!(s.status(open), JobStatus::Open);

    // The two cranks need nobody's signature.
    advance(&env, DAY);
    s.kernel.finalize(&settle_me);
    s.kernel.claim_refund(&refund_me);
    assert_eq!(s.status(settle_me), JobStatus::Completed);
    assert_eq!(s.status(refund_me), JobStatus::Expired);
    s.assert_solvent();
}

#[test]
fn only_the_stored_owner_can_skim_and_set_ttl_config() {
    let env = Env::default();
    let s = setup(&env);
    let intruder = Address::generate(&env);
    // A donation makes something to skim.
    s.token.transfer(&s.client, &s.kernel_id, &3_0000000);
    assert_eq!(s.kernel.unaccounted(), 3_0000000);

    let skim_auth = |who: &Address| {
        env.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &s.kernel_id,
                fn_name: "skim",
                args: (&s.owner,).into_val(&env),
                sub_invokes: &[],
            },
        }]);
    };
    skim_auth(&intruder);
    assert!(s.kernel.try_skim(&s.owner).is_err());
    assert_eq!(s.kernel.unaccounted(), 3_0000000);
    skim_auth(&s.owner);
    s.kernel.skim(&s.owner);
    let skimmed = s.last_event();
    assert_eq!(s.token.balance(&s.owner), 3_0000000);
    assert_eq!(s.kernel.unaccounted(), 0);
    assert_eq!(
        skimmed,
        Skimmed {
            to: s.owner.clone(),
            amount: 3_0000000
        }
        .to_xdr(&env, &s.kernel_id)
    );

    let ttl_auth = |who: &Address| {
        env.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &s.kernel_id,
                fn_name: "set_ttl_config",
                args: (6_000u32, MIN_TTL).into_val(&env),
                sub_invokes: &[],
            },
        }]);
    };
    ttl_auth(&intruder);
    assert!(s.kernel.try_set_ttl_config(&6_000, &MIN_TTL).is_err());
    assert_eq!(s.kernel.ttl_config().ledger_close_ms, CLOSE_MS);
    ttl_auth(&s.owner);
    s.kernel.set_ttl_config(&6_000, &MIN_TTL);
    assert_eq!(s.kernel.ttl_config().ledger_close_ms, 6_000);

    env.mock_all_auths();
    assert_eq!(
        s.kernel.try_set_ttl_config(&6_000, &0),
        Err(Ok(SquareJobError::InvalidTtlConfig))
    );
    assert_eq!(
        s.kernel.try_skim(&s.owner),
        Err(Ok(SquareJobError::NothingToSkim))
    );
}

#[test]
fn skim_never_touches_escrow_or_balances() {
    let env = Env::default();
    let s = setup(&env);
    let id = s.submitted_job();
    let rejected = s.funded_job();
    s.kernel.reject(&s.client, &rejected, &text(&env, "x"));
    assert_eq!(
        s.kernel.try_skim(&s.owner),
        Err(Ok(SquareJobError::NothingToSkim))
    );
    s.token.transfer(&s.client, &s.kernel_id, &1);
    s.kernel.skim(&s.owner);
    assert_eq!(s.token.balance(&s.owner), 1);
    assert_eq!(s.kernel.total_escrowed(), BUDGET as u64);
    assert_eq!(s.kernel.withdrawable(&s.client), BUDGET as u64);
    s.assert_solvent();
    advance(&env, WINDOW);
    s.kernel.finalize(&id);
    s.assert_solvent();
}

#[test]
fn ownership_moves_in_two_steps_and_fees_follow() {
    let env = Env::default();
    let s = setup(&env);
    let heir = Address::generate(&env);
    let seq = env.ledger().sequence();

    assert_eq!(
        s.kernel.try_accept_ownership(),
        Err(Ok(OwnerError::NoPendingOffer))
    );
    assert_eq!(
        s.kernel.try_transfer_ownership(&s.owner, &(seq + 10)),
        Err(Ok(OwnerError::SameOwner))
    );
    assert_eq!(
        s.kernel.try_transfer_ownership(&heir, &(seq - 1)),
        Err(Ok(OwnerError::OfferExpired))
    );

    // An offer that lapses.
    s.kernel.transfer_ownership(&heir, &(seq + 10));
    env.ledger().set_sequence_number(seq + 11);
    assert_eq!(
        s.kernel.try_accept_ownership(),
        Err(Ok(OwnerError::OfferExpired))
    );
    assert_eq!(s.kernel.owner(), s.owner);

    // A fresh offer; only the offered address can accept it.
    let seq = env.ledger().sequence();
    s.kernel.transfer_ownership(&heir, &(seq + 10));
    let other = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &other,
        invoke: &MockAuthInvoke {
            contract: &s.kernel_id,
            fn_name: "accept_ownership",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.kernel.try_accept_ownership().is_err());
    env.mock_auths(&[MockAuth {
        address: &heir,
        invoke: &MockAuthInvoke {
            contract: &s.kernel_id,
            fn_name: "accept_ownership",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    s.kernel.accept_ownership();
    let transferred = s.last_event();
    assert_eq!(s.kernel.owner(), heir);
    assert_eq!(
        transferred,
        OwnershipTransferred {
            from: s.owner.clone(),
            to: heir.clone()
        }
        .to_xdr(&env, &s.kernel_id)
    );
    env.as_contract(&s.kernel_id, || {
        assert_eq!(
            square_common::owner::pending_owner(&env),
            None::<PendingOwner>
        );
    });

    // The old owner is out; the fee of the next settlement goes to the heir.
    env.mock_all_auths();
    let id = s.submitted_job();
    advance(&env, WINDOW);
    s.kernel.finalize(&id);
    assert_eq!(s.kernel.withdrawable(&heir), 1_2500000);
    assert_eq!(s.kernel.withdrawable(&s.owner), 0);
    s.assert_solvent();
}

// ---- TTL ----------------------------------------------------------------------

#[test]
fn ttl_follows_the_job_and_refreshes_balances() {
    let env = Env::default();
    let s = setup(&env);
    let ttl = s.kernel.ttl_config();
    let max = env.as_contract(&s.kernel_id, || env.storage().max_ttl());

    // A job a day out already lives long enough for the test host's minimum?
    // No: the host's minimum is 4,096 ledgers and a day is 17,280, so the
    // record is extended to the end of its window plus one window of slack.
    let day = s
        .kernel
        .create_job(&s.client, &s.provider, &(T0 + DAY), &text(&env, "x"));
    let expect = |expiry: u64| {
        let to_end = ttl.ledgers_until(env.ledger().timestamp(), expiry + WINDOW);
        (to_end + ttl.ledgers_for(WINDOW)).min(max)
    };
    env.as_contract(&s.kernel_id, || {
        assert_eq!(
            env.storage().persistent().get_ttl(&DataKey::Job(day)),
            expect(T0 + DAY)
        );
        assert_eq!(env.storage().instance().get_ttl(), MIN_TTL);
    });

    // Thirty days out: 518,400 ledgers to expiry, 120 to the end of the
    // window and 120 more of slack (the decision's worked numbers).
    let month = s
        .kernel
        .create_job(&s.client, &s.provider, &(T0 + 30 * DAY), &text(&env, "x"));
    env.as_contract(&s.kernel_id, || {
        assert_eq!(
            env.storage().persistent().get_ttl(&DataKey::Job(month)),
            518_400 + 120 + 120
        );
    });

    // Past the maximum: capped, not refused.
    let far = s
        .kernel
        .create_job(&s.client, &s.provider, &(T0 + 400 * DAY), &text(&env, "x"));
    env.as_contract(&s.kernel_id, || {
        assert_eq!(env.storage().persistent().get_ttl(&DataKey::Job(far)), max);
    });

    // A balance entry is refreshed to the network minimum on every credit and
    // debit, whatever the job it came from.
    s.kernel.set_budget(&s.client, &day, &BUDGET);
    s.kernel.fund(&s.client, &day, &BUDGET);
    s.kernel.reject(&s.client, &day, &text(&env, "x"));
    env.as_contract(&s.kernel_id, || {
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::Withdrawable(s.client.clone())),
            MIN_TTL
        );
    });
    advance(&env, 5 * DAY);
    s.kernel.withdraw_to(&s.client, &s.client, &1);
    env.as_contract(&s.kernel_id, || {
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::Withdrawable(s.client.clone())),
            MIN_TTL
        );
        assert_eq!(env.storage().instance().get_ttl(), MIN_TTL);
    });
}

// ---- the invariant -------------------------------------------------------------

/// xorshift64*, so the sequence is the same on every run.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[test]
fn solvency_holds_under_random_action_sequences() {
    let env = Env::default();
    let s = setup(&env);
    let mut rng = Rng(0x5EED_5EED_5EED_5EED);
    let accounts = [s.client.clone(), s.provider.clone(), s.owner.clone()];
    let mut jobs: StdVec<u64> = StdVec::new();
    let mut settled = [0u64; 6];

    for _ in 0..400 {
        let pick = |rng: &mut Rng, jobs: &StdVec<u64>| jobs[rng.below(jobs.len() as u64) as usize];
        match rng.below(9) {
            0 => {
                let expiry = env.ledger().timestamp() + rng.below(3 * DAY) + 1;
                if let Ok(Ok(id)) =
                    s.kernel
                        .try_create_job(&s.client, &s.provider, &expiry, &text(&env, "r"))
                {
                    let _ = s.kernel.try_set_budget(
                        &s.provider,
                        &id,
                        &i128::from(1 + rng.below(20_0000000)),
                    );
                    jobs.push(id);
                }
            }
            1 if !jobs.is_empty() => {
                let id = pick(&mut rng, &jobs);
                let budget = i128::from(s.kernel.get_job(&id).budget);
                let _ = s.kernel.try_fund(&s.client, &id, &budget);
            }
            2 if !jobs.is_empty() => {
                let id = pick(&mut rng, &jobs);
                let _ = s.kernel.try_submit(&s.provider, &id, &hash(&env, 3));
            }
            3 if !jobs.is_empty() => {
                let id = pick(&mut rng, &jobs);
                let _ = s.kernel.try_finalize(&id);
            }
            4 if !jobs.is_empty() => {
                let id = pick(&mut rng, &jobs);
                let _ = s.kernel.try_reject(&s.client, &id, &text(&env, "r"));
            }
            5 if !jobs.is_empty() => {
                let id = pick(&mut rng, &jobs);
                let _ = s.kernel.try_claim_refund(&id);
            }
            6 => {
                let account = &accounts[rng.below(3) as usize];
                let amount = i128::from(1 + rng.below(1 + s.kernel.withdrawable(account) + 5));
                let _ = s.kernel.try_withdraw_to(account, account, &amount);
            }
            7 => advance(&env, rng.below(2 * WINDOW)),
            _ => advance(&env, rng.below(DAY / 2)),
        }
        s.assert_solvent();
        let sum: u64 = accounts.iter().map(|a| s.kernel.withdrawable(a)).sum();
        assert_eq!(sum, s.kernel.total_withdrawable());
    }

    // The sequence exercised every terminal status, so the invariant was
    // checked across all of them, not only on the optimistic path.
    for id in &jobs {
        settled[s.status(*id) as usize] += 1;
    }
    assert!(
        settled[JobStatus::Completed as usize] > 0,
        "no job completed: {settled:?}"
    );
    assert!(
        settled[JobStatus::Rejected as usize] > 0,
        "no job rejected: {settled:?}"
    );
    assert!(
        settled[JobStatus::Expired as usize] > 0,
        "no job expired: {settled:?}"
    );
    assert_eq!(
        s.token.balance(&s.client)
            + s.token.balance(&s.provider)
            + s.token.balance(&s.owner)
            + s.token.balance(&s.kernel_id),
        MINT
    );
}
