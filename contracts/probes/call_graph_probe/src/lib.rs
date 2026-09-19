//! A kernel stand-in that calls a hook the way docs/decisions/call-graph-on-soroban.md
//! decides: through `try_invoke_contract`, so the hook informs and cannot veto.
//! The hooks it is tested against live in `test.rs`.
#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Symbol};

/// What the kernel records about one hook call.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HookOutcome {
    /// The hook returned a u32, as the interface says.
    Returned(u32),
    /// The hook failed and the kernel carried on (on EVM: the `HookFailed` event).
    Failed,
}

#[contract]
pub struct KernelProbe;

#[contractimpl]
impl KernelProbe {
    /// Any read of kernel state; the hooks in the tests try to call it back.
    pub fn status(_env: Env) -> u32 {
        7
    }

    /// Calls `hook.after_action(kernel)` tolerantly.
    pub fn complete(env: Env, hook: Address) -> HookOutcome {
        let args = (env.current_contract_address(),).into_val(&env);
        match env.try_invoke_contract::<u32, soroban_sdk::Error>(&hook, &Symbol::new(&env, "after_action"), args) {
            Ok(Ok(value)) => HookOutcome::Returned(value),
            _ => {
                env.events().publish((symbol_short!("hookfail"),), hook);
                HookOutcome::Failed
            }
        }
    }

    /// ERC-165-style probing of an evaluator: `try_invoke_contract` on
    /// `settlement_horizon`, falling back to 0 when the call fails.
    pub fn horizon_of(env: Env, evaluator: Address) -> u32 {
        match env.try_invoke_contract::<u32, soroban_sdk::Error>(
            &evaluator,
            &Symbol::new(&env, "settlement_horizon"),
            soroban_sdk::vec![&env],
        ) {
            Ok(Ok(value)) => value,
            _ => 0,
        }
    }

    /// The EVM `try this.previewVerdict(...)` pattern: an external call to itself.
    pub fn call_self(env: Env) -> u32 {
        env.invoke_contract::<u32>(&env.current_contract_address(), &symbol_short!("status"), soroban_sdk::vec![&env])
    }
}

#[cfg(test)]
mod test;
