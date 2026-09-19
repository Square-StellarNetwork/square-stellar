//! Hooks that attack the kernel, the Soroban counterparts of
//! the EVM suite's `MaliciousHook.sol` and the failure modes of
//! docs/decisions/call-graph-on-soroban.md, decision 5. They are adversaries,
//! not stand-ins for `square_hook`: each is a real contract the kernel really
//! calls, and each writes to its own storage and publishes an event before it
//! misbehaves, so a test can see that a caught failure took those with it.
//!
//! [`HostileHook`] also records the `BeforeOutcome` the kernel hands to
//! `after_action`, which is how #18 checks the two properties that replaced
//! `KernelBatcher.sol`: `after_action` receives exactly what `before_action`
//! returned in the same call, and a failed `before_action` arrives as
//! all-`NotRun`.

use soroban_sdk::xdr::{ScErrorCode, ScErrorType};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Bytes, BytesN, Env, Error, InvokeError, Symbol,
};
use square_common::interfaces::KernelClient;
use square_common::types::{
    Action, BeforeOutcome, CheckOutcome, CompleteParams, HookContext, ProofState,
};

/// How [`HostileHook`] behaves. The EVM `MaliciousHook` modes, by name.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Mode {
    /// Answers every call: `before_action` returns the stored answer,
    /// `resolve_payout` names the provider at 10 000 bps.
    Quiet,
    /// Every entry point panics with `HostileError::HookSaysNo` (EVM `Revert`).
    Panic,
    /// `before_action` panics; everything else answers as `Quiet`.
    PanicBefore,
    /// The callbacks try the kernel's `complete` and record the refusal.
    ReenterComplete,
    /// The callbacks try the kernel's `withdraw_to` and record the refusal.
    ReenterWithdraw,
    /// The callbacks try the kernel's `claim_refund` and record the refusal.
    ReenterClaimRefund,
    /// Every entry point spends the budget until the host stops the
    /// transaction (EVM `Loop`).
    Exhaust,
    /// `resolve_payout` names the kernel itself as the payee.
    BadPayee,
    /// `resolve_payout` returns 10 001 bps.
    BadSplit,
    /// `resolve_payout` pays this address at 10 000 bps.
    StealPayout(Address),
    /// `resolve_payout` panics; the callbacks answer (EVM `ResolverReverts`).
    ResolverPanics,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum HostileError {
    HookSaysNo = 1,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum Key {
    Kernel,
    Mode,
    Answer,
    Calls,
    Received,
    Reentry,
}

/// Published by every entry point before it acts on its mode.
#[contractevent]
pub struct HostileCalled {
    pub hook_fn: Symbol,
    pub calls: u32,
}

#[contract]
pub struct HostileHook;

#[contractimpl]
impl HostileHook {
    pub fn __constructor(env: Env, kernel: Address, mode: Mode) {
        env.storage().instance().set(&Key::Kernel, &kernel);
        env.storage().instance().set(&Key::Mode, &mode);
        env.storage().instance().set(&Key::Answer, &not_run());
    }

    /// The test drives its own adversary: no authorization.
    pub fn set_mode(env: Env, mode: Mode) {
        env.storage().instance().set(&Key::Mode, &mode);
    }

    /// What `before_action` returns while the mode lets it answer.
    pub fn set_answer(env: Env, answer: BeforeOutcome) {
        env.storage().instance().set(&Key::Answer, &answer);
    }

    /// How many entry points ran to completion or to their failure.
    pub fn calls(env: Env) -> u32 {
        env.storage().instance().get(&Key::Calls).unwrap_or(0)
    }

    /// The `BeforeOutcome` the last `after_action` received.
    pub fn received(env: Env) -> Option<BeforeOutcome> {
        env.storage().instance().get(&Key::Received)
    }

    /// The error the last re-entry attempt was refused with.
    pub fn reentry(env: Env) -> Option<Error> {
        env.storage().instance().get(&Key::Reentry)
    }

    pub fn supports(env: Env, interface: Symbol) -> bool {
        interface == Symbol::new(&env, "IACPHook")
            || interface == Symbol::new(&env, "IPayoutResolver")
    }

    pub fn before_action(env: Env, ctx: HookContext, _action: Action) -> BeforeOutcome {
        let mode = enter(&env, "before_action");
        match mode {
            Mode::Panic | Mode::PanicBefore => panic_with_error!(&env, HostileError::HookSaysNo),
            Mode::Exhaust => exhaust(&env),
            Mode::ReenterComplete | Mode::ReenterWithdraw | Mode::ReenterClaimRefund => {
                reenter(&env, &mode, &ctx)
            }
            _ => {}
        }
        env.storage()
            .instance()
            .get(&Key::Answer)
            .unwrap_or_else(not_run)
    }

    pub fn after_action(env: Env, ctx: HookContext, _action: Action, before: BeforeOutcome) {
        let mode = enter(&env, "after_action");
        env.storage().instance().set(&Key::Received, &before);
        match mode {
            Mode::Panic => panic_with_error!(&env, HostileError::HookSaysNo),
            Mode::Exhaust => exhaust(&env),
            Mode::ReenterComplete | Mode::ReenterWithdraw | Mode::ReenterClaimRefund => {
                reenter(&env, &mode, &ctx)
            }
            _ => {}
        }
    }

    pub fn resolve_payout(env: Env, ctx: HookContext, _params: CompleteParams) -> (Address, u32) {
        let provider = ctx
            .provider
            .clone()
            .unwrap_or_else(|| panic_with_error!(&env, HostileError::HookSaysNo));
        match mode(&env) {
            Mode::Panic | Mode::ResolverPanics => panic_with_error!(&env, HostileError::HookSaysNo),
            Mode::Exhaust => exhaust(&env),
            Mode::BadPayee => (kernel(&env), 10_000),
            Mode::BadSplit => (provider, 10_001),
            Mode::StealPayout(thief) => (thief, 10_000),
            _ => (provider, 10_000),
        }
    }

    pub fn proof_state(env: Env, _job_id: u64) -> ProofState {
        match mode(&env) {
            Mode::Panic => panic_with_error!(&env, HostileError::HookSaysNo),
            Mode::Exhaust => exhaust(&env),
            _ => ProofState::NotGated,
        }
    }

    pub fn payout_market(env: Env) -> Option<Address> {
        match mode(&env) {
            Mode::Panic => panic_with_error!(&env, HostileError::HookSaysNo),
            Mode::Exhaust => exhaust(&env),
            _ => None,
        }
    }
}

fn not_run() -> BeforeOutcome {
    BeforeOutcome {
        compliance: CheckOutcome::NotRun,
        screening: CheckOutcome::NotRun,
        screening_commitment: None,
        policy_pin: None,
    }
}

fn mode(env: &Env) -> Mode {
    env.storage()
        .instance()
        .get(&Key::Mode)
        .unwrap_or(Mode::Quiet)
}

fn kernel(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&Key::Kernel)
        .unwrap_or_else(|| panic_with_error!(env, HostileError::HookSaysNo))
}

