use soroban_sdk::contracttype;

/// `keeper_evaluator`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum KeeperEvaluatorKey {
    /// instance: the kernel, fixed at construction (`_squareJob`).
    SquareJob,
    /// instance: the arbitration contract, set once (`_arbitration`).
    Arbitration,
    /// instance: `u32`, how many windows have been pushed.
    WindowCount,
    /// persistent, G: `Window`, append-only (`_windows`).
    Window(u32),
    /// persistent, D: `DisputeRef` (`_disputes`).
    Dispute(u64),
}
