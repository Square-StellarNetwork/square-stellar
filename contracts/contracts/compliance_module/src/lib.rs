//! Binds a compliance proof to a job and advances the counter (B5, #12).
//!
//! Skeleton only (#7). The contract's interface and storage are written in its
//! B-cluster issue; until then it compiles to a Wasm with no functions, which
//! is what `stellar contract build`, the bindings and the no-upgrade check
//! need to have something to run against.
#![no_std]

use soroban_sdk::contract;

#[contract]
pub struct ComplianceModule;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn registers() {
        let env = Env::default();
        let id = env.register(ComplianceModule, ());
        assert!(env.as_contract(&id, || true));
    }
}