/// Writes and publishes, so a caught failure has something to roll back.
fn record(env: &Env, hook_fn: &str) -> u32 {
    let calls = env
        .storage()
        .instance()
        .get::<_, u32>(&Key::Calls)
        .unwrap_or(0)
        + 1;
    env.storage().instance().set(&Key::Calls, &calls);
    HostileCalled {
        hook_fn: Symbol::new(env, hook_fn),
        calls,
    }
    .publish(env);
    calls
}

fn enter(env: &Env, hook_fn: &str) -> Mode {
    record(env, hook_fn);
    mode(env)
}

/// Host calls until the budget runs out: a native test contract spends the
/// budget only through the host, so a plain Rust loop would spin forever.
fn exhaust(env: &Env) -> ! {
    let mut acc = Bytes::from_slice(env, b"square.hostile.exhaust");
    loop {
        let digest: BytesN<32> = env.crypto().sha256(&acc).into();
        acc.append(&Bytes::from(digest));
    }
}

fn reenter(env: &Env, mode: &Mode, ctx: &HookContext) {
    let kernel = KernelClient::new(env, &kernel(env));
    let me = env.current_contract_address();
    let reason: BytesN<32> = env
        .crypto()
        .keccak256(&Bytes::from_slice(env, b"square.hostile.reenter"))
        .into();
    let refused = match mode {
        Mode::ReenterComplete => kernel
            .try_complete(
                &ctx.evaluator,
                &ctx.job_id,
                &reason,
                &CompleteParams {
                    provider_bps: 10_000,
                },
            )
            .err(),
        Mode::ReenterWithdraw => kernel.try_withdraw_to(&me, &me, &1).err(),
        Mode::ReenterClaimRefund => kernel.try_claim_refund(&ctx.job_id).err(),
        _ => None,
    };
    if let Some(refusal) = refused {
        let error = match refusal {
            Ok(error) => error,
            Err(InvokeError::Contract(code)) => Error::from_contract_error(code),
            Err(InvokeError::Abort) => {
                Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
            }
        };
        env.storage().instance().set(&Key::Reentry, &error);
    }
}

/// A hook whose every answer has the wrong type: the `Ok(Err(ConversionError))`
/// row of call-graph-on-soroban.md's failure table. Each entry point writes and
/// publishes first, like [`HostileHook`].
#[contract]
pub struct WrongTypeHook;

#[contractimpl]
impl WrongTypeHook {
    pub fn calls(env: Env) -> u32 {
        env.storage().instance().get(&Key::Calls).unwrap_or(0)
    }

    pub fn supports(_env: Env, _interface: Symbol) -> bool {
        true
    }

    pub fn before_action(env: Env, _ctx: HookContext, _action: Action) -> u32 {
        record(&env, "before_action")
    }

    pub fn after_action(
        env: Env,
        _ctx: HookContext,
        _action: Action,
        _before: BeforeOutcome,
    ) -> u32 {
        record(&env, "after_action")
    }

    pub fn resolve_payout(env: Env, _ctx: HookContext, _params: CompleteParams) -> bool {
        record(&env, "resolve_payout");
        true
    }

    pub fn proof_state(env: Env, _job_id: u64) -> u32 {
        record(&env, "proof_state")
    }

    pub fn payout_market(env: Env) -> u32 {
        record(&env, "payout_market")
    }
}
