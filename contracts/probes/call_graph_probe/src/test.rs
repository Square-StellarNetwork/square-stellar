extern crate std;

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::Events as _, Env, Error};
use std::println;

/// Reads the kernel back while the kernel is on the stack: `SquareHook` reading
/// `SquareJob.getJobRecord` from inside `complete`.
#[contract]
pub struct CallbackHook;
#[contractimpl]
impl CallbackHook {
    pub fn after_action(env: Env, kernel: Address) -> u32 {
        env.invoke_contract::<u32>(&kernel, &symbol_short!("status"), soroban_sdk::vec![&env])
    }
}

/// `MaliciousHook` that reverts.
#[contract]
pub struct PanicHook;
#[contractimpl]
impl PanicHook {
    pub fn after_action(_env: Env, _kernel: Address) -> u32 {
        panic!("hook refuses")
    }
}

/// `MaliciousHook` that burns all the gas it is given; on Soroban, the budget.
#[contract]
pub struct BudgetHook;
#[contractimpl]
impl BudgetHook {
    pub fn after_action(env: Env, _kernel: Address) -> u32 {
        let mut acc = soroban_sdk::Bytes::new(&env);
        loop {
            acc.append(&soroban_sdk::Bytes::from_array(&env, &[0u8; 64]));
            let _ = env.crypto().sha256(&acc);
        }
    }
}

/// `MaliciousHook` whose return value does not decode as the interface's type.
#[contract]
pub struct WrongTypeHook;
#[contractimpl]
impl WrongTypeHook {
    pub fn after_action(env: Env, _kernel: Address) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, "not a u32")
    }
}

/// A hook that behaves: the baseline the others are compared with.
#[contract]
pub struct GoodHook;
#[contractimpl]
impl GoodHook {
    pub fn after_action(_env: Env, _kernel: Address) -> u32 {
        1
    }
}

fn setup<H>(hook: H) -> (Env, KernelProbeClient<'static>, Address)
where
    H: soroban_sdk::testutils::ContractFunctionSet + 'static,
{
    let env = Env::default();
    let kernel = env.register(KernelProbe, ());
    let hook = env.register(hook, ());
    let client = KernelProbeClient::new(&env, &kernel);
    (env, client, hook)
}

#[test]
fn a_hook_that_behaves_returns_its_value() {
    let (_env, kernel, hook) = setup(GoodHook);
    assert_eq!(kernel.complete(&hook), HookOutcome::Returned(1));
}

/// Soroban refuses the call back into the kernel; the kernel's try turns it into Failed.
#[test]
fn a_callback_into_the_kernel_is_refused_by_the_host() {
    let (env, kernel, hook) = setup(CallbackHook);
    assert_eq!(kernel.complete(&hook), HookOutcome::Failed);
    println!("events: {:?}", env.events().all());

    // Called directly, not through the kernel, the same read is allowed: the
    // refusal is about the kernel being on the stack, not about the read.
    let direct = CallbackHookClient::new(&env, &hook);
    assert_eq!(direct.after_action(&kernel.address), 7);
}

/// A contract calling itself is re-entry too.
#[test]
fn a_contract_calling_itself_is_refused() {
    let (_env, kernel, _) = setup(GoodHook);
    let result = kernel.try_call_self();
    println!("call_self: {:?}", result);
    let err: Error = result.unwrap_err().unwrap();
    assert_eq!(
        err,
        Error::from_type_and_code(soroban_sdk::xdr::ScErrorType::Context, soroban_sdk::xdr::ScErrorCode::InvalidAction)
    );
}

#[test]
fn a_panicking_hook_is_caught_and_the_kernel_carries_on() {
    let (_env, kernel, hook) = setup(PanicHook);
    assert_eq!(kernel.complete(&hook), HookOutcome::Failed);
}

#[test]
fn a_hook_returning_the_wrong_type_is_caught() {
    let (_env, kernel, hook) = setup(WrongTypeHook);
    assert_eq!(kernel.complete(&hook), HookOutcome::Failed);
}

/// Exhausting the budget is not an error the kernel can catch. The kernel's
/// `try_invoke_contract` sees it and the host escalates it; even the caller's
/// own `try_complete` gets no `Err` back, because the whole invocation is gone.
#[test]
fn a_hook_that_exhausts_the_budget_fails_the_whole_call() {
    let (env, kernel, hook) = setup(BudgetHook);
    env.cost_estimate().budget().reset_default();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| kernel.try_complete(&hook)));
    let message = match outcome {
        Ok(result) => panic!("the kernel returned instead of failing: {result:?}"),
        Err(payload) => payload
            .downcast_ref::<std::string::String>()
            .cloned()
            .or_else(|| payload.downcast_ref::<&str>().map(|s| std::string::String::from(*s)))
            .unwrap_or_default(),
    };
    println!("complete with a budget-eating hook: {}", message.lines().next().unwrap_or(""));
    assert!(message.contains("Error(Budget, ExceededLimit)"), "{message}");
}

/// A contract that does not have the probed function: caught, horizon 0.
#[test]
fn probing_a_contract_without_the_function_is_caught() {
    let (_env, kernel, hook) = setup(GoodHook);
    assert_eq!(kernel.horizon_of(&hook), 0);
}

/// An account (`G…`) is not a contract: `try_invoke_contract` does not catch
/// that, the whole caller fails; a `C…` address with nothing deployed is caught. Probing a human evaluator this way would make
/// `create_job` fail, so the kernel must check the address kind first.
#[test]
fn probing_an_account_address_fails_the_caller() {
    let (env, kernel, _) = setup(GoodHook);
    // Circle's testnet USDC issuer: a real account address (stellar-target.md).
    let account = Address::from_string(&soroban_sdk::String::from_str(
        &env,
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    ));
    // A contract address with nothing deployed at it is caught like any failure.
    let empty_contract = { use soroban_sdk::testutils::Address as _; Address::generate(&env) };
    assert_eq!(kernel.horizon_of(&empty_contract), 0);

    let result = kernel.try_horizon_of(&account);
    println!("horizon_of(G… account): {:?}", result);
    let err: Error = result.unwrap_err().unwrap();
    assert_eq!(
        err,
        Error::from_type_and_code(soroban_sdk::xdr::ScErrorType::Context, soroban_sdk::xdr::ScErrorCode::InvalidAction)
    );
}

/// `Address::executable()` tells the cases apart without calling: the check
/// the kernel makes before probing a hook or an evaluator.
#[test]
fn executable_tells_contract_account_and_asset_apart() {
    use soroban_sdk::{testutils::Address as _, Executable};
    let (env, kernel, _) = setup(GoodHook);
    let account = Address::from_string(&soroban_sdk::String::from_str(
        &env,
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    ));
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let nothing = Address::generate(&env);
    println!("kernel {:?} | account {:?} | sac {:?} | empty {:?}",
        kernel.address.executable(), account.executable(), sac.executable(), nothing.executable());
    assert!(matches!(kernel.address.executable(), Some(Executable::Wasm(_))));
    assert_eq!(account.executable(), None, "an account with no ledger entry");
    assert_eq!(sac.executable(), Some(Executable::StellarAsset));
    assert_eq!(nothing.executable(), None);
}
