//! Job kernel (B2, #9), MVP: the state machine and the pull-payment ledger
//! for one settlement model, the challenge window.
//!
//! ```text
//! create_job ──set_budget──▶ Open ──fund──▶ Funded ──submit──▶ Submitted
//!                             │               │                   │
//!                          reject          reject            reject (inside the window)
//!                             ▼               ▼ claim_refund      ▼            finalize (after it, anyone)
//!                          Rejected        Rejected/Expired    Rejected        Completed
//! ```
//!
//! Money moves twice: into the kernel on `fund` (the client's one signature
//! covers the SEP-41 `transfer` beneath it, docs/decisions/auth-and-token-flow.md),
//! and out on `withdraw_to`. Everything between is a credit to a
//! `withdrawable` balance: the provider's payout and the owner's fee on
//! `finalize`, the client's refund on `reject` and `claim_refund`. The kernel
//! therefore always holds `total_escrowed + total_withdrawable`, and `skim`
//! moves only what is above that.
//!
//! Every write takes the acting address as a parameter and `require_auth`s
//! it, then compares it with the record; `finalize` and `claim_refund` take
//! none, anyone may crank them. Amounts are `i128` at the boundary and `u64`
//! in the record (`square_common::amount`). Ledger-entry TTL follows
//! `square_common::ttl`. Phase 2 (hooks, evaluators, compliance proofs,
//! arbitration) is out of this contract until its issues land.
#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, String};
use square_common::{
    amount,
    events::{
        BudgetSet, Finalized, Funded, JobCreated, Refunded, Rejected, Skimmed, Submitted, Withdrawn,
    },
    job::{Config, Job, JobStatus, SquareJobError, BPS, MAX_PLATFORM_FEE_BPS, MAX_TEXT},
    owner::{self, OwnerError},
    ttl::{self, TtlConfig},
};

/// Storage keys. `Job` and `Withdrawable` are persistent, the rest instance.
/// `Owner` and `PendingOwner` are taken by `square_common::owner`.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Ttl,
    JobCounter,
    TotalEscrowed,
    TotalWithdrawable,
    Job(u64),
    Withdrawable(Address),
}

#[contract]
pub struct SquareJob;

#[contractimpl]
impl SquareJob {
    /// Deploys with its settings. `owner` receives the fees and may `skim`,
    /// `set_ttl_config` and offer ownership; `token` is the SEP-41 contract
    /// jobs are paid in; `challenge_window` is in seconds and may be zero
    /// (instant finalize, no rejection of a submission); `ledger_close_ms`
    /// and `min_persistent_ttl` are the network's values
    /// (`square_common::ttl`).
    pub fn __constructor(
        env: Env,
        owner: Address,
        token: Address,
        challenge_window: u64,
        platform_fee_bps: u32,
        ledger_close_ms: u32,
        min_persistent_ttl: u32,
    ) -> Result<(), SquareJobError> {
        if platform_fee_bps > MAX_PLATFORM_FEE_BPS {
            return Err(SquareJobError::FeeTooHigh);
        }
        let ttl_config = TtlConfig {
            ledger_close_ms,
            min_persistent_ttl,
        };
        if !ttl_config.is_valid() {
            return Err(SquareJobError::InvalidTtlConfig);
        }
        owner::set_owner(&env, &owner);
        let instance = env.storage().instance();
        instance.set(
            &DataKey::Config,
            &Config {
                token,
                challenge_window,
                platform_fee_bps,
            },
        );
        instance.set(&DataKey::Ttl, &ttl_config);
        instance.set(&DataKey::JobCounter, &0u64);
        instance.set(&DataKey::TotalEscrowed, &0u64);
        instance.set(&DataKey::TotalWithdrawable, &0u64);
        ttl::extend_instance(&env, &ttl_config);
        Ok(())
    }

    // ---- the job -----------------------------------------------------------

