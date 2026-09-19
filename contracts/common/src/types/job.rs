//! The job, and the types the kernel, the hook, the compliance module and the
//! claim market exchange (docs/decisions/call-graph-on-soroban.md, #3). Amounts
//! crossing a contract boundary are `i128` (SEP-41); stored amounts are `u64`
//! (auth-and-token-flow.md, decision 7).

use soroban_sdk::{contracttype, Address, Bytes, BytesN, String};

/// `ISquareJob.JobStatus`, same order.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobStatus {
    Open,
    Funded,
    Submitted,
    Completed,
    Rejected,
    Expired,
}

/// `ISquareJob.JobRecord`. `uint16` becomes `u32` and `uint48` becomes `u64`
/// because `#[contracttype]` has no narrower integers. The policy pin
/// (`commitment_at_fund`) moved here from the EVM hook
/// (call-graph-on-soroban.md, decision 3).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobRecord {
    pub client: Address,
    pub created_at: u64,
    pub expired_at: u64,
    pub provider: Option<Address>,
    pub funded_at: u64,
    pub submitted_at: u64,
    pub evaluator: Address,
    pub budget: u64,
    pub status: JobStatus,
    pub hook: Option<Address>,
    pub platform_fee_bp: u32,
    pub evaluator_fee_bp: u32,
    pub provider_bps: u32,
    pub hook_resolves_payout: bool,
    pub payee: Option<Address>,
    pub deliverable: BytesN<32>,
    pub description: String,
    pub settlement_horizon: u64,
    pub commitment_at_fund: Option<BytesN<32>>,
}

/// The split the kernel credits on `complete`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Payout {
    pub payee: Address,
    pub provider_bps: u32,
    pub provider_share: i128,
    pub client_share: i128,
}

/// Everything the hook used to read back from the kernel, pushed by the kernel.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HookContext {
    pub job_id: u64,
    pub client: Address,
    pub provider: Option<Address>,
    pub evaluator: Address,
    pub hook: Address,
    pub status: JobStatus,
    pub budget: i128,
    pub net_payout: i128,
    pub payment_token: Address,
    pub submitted_at: u64,
    pub compliance_proof: Bytes,
    pub commitment_at_fund: Option<BytesN<32>>,
    pub payout: PayoutStatus,
}

/// Whether `ctx` carries the split: `Resolved` in the context of
/// `before_action` and `after_action` for `Complete`, `Unresolved` otherwise.
///
/// An enum and not `Option<Payout>`: the SDK's test build converts an
/// `Option<T>` field to XDR only when `T: Into<ScVal>`, which a contract type
/// is not, so every crate's tests would fail to compile.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PayoutStatus {
    Unresolved,
    Resolved(Payout),
}

/// `submit`'s parameters; replaces `abi.encode(uint256 agentId, bytes32 requestHash)`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubmitParams {
    pub agent_id: Option<u32>,
    pub request_hash: Option<BytesN<32>>,
}

/// `complete`'s parameters; there is deliberately no proof field.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompleteParams {
    pub provider_bps: u32,
}

/// The action a hook is told about; replaces `bytes4 selector` + `bytes data`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Action {
    SetProvider(Address),
    SetBudget(i128),
    Fund(i128),
    Submit(BytesN<32>, SubmitParams),
    Complete(BytesN<32>, CompleteParams),
    Reject(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CheckOutcome {
    NotRun = 0,
    Passed = 1,
    Failed = 2,
}

/// What `before_action` hands to `after_action` through the kernel.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BeforeOutcome {
    pub compliance: CheckOutcome,
    pub screening: CheckOutcome,
    pub screening_commitment: Option<BytesN<32>>,
    pub policy_pin: Option<BytesN<32>>,
}

/// What the hook asks the compliance module about.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Release {
    pub job_id: u64,
    pub hook: Address,
    pub payee: Address,
    pub amount: i128,
    pub token: Address,
    pub client: Address,
    pub commitment_at_fund: Option<BytesN<32>>,
}
