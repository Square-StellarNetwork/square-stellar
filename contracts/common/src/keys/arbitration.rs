use soroban_sdk::{contracttype, Address, BytesN};

/// `arbitration`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ArbitrationKey {
    /// instance: the USDC SAC bonds are paid in (`_token`).
    Token,
    /// instance: the keeper evaluator that opens disputes (`_keeperEvaluator`).
    KeeperEvaluator,
    /// instance: the kernel (`_squareJob`).
    SquareJob,
    /// instance: `u32`, the arbiter set version new disputes open under (`_currentVersion`).
    CurrentVersion,
    /// instance: `u32` (`_bondBps`).
    BondBps,
    /// instance: `u64` (`_minBond`).
    MinBond,
    /// persistent, G: `Vec<Address>`, the arbiters of a version (`_arbiters`).
    Arbiters(u32),
    /// persistent, G: `u32` (`_threshold`).
    Threshold(u32),
    /// persistent, G: `u32`, an arbiter's index plus one in a version (`_indexPlusOne`).
    ArbiterIndex(u32, Address),
    /// persistent, D: `Dispute` (`_disputes`).
    Dispute(u64),
    /// persistent, D: `U256`, the vote bitmask of one resolution (`_approvals`).
    Approval(u64, BytesN<32>),
    /// persistent, D of the crediting dispute: `i128` (`_withdrawable`); removed at zero.
    Withdrawable(Address),
}
