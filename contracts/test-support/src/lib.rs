//! What the contracts' tests stand on (#8). Test-only and never deployed, and
//! nothing in it pretends to be something else:
//!
//! - [`account`]: `G…` accounts with real ed25519 keys whose signatures the
//!   host verifies, and the authorization entries they sign. No test uses the
//!   SDK's auth bypass.
//! - [`usdc`]: USDC on the host's own Stellar Asset Contract, with a real
//!   issuer account, trustlines through `trust` and signed `mint`s.
//! - [`hostile`]: the adversarial hooks of
//!   docs/decisions/call-graph-on-soroban.md.
//!

pub mod account;
pub mod hostile;
pub mod usdc;

pub use account::{authorize, call, Account, Invocation};
pub use hostile::{
    HostileError, HostileHook, HostileHookClient, Mode, WrongTypeHook, WrongTypeHookClient,
};
pub use usdc::Usdc;

#[cfg(test)]
mod test;
