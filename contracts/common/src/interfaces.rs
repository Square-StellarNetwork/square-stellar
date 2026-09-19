//! The cross-contract interfaces, as `#[contractclient]` traits. Each contract
//! implements its trait with exactly these signatures, and every caller uses
//! the generated client, so a mismatch fails to compile instead of trapping
//! on chain. Signatures follow docs/decisions/call-graph-on-soroban.md (#3)
//! and auth-and-token-flow.md (#5): the signer comes first where there is one.

use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env, Symbol, Vec, U256};

use crate::types::{
    Action, BeforeOutcome, CompleteParams, HookContext, JobRecord, Outcome, Policy, ProofState,
    Release, ScreeningRecord, Verdict,
};

/// `square_hook`, as the kernel, the keeper and the claim market see it.
#[contractclient(name = "HookClient")]
pub trait Hook {
    fn supports(env: Env, interface: Symbol) -> bool;
    fn before_action(env: Env, ctx: HookContext, action: Action) -> BeforeOutcome;
    fn after_action(env: Env, ctx: HookContext, action: Action, before: BeforeOutcome);
    fn resolve_payout(env: Env, ctx: HookContext, params: CompleteParams) -> (Address, u32);
    fn proof_state(env: Env, job_id: u64) -> ProofState;
    fn payout_market(env: Env) -> Option<Address>;
}

/// `compliance_module`, as the hook sees it.
#[contractclient(name = "ComplianceClient")]
pub trait Compliance {
    fn preview_release(env: Env, release: Release, proof: Bytes) -> bool;
    fn check_release(env: Env, hook: Address, release: Release, proof: Bytes) -> bool;
    fn proof_state(env: Env, proof: Bytes) -> ProofState;
    fn policy_registry(env: Env) -> Address;
}

/// `groth16_verifier`.
#[contractclient(name = "VerifierClient")]
pub trait Verifier {
    fn verify_proof(
        env: Env,
        a: BytesN<64>,
        b: BytesN<128>,
        c: BytesN<64>,
        input: Vec<U256>,
    ) -> bool;
}

/// `policy_registry`, as the compliance module, the hook and the claim market see it.
#[contractclient(name = "PolicyRegistryClient")]
pub trait PolicyRegistry {
    fn commitment_of(env: Env, poster: Address) -> Option<BytesN<32>>;
    fn policy_of(env: Env, poster: Address) -> Option<Policy>;
    fn spent_today(env: Env, poster: Address) -> u128;
    fn is_spender(env: Env, spender: Address) -> bool;
    fn record_spend(env: Env, spender: Address, poster: Address, amount: u128) -> (u128, Verdict);
    fn buyer_root_of(env: Env, poster: Address) -> Option<BytesN<32>>;
}

/// `screening_registry`, as the hook sees it.
#[contractclient(name = "ScreeningClient")]
pub trait ScreeningRegistry {
    fn is_cleared(env: Env, subject: Address) -> bool;
    fn screening_of(env: Env, subject: Address) -> Option<ScreeningRecord>;
}

/// `claim_market`, as the hook sees it.
#[contractclient(name = "MarketClient")]
pub trait Market {
    fn payee_of(env: Env, job_id: u64, provider: Address) -> Address;
}

/// `square_job`, as the keeper evaluator, arbitration, the claim market and
/// `square_hook.record_expiry` see it: only ever called while the kernel is
/// not on the stack.
#[contractclient(name = "KernelClient")]
pub trait Kernel {
    fn get_job_record(env: Env, job_id: u64) -> JobRecord;
    fn complete(
        env: Env,
        evaluator: Address,
        job_id: u64,
        reason: BytesN<32>,
        params: CompleteParams,
    );
    fn reject(env: Env, caller: Address, job_id: u64, reason: BytesN<32>);
    fn claim_refund(env: Env, job_id: u64);
    fn withdraw_to(env: Env, account: Address, to: Address, amount: i128);
    fn withdrawable(env: Env, account: Address) -> i128;
    fn net_payout(env: Env, job_id: u64) -> i128;
    fn payment_token(env: Env) -> Address;
    fn compliance_proof_of(env: Env, job_id: u64) -> Bytes;
}

/// `keeper_evaluator`, as the kernel, arbitration and the claim market see it.
#[contractclient(name = "KeeperEvaluatorClient")]
pub trait KeeperEvaluator {
    fn settlement_horizon(env: Env) -> u64;
    fn square_job(env: Env) -> Address;
    fn is_disputed(env: Env, job_id: u64) -> bool;
    fn apply_rejection(env: Env, job_id: u64, resolution_hash: BytesN<32>);
}

/// `arbitration`, as the keeper evaluator sees it.
#[contractclient(name = "ArbitrationClient")]
pub trait Arbitration {
    fn open(
        env: Env,
        job_id: u64,
        disputer: Address,
        budget: u64,
        resolve_by: u64,
        evidence: BytesN<32>,
    );
    fn decision(env: Env, job_id: u64) -> (Outcome, u32, Option<BytesN<32>>);
    fn settle_bond(env: Env, job_id: u64);
}
