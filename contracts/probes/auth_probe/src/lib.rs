//! One contract standing in for three roles of docs/decisions/auth-and-token-flow.md,
//! so a single deployment shows every authorization shape the decision relies on:
//!
//! - `fund`: the kernel pulls the client's tokens with no `approve`. The client
//!   authorizes `fund` and, beneath it, the token's `transfer` to the kernel.
//! - `dispute` -> `open`: a second instance plays the arbitration contract. The
//!   disputer's one signature covers `dispute`, the nested `open` and the bond
//!   `transfer` inside it.
//! - `finalize` -> `complete`: the contract calls a second instance as its
//!   evaluator; `evaluator.require_auth()` is satisfied because the caller is
//!   that contract, with no signature at all.
#![no_std]

use soroban_sdk::{contract, contractimpl, token, Address, Env, IntoVal, Symbol};

#[contract]
pub struct AuthProbe;

#[contractimpl]
impl AuthProbe {
    /// The kernel's `fund`: no allowance, the transfer is part of the client's authorization.
    pub fn fund(env: Env, client: Address, token: Address, amount: i128) {
        client.require_auth();
        token::Client::new(&env, &token).transfer(&client, &env.current_contract_address(), &amount);
    }

    /// `Arbitration.open`: the disputer pays the bond to this contract.
    pub fn open(env: Env, disputer: Address, token: Address, bond: i128) {
        disputer.require_auth();
        token::Client::new(&env, &token).transfer(&disputer, &env.current_contract_address(), &bond);
    }

    /// `KeeperEvaluator.dispute`: forwards to the arbitration contract.
    pub fn dispute(env: Env, disputer: Address, arbitration: Address, token: Address, bond: i128) {
        disputer.require_auth();
        env.invoke_contract::<()>(
            &arbitration,
            &Symbol::new(&env, "open"),
            (disputer, token, bond).into_val(&env),
        );
    }

    /// `SquareJob.complete`: only the job's evaluator may call it.
    pub fn complete(_env: Env, evaluator: Address) -> bool {
        evaluator.require_auth();
        true
    }

    /// `KeeperEvaluator.finalize`: anyone may crank it; the evaluator is this contract.
    pub fn finalize(env: Env, kernel: Address) -> bool {
        env.invoke_contract::<bool>(
            &kernel,
            &Symbol::new(&env, "complete"),
            (env.current_contract_address(),).into_val(&env),
        )
    }
}
