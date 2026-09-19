//! Ledger-entry TTL, docs/decisions/fees-and-ttl.md decision 4.
//!
//! A contract can read the ledger sequence, the timestamp and
//! `max_live_until_ledger`, but not the network's configuration. So each
//! contract keeps in instance storage the two values its rules need,
//! [`TtlConfig`], set by the deploy script from the network's
//! `CONFIG_SETTING_SCP_TIMING.ledgerTargetCloseTimeMilliseconds` and
//! `CONFIG_SETTING_STATE_ARCHIVAL.minPersistentTtl`, and corrected by the
//! owner's `set_ttl_config` when the network's values drift. No ledger count
//! is typed in here: seconds become ledgers through `ledger_close_ms`, caps
//! come from `max_ttl()`, and the refresh threshold for global state is
//! `min_persistent_ttl`.
//!
//! Two of the decision's four classes are used by the kernel:
//! - **J, job-scoped** ([`extend_job_scoped`]): an entry keyed by a job id
//!   lives until the moment the protocol next expects it to be touched, the
//!   job's `expired_at` plus its settlement horizon, with one more horizon of
//!   slack so small pacing drifts never cost an extension.
//! - **G, global** ([`extend_global`], [`extend_instance`]): balances,
//!   settings and the instance are refreshed to `min_persistent_ttl` whenever
//!   a write finds them below it.
//!
//! An extension is never an error: if the numbers say the entry already lives
//! long enough, nothing happens. Archival never loses state (decision 4,
//! principle 2), so a wrong `TtlConfig` costs a restore, not funds.

use soroban_sdk::{contracttype, Env, IntoVal, Val};

/// The two network values the TTL rules convert with.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TtlConfig {
    /// `ledgerTargetCloseTimeMilliseconds`; 5,000 on testnet and pubnet.
    pub ledger_close_ms: u32,
    /// `minPersistentTtl`, in ledgers; 120,960 on testnet (about 7 days).
    pub min_persistent_ttl: u32,
}

impl TtlConfig {
    /// Both values must be positive: a zero close time cannot convert and a
    /// zero minimum would never refresh anything.
    pub fn is_valid(&self) -> bool {
        self.ledger_close_ms > 0 && self.min_persistent_ttl > 0
    }

    /// `ceil(seconds × 1000 / ledger_close_ms)`, saturating at `u32::MAX`.
    pub fn ledgers_for(&self, seconds: u64) -> u32 {
        let close_ms = u128::from(self.ledger_close_ms.max(1));
        let ledgers = (u128::from(seconds) * 1000).div_ceil(close_ms);
        u32::try_from(ledgers).unwrap_or(u32::MAX)
    }

    /// Ledgers from `now` until the timestamp `until`; zero once it has
    /// passed.
    pub fn ledgers_until(&self, now: u64, until: u64) -> u32 {
        if until > now {
            self.ledgers_for(until - now)
        } else {
            0
        }
    }
}

/// Class J. Extends the persistent entry under `key` so that it lives until
/// `end` (a timestamp), with `horizon` seconds of slack, capped at `max_ttl`.
/// A no-op once `end` has passed.
pub fn extend_job_scoped<K: IntoVal<Env, Val>>(
    env: &Env,
    key: &K,
    cfg: &TtlConfig,
    end: u64,
    horizon: u64,
) {
    let now = env.ledger().timestamp();
    let max = env.storage().max_ttl();
    let threshold = cfg.ledgers_until(now, end).min(max);
    if threshold == 0 {
        return;
    }
    let extend_to = threshold.saturating_add(cfg.ledgers_for(horizon)).min(max);
    env.storage()
        .persistent()
        .extend_ttl(key, threshold, extend_to);
}

/// Class G, for a persistent entry: refreshed to `min_persistent_ttl` when it
/// is below it.
pub fn extend_global<K: IntoVal<Env, Val>>(env: &Env, key: &K, cfg: &TtlConfig) {
    let ledgers = cfg.min_persistent_ttl.min(env.storage().max_ttl());
    env.storage().persistent().extend_ttl(key, ledgers, ledgers);
}

/// Class G, for the contract instance and everything in instance storage.
pub fn extend_instance(env: &Env, cfg: &TtlConfig) {
    let ledgers = cfg.min_persistent_ttl.min(env.storage().max_ttl());
    env.storage().instance().extend_ttl(ledgers, ledgers);
}

#[cfg(test)]
mod test {
    use super::*;

    const TESTNET: TtlConfig = TtlConfig {
        ledger_close_ms: 5_000,
        min_persistent_ttl: 120_960,
    };

    #[test]
    fn seconds_to_ledgers() {
        assert_eq!(TESTNET.ledgers_for(0), 0);
        assert_eq!(TESTNET.ledgers_for(1), 1);
        assert_eq!(TESTNET.ledgers_for(5), 1);
        assert_eq!(TESTNET.ledgers_for(6), 2);
        // The decision's worked numbers: a 1,020 s horizon is 204 ledgers, an
        // expiry one day out is 17,280 and 30 days out 518,400.
        assert_eq!(TESTNET.ledgers_for(1_020), 204);
        assert_eq!(TESTNET.ledgers_for(86_400), 17_280);
        assert_eq!(TESTNET.ledgers_for(30 * 86_400), 518_400);
        assert_eq!(TESTNET.ledgers_for(u64::MAX), u32::MAX);
    }

    #[test]
    fn until_a_timestamp() {
        assert_eq!(TESTNET.ledgers_until(100, 100), 0);
        assert_eq!(TESTNET.ledgers_until(100, 50), 0);
        assert_eq!(TESTNET.ledgers_until(100, 105), 1);
        assert_eq!(TESTNET.ledgers_until(100, 111), 3);
    }

    #[test]
    fn validity() {
        assert!(TESTNET.is_valid());
        assert!(!TtlConfig {
            ledger_close_ms: 0,
            min_persistent_ttl: 1
        }
        .is_valid());
        assert!(!TtlConfig {
            ledger_close_ms: 1,
            min_persistent_ttl: 0
        }
        .is_valid());
        // A zero close time cannot divide; the conversion still returns.
        assert_eq!(
            TtlConfig {
                ledger_close_ms: 0,
                min_persistent_ttl: 1
            }
            .ledgers_for(7),
            7_000
        );
    }
}