    /// The client opens a job for `provider`, to be funded before and
    /// delivered by `expired_at`. Returns the job id, counted from 1.
    pub fn create_job(
        env: Env,
        client: Address,
        provider: Address,
        expired_at: u64,
        description: String,
    ) -> Result<u64, SquareJobError> {
        client.require_auth();
        if client == provider {
            return Err(SquareJobError::SameParty);
        }
        let now = env.ledger().timestamp();
        if expired_at <= now {
            return Err(SquareJobError::ExpiryTooShort);
        }
        if description.len() > MAX_TEXT {
            return Err(SquareJobError::TextTooLong);
        }
        let config = config(&env);
        let job_id = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::JobCounter)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::JobCounter, &job_id);
        let job = Job {
            client: client.clone(),
            provider: provider.clone(),
            status: JobStatus::Open,
            budget: 0,
            platform_fee_bps: config.platform_fee_bps,
            challenge_window: config.challenge_window,
            created_at: now,
            expired_at,
            funded_at: 0,
            submitted_at: 0,
            deliverable: None,
            description: description.clone(),
        };
        write_job(&env, job_id, &job);
        JobCreated {
            job_id,
            client,
            provider,
            expired_at,
            challenge_window: config.challenge_window,
            platform_fee_bps: config.platform_fee_bps,
            description,
        }
        .publish(&env);
        Ok(job_id)
    }

    /// Either party sets the budget while the job is Open. `fund` then names
    /// the budget it expects, so neither party can change it underneath the
    /// other.
    pub fn set_budget(
        env: Env,
        caller: Address,
        job_id: u64,
        amount: i128,
    ) -> Result<(), SquareJobError> {
        caller.require_auth();
        let mut job = load_job(&env, job_id)?;
        if job.status != JobStatus::Open {
            return Err(SquareJobError::WrongStatus);
        }
        if caller != job.client && caller != job.provider {
            return Err(SquareJobError::NotParty);
        }
        let amount = amount::to_record(amount).ok_or(SquareJobError::InvalidAmount)?;
        job.budget = amount;
        write_job(&env, job_id, &job);
        BudgetSet {
            job_id,
            by: caller,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// The client escrows the budget: one authorization covers this call and
    /// the token `transfer` into the kernel. No approve step.
    pub fn fund(
        env: Env,
        client: Address,
        job_id: u64,
        expected_budget: i128,
    ) -> Result<(), SquareJobError> {
        client.require_auth();
        let mut job = load_job(&env, job_id)?;
        if job.status != JobStatus::Open {
            return Err(SquareJobError::WrongStatus);
        }
        if client != job.client {
            return Err(SquareJobError::NotClient);
        }
        let now = env.ledger().timestamp();
        if now >= job.expired_at {
            return Err(SquareJobError::Expired);
        }
        if job.budget == 0 {
            return Err(SquareJobError::ZeroBudget);
        }
        if expected_budget != amount::to_boundary(job.budget) {
            return Err(SquareJobError::BudgetMismatch);
        }
        let kernel = env.current_contract_address();
        token::Client::new(&env, &config(&env).token).transfer(
            &client,
            &kernel,
            &amount::to_boundary(job.budget),
        );
        add_total(&env, &DataKey::TotalEscrowed, job.budget);
        job.status = JobStatus::Funded;
        job.funded_at = now;
        write_job(&env, job_id, &job);
        Funded {
            job_id,
            client,
            amount: job.budget,
        }
        .publish(&env);
        Ok(())
    }

    /// The provider records the deliverable's hash before `expired_at`. The
    /// challenge window starts now.
    pub fn submit(
        env: Env,
        provider: Address,
        job_id: u64,
        deliverable: BytesN<32>,
    ) -> Result<(), SquareJobError> {
        provider.require_auth();
        let mut job = load_job(&env, job_id)?;
        if job.status != JobStatus::Funded {
            return Err(SquareJobError::WrongStatus);
        }
        if provider != job.provider {
            return Err(SquareJobError::NotProvider);
        }
        let now = env.ledger().timestamp();
        if now >= job.expired_at {
            return Err(SquareJobError::Expired);
        }
        job.status = JobStatus::Submitted;
        job.submitted_at = now;
        job.deliverable = Some(deliverable.clone());
        write_job(&env, job_id, &job);
        Submitted {
            job_id,
            provider,
            deliverable,
            submitted_at: now,
            finalize_after: finalize_after(&job),
        }
        .publish(&env);
        Ok(())
    }

    /// Anyone, once the challenge window has passed without a rejection:
    /// credits the provider the budget less the fee, and the owner the fee.
    pub fn finalize(env: Env, job_id: u64) -> Result<(), SquareJobError> {
        let mut job = load_job(&env, job_id)?;
        if job.status != JobStatus::Submitted {
            return Err(SquareJobError::WrongStatus);
        }
        if env.ledger().timestamp() < finalize_after(&job) {
            return Err(SquareJobError::WindowOpen);
        }
        let fee = fee_of(job.budget, job.platform_fee_bps);
        let payout = job.budget - fee;
        credit(&env, &job.provider, payout);
        if fee > 0 {
            credit(&env, &owner::owner(&env), fee);
        }
        sub_total(&env, &DataKey::TotalEscrowed, job.budget);
        job.status = JobStatus::Completed;
        write_job(&env, job_id, &job);
        Finalized {
            job_id,
            provider: job.provider,
            payout,
            fee,
        }
        .publish(&env);
        Ok(())
    }

    /// The client closes the job: at any time while Open or Funded, and
    /// inside the challenge window once Submitted. An escrowed budget is
    /// credited back to the client in full.
    pub fn reject(
        env: Env,
        client: Address,
        job_id: u64,
        reason: String,
    ) -> Result<(), SquareJobError> {
        client.require_auth();
        let mut job = load_job(&env, job_id)?;
        if client != job.client {
            return Err(SquareJobError::NotClient);
        }
        if reason.len() > MAX_TEXT {
            return Err(SquareJobError::TextTooLong);
        }
        let refund = match job.status {
            JobStatus::Open => 0,
            JobStatus::Funded => job.budget,
            JobStatus::Submitted => {
                if env.ledger().timestamp() >= finalize_after(&job) {
                    return Err(SquareJobError::WindowClosed);
                }
                job.budget
            }
            _ => return Err(SquareJobError::WrongStatus),
        };
        if refund > 0 {
            credit(&env, &client, refund);
            sub_total(&env, &DataKey::TotalEscrowed, refund);
        }
        job.status = JobStatus::Rejected;
        write_job(&env, job_id, &job);
        Rejected {
            job_id,
            client,
            refund,
            reason,
        }
        .publish(&env);
        Ok(())
    }

    /// Anyone, once a Funded job has passed `expired_at` without a
    /// submission: credits the budget back to the client. A submission stops
    /// this clock; a Submitted job resolves only by `reject` or `finalize`.
    pub fn claim_refund(env: Env, job_id: u64) -> Result<(), SquareJobError> {
        let mut job = load_job(&env, job_id)?;
        if job.status != JobStatus::Funded {
            return Err(SquareJobError::WrongStatus);
        }
        if env.ledger().timestamp() < job.expired_at {
            return Err(SquareJobError::NotExpired);
        }
        credit(&env, &job.client, job.budget);
        sub_total(&env, &DataKey::TotalEscrowed, job.budget);
        job.status = JobStatus::Expired;
        write_job(&env, job_id, &job);
        Refunded {
            job_id,
            client: job.client,
            amount: job.budget,
        }
        .publish(&env);
        Ok(())
    }

    // ---- the ledger --------------------------------------------------------

    /// `account` pays `amount` of its balance out to `to`. A `G…` recipient
    /// must be able to receive the token (for a classic asset, hold a
    /// trustline); the native XLM contract needs none.
    pub fn withdraw_to(
        env: Env,
        account: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), SquareJobError> {
        account.require_auth();
        let amount = amount::to_record(amount).ok_or(SquareJobError::InvalidAmount)?;
        let balance = withdrawable(&env, &account);
        if amount > balance {
            return Err(SquareJobError::InsufficientBalance);
        }
        set_withdrawable(&env, &account, balance - amount);
        sub_total(&env, &DataKey::TotalWithdrawable, amount);
        ttl::extend_instance(&env, &ttl_config(&env));
        token::Client::new(&env, &config(&env).token).transfer(
            &env.current_contract_address(),
            &to,
            &amount::to_boundary(amount),
        );
        Withdrawn {
            account,
            to,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Owner only. Pays `to` whatever the kernel holds above the escrowed and
    /// withdrawable totals: tokens sent to it outside `fund`.
    pub fn skim(env: Env, to: Address) -> Result<(), SquareJobError> {
        owner::require_owner(&env);
        let unaccounted = unaccounted(&env);
        if unaccounted <= 0 {
            return Err(SquareJobError::NothingToSkim);
        }
        let amount = amount::to_record(unaccounted).ok_or(SquareJobError::InvalidAmount)?;
        token::Client::new(&env, &config(&env).token).transfer(
            &env.current_contract_address(),
            &to,
            &unaccounted,
        );
        ttl::extend_instance(&env, &ttl_config(&env));
        Skimmed { to, amount }.publish(&env);
        Ok(())
    }

    // ---- the owner ---------------------------------------------------------

    /// Owner only. Corrects the stored network values the TTL rules convert
    /// with (`square_common::ttl`).
    pub fn set_ttl_config(
        env: Env,
        ledger_close_ms: u32,
        min_persistent_ttl: u32,
    ) -> Result<(), SquareJobError> {
        owner::require_owner(&env);
        let ttl_config = TtlConfig {
            ledger_close_ms,
            min_persistent_ttl,
        };
        if !ttl_config.is_valid() {
            return Err(SquareJobError::InvalidTtlConfig);
        }
        env.storage().instance().set(&DataKey::Ttl, &ttl_config);
        ttl::extend_instance(&env, &ttl_config);
        Ok(())
    }

    /// Owner only. Offers ownership to `new_owner` until `live_until_ledger`.
    pub fn transfer_ownership(
        env: Env,
        new_owner: Address,
        live_until_ledger: u32,
    ) -> Result<(), OwnerError> {
        owner::transfer_ownership(&env, &new_owner, live_until_ledger)
    }

    /// The offered owner takes ownership while the offer is open.
    pub fn accept_ownership(env: Env) -> Result<(), OwnerError> {
        owner::accept_ownership(&env)
    }

    // ---- views -------------------------------------------------------------

    pub fn get_job(env: Env, job_id: u64) -> Result<Job, SquareJobError> {
        load_job(&env, job_id)
    }

    /// What `account` may `withdraw_to`.
    pub fn withdrawable(env: Env, account: Address) -> u64 {
        withdrawable(&env, &account)
    }

    /// The id of the last job created; zero before the first.
    pub fn job_counter(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::JobCounter)
            .unwrap_or(0)
    }

    pub fn config(env: Env) -> Config {
        config(&env)
    }

    pub fn ttl_config(env: Env) -> TtlConfig {
        ttl_config(&env)
    }

    pub fn owner(env: Env) -> Address {
        owner::owner(&env)
    }

    /// The sum of the budgets of Funded and Submitted jobs.
    pub fn total_escrowed(env: Env) -> u64 {
        total(&env, &DataKey::TotalEscrowed)
    }

    /// The sum of every `withdrawable` balance.
    pub fn total_withdrawable(env: Env) -> u64 {
        total(&env, &DataKey::TotalWithdrawable)
    }

    /// The token balance above the two totals; what `skim` would move.
    pub fn unaccounted(env: Env) -> i128 {
        unaccounted(&env)
    }
}

// ---- helpers ---------------------------------------------------------------

fn config(env: &Env) -> Config {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

fn ttl_config(env: &Env) -> TtlConfig {
    env.storage().instance().get(&DataKey::Ttl).unwrap()
}

fn load_job(env: &Env, job_id: u64) -> Result<Job, SquareJobError> {
    env.storage()
        .persistent()
        .get(&DataKey::Job(job_id))
        .ok_or(SquareJobError::InvalidJob)
}

/// Stores the job and applies the TTL rules: the record lives until
/// `expired_at` plus its window, with one window of slack (class J), and the
/// instance is refreshed (class G).
fn write_job(env: &Env, job_id: u64, job: &Job) {
    let key = DataKey::Job(job_id);
    env.storage().persistent().set(&key, job);
    let ttl_config = ttl_config(env);
    ttl::extend_job_scoped(
        env,
        &key,
        &ttl_config,
        job.expired_at.saturating_add(job.challenge_window),
        job.challenge_window,
    );
    ttl::extend_instance(env, &ttl_config);
}

fn finalize_after(job: &Job) -> u64 {
    job.submitted_at.saturating_add(job.challenge_window)
}

/// `budget × bps / 10_000`, rounded down; in `u128` so the product cannot
/// overflow.
fn fee_of(budget: u64, bps: u32) -> u64 {
    let fee = u128::from(budget) * u128::from(bps) / u128::from(BPS);
    // bps ≤ MAX_PLATFORM_FEE_BPS < BPS, so the fee is below the budget.
    fee as u64
}

fn withdrawable(env: &Env, account: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::Withdrawable(account.clone()))
        .unwrap_or(0)
}

fn set_withdrawable(env: &Env, account: &Address, balance: u64) {
    let key = DataKey::Withdrawable(account.clone());
    env.storage().persistent().set(&key, &balance);
    ttl::extend_global(env, &key, &ttl_config(env));
}

/// Adds to a balance and to the withdrawable total.
fn credit(env: &Env, account: &Address, amount: u64) {
    set_withdrawable(env, account, withdrawable(env, account) + amount);
    add_total(env, &DataKey::TotalWithdrawable, amount);
}

fn total(env: &Env, key: &DataKey) -> u64 {
    env.storage().instance().get(key).unwrap_or(0)
}

fn add_total(env: &Env, key: &DataKey, amount: u64) {
    env.storage()
        .instance()
        .set(key, &(total(env, key) + amount));
}

fn sub_total(env: &Env, key: &DataKey, amount: u64) {
    env.storage()
        .instance()
        .set(key, &(total(env, key) - amount));
}

fn unaccounted(env: &Env) -> i128 {
    let balance =
        token::Client::new(env, &config(env).token).balance(&env.current_contract_address());
    balance
        - amount::to_boundary(total(env, &DataKey::TotalEscrowed))
        - amount::to_boundary(total(env, &DataKey::TotalWithdrawable))
}

#[cfg(test)]
mod test;
