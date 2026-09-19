use soroban_sdk::contracttype;

/// `claim_market`. No owner.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClaimMarketKey {
    /// instance: the kernel (`_squareJob`).
    SquareJob,
    /// instance: the keeper evaluator (`_keeperEvaluator`).
    KeeperEvaluator,
    /// instance: the USDC SAC the price is paid in (`_token`).
    Token,
    /// instance: where each poster's buyer root is read (`_policyRegistry`).
    PolicyRegistry,
    /// persistent, J: `Listing` (`_listings`).
    Listing(u64),
}
