//! TTL policy (docs/decisions/fees-and-ttl.md, #6). No ledger count is a
//! literal: every number is a job field, a stored network value, or `max_ttl()`.

use soroban_sdk::{
    contracterror, contractevent, contracttype, panic_with_error, symbol_short, Env, IntoVal,
    Symbol, Val,
};

use crate::types::JobRecord;

const TTL_CONFIG: Symbol = symbol_short!("ttl_cfg");

/// Codes 910+, shared like `owner::OwnerError`.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TtlError {
    ConfigMissing = 910,
    InvalidConfig = 911,
}

/// Read from the network's CONFIG_SETTING entries by the deploy scripts (#19)
/// and passed to `__constructor`; `set_ttl_config` (owner) updates it.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TtlConfig {
    /// CONFIG_SETTING_SCP_TIMING.ledgerTargetCloseTimeMilliseconds
    pub ledger_close_ms: u32,
    /// CONFIG_SETTING_STATE_ARCHIVAL.minPersistentTtl
    pub min_persistent_ttl: u32,
}

/// The `TtlConfig` in force, from `__constructor` and every `set_ttl_config`.
#[contractevent]
pub struct TtlConfigUpdated {
    pub ledger_close_ms: u32,
    pub min_persistent_ttl: u32,
}

/// Stores `cfg`, from `__constructor` or from a contract's owner-only
/// `set_ttl_config` (the caller checks the owner). Refuses a zero close time
/// or a zero minimum TTL: both come from the network and neither can be zero
/// there.
pub fn set_config(env: &Env, cfg: &TtlConfig) {
    if cfg.ledger_close_ms == 0 || cfg.min_persistent_ttl == 0 {
        panic_with_error!(env, TtlError::InvalidConfig);
    }
    env.storage().instance().set(&TTL_CONFIG, cfg);
    TtlConfigUpdated {
        ledger_close_ms: cfg.ledger_close_ms,
        min_persistent_ttl: cfg.min_persistent_ttl,
    }
    .publish(env);
}

pub fn config(env: &Env) -> TtlConfig {
    env.storage()
        .instance()
        .get(&TTL_CONFIG)
        .unwrap_or_else(|| panic_with_error!(env, TtlError::ConfigMissing))
}

pub fn ledgers_for(cfg: &TtlConfig, seconds: u64) -> u32 {
    let ms = seconds.saturating_mul(1000);
    let close = u64::from(cfg.ledger_close_ms);
    u32::try_from(ms.div_ceil(close)).unwrap_or(u32::MAX)
}

pub fn ledgers_until(env: &Env, cfg: &TtlConfig, ts: u64) -> u32 {
    let now = env.ledger().timestamp();
    if ts <= now {
        0
    } else {
        ledgers_for(cfg, ts - now)
    }
}

/// Class U: keep `key` live at least until `end` (a timestamp).
pub fn extend_until<K: IntoVal<Env, Val>>(env: &Env, cfg: &TtlConfig, key: &K, end: u64) {
    let t = ledgers_until(env, cfg, end).min(env.storage().max_ttl());
    if t > 0 {
        env.storage().persistent().extend_ttl(key, t, t);
    }
}

/// Classes J and D: keep `key` live until `end + horizon`, with one horizon of slack.
pub fn extend_for_settlement<K: IntoVal<Env, Val>>(
    env: &Env,
    cfg: &TtlConfig,
    key: &K,
    end: u64,
    horizon: u64,
) {
    let max = env.storage().max_ttl();
    let t = ledgers_until(env, cfg, end.saturating_add(horizon)).min(max);
    if t > 0 {
        let to = t.saturating_add(ledgers_for(cfg, horizon)).min(max);
        env.storage().persistent().extend_ttl(key, t, to);
    }
}

/// Class J: a key the job `job` owns lives until the job's expiry plus its
/// settlement horizon, with one horizon of slack. Called on every write, and
/// on every read inside a state-changing call.
pub fn bump_job<K: IntoVal<Env, Val>>(env: &Env, cfg: &TtlConfig, key: &K, job: &JobRecord) {
    extend_for_settlement(env, cfg, key, job.expired_at, job.settlement_horizon);
}

/// Class D: a per-dispute key lives until the later of the job's expiry and
/// the dispute's `resolve_by`, plus the job's settlement horizon.
pub fn bump_dispute<K: IntoVal<Env, Val>>(
    env: &Env,
    cfg: &TtlConfig,
    key: &K,
    job: &JobRecord,
    resolve_by: u64,
) {
    extend_for_settlement(
        env,
        cfg,
        key,
        job.expired_at.max(resolve_by),
        job.settlement_horizon,
    );
}

/// Class G setters: a fresh write lives at least as long as a fresh entry.
pub fn extend_config<K: IntoVal<Env, Val>>(env: &Env, cfg: &TtlConfig, key: &K) {
    let t = cfg.min_persistent_ttl.min(env.storage().max_ttl());
    env.storage().persistent().extend_ttl(key, t, t);
}

/// Owner transactions extend the instance only, never the code.
pub fn extend_instance(env: &Env, cfg: &TtlConfig) {
    let to = cfg
        .min_persistent_ttl
        .saturating_mul(2)
        .min(env.storage().max_ttl());
    let threshold = cfg.min_persistent_ttl.min(to);
    env.storage().instance().extend_ttl(threshold, to);
}
