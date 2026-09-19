//! Codes `square_hook` puts in its events, where the EVM hook used `uint8`
//! and `bytes32` constants (`SquareHook.sol:33-35, 488-498`).

use soroban_sdk::{contracttype, Env, Symbol};

/// The feedback a job earned its provider agent: `+1`, `-1` or `0`
/// (`SquareHook.sol:497`).
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ReputationOutcome {
    Completed = 1,
    Rejected = 2,
    Expired = 3,
}

/// Why positive feedback was deliberately not written
/// (`SKIP_UNTRUSTED_EVALUATOR`, `SKIP_BUDGET_BELOW_MINIMUM`). On the wire
/// (`ReputationSkipped.reason`) each is its [`SkipReason::text`], the EVM
/// text with spaces as underscores.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SkipReason {
    UntrustedEvaluator,
    BudgetBelowMinimum,
}

impl SkipReason {
    pub const fn text(self) -> &'static str {
        match self {
            Self::UntrustedEvaluator => "untrusted_evaluator",
            Self::BudgetBelowMinimum => "budget_below_minimum",
        }
    }

    pub fn symbol(self, env: &Env) -> Symbol {
        Symbol::new(env, self.text())
    }
}
