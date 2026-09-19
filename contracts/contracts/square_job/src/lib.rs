//! Job kernel: state machine, pull-payment ledger, hook calls (B2, #9).
//!
//! Skeleton only (#7). The contract's interface and storage are written in its
//! B-cluster issue; until then it compiles to a Wasm with no functions, which
//! is what `stellar contract build`, the bindings and the no-upgrade check
//! need to have something to run against.
#![no_std]

use soroban_sdk::contract;

#[contract]
pub struct SquareJob;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn registers() {
        let env = Env::default();
        let id = env.register(SquareJob, ());
        assert!(env.as_contract(&id, || true));
    }
}
