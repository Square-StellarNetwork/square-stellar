//! Writes the three generated sections of docs/design/storage-and-events.md
//! (error codes, events, storage keys) and contracts/common/errors.json from
//! the definitions in this crate, and fails when either file is stale:
//!
//! ```text
//! cargo test -p square-common --test schema                           check
//! SQUARE_WRITE_SCHEMA=1 cargo test -p square-common --test schema     rewrite
//! ```
//!
//! Everything comes from the contract specs the SDK derives (`spec_xdr()`),
//! so a name, a code, a type or a doc comment cannot drift between the code,
//! the document and the JSON. Event examples are the topics and data the
//! event itself encodes, printed as the network's JSON (`xdrFormat: json`).
//! One test only: accounts are numbered in creation order, and a single
//! thread keeps the examples byte-identical from run to run.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::xdr::{
    Limits, ReadXdr, ScSpecEntry, ScSpecEventParamLocationV0, ScSpecEventV0, ScSpecTypeDef,
    ScSpecUdtUnionCaseV0, ScVal,
};
use soroban_sdk::{Address, Bytes, BytesN, Env, Error, Event, String, Symbol, TryFromVal, U256};
use square_common::address::field_of;
use square_common::errors::*;
use square_common::events::{
    arbitration as arb, claim_market as market, compliance_module as module,
    keeper_evaluator as keeper, policy_registry as policy, screening_registry as screening,
    square_hook as hook, square_job as job,
};
use square_common::hash;
use square_common::keys::*;
use square_common::owner::{
    OwnerError, OwnershipRenounced, OwnershipTransferCancelled, OwnershipTransferStarted,
    OwnershipTransferred,
};
use square_common::ttl::{TtlConfigUpdated, TtlError};
use square_common::types::{
    CheckOutcome, Outcome, RefusalReason, ReputationOutcome, SkipReason, Verdict,
};
use square_test_support::Account;

type Text = std::string::String;

/// One contract's part of the schema.
struct Contract {
    name: &'static str,
    /// The EVM contract it ports, whose ABI names the EVM errors.
    evm: Option<&'static str>,
    errors: Vec<u8>,
    owner: bool,
    ttl: bool,
    keys: Option<Vec<u8>>,
    events: Vec<Example>,
}

struct Example {
    spec: ScSpecEventV0,
    topics: Vec<ScVal>,
    data: ScVal,
}

fn example<E: Event>(env: &Env, spec: &[u8], event: E) -> Example {
    let spec = match ScSpecEntry::from_xdr(spec, Limits::none()).expect("an event spec") {
        ScSpecEntry::EventV0(spec) => spec,
        other => panic!("not an event: {other:?}"),
    };
    let topics = event
        .topics(env)
        .iter()
        .map(|v| ScVal::try_from_val(env, &v).expect("a topic"))
        .collect();
    let data = ScVal::try_from_val(env, &event.data(env)).expect("the data");
    Example { spec, topics, data }
}

macro_rules! ex {
    ($env:expr, $($path:ident)::+ { $($body:tt)* }) => {
        example($env, &$($path)::+::spec_xdr(), $($path)::+ { $($body)* })
    };
}

/// The values every example is built from, each computed the way the
/// contracts compute it.
struct Samples {
    client: Address,
    provider: Address,
    buyer: Address,
    keeper: Address,
    arbiter: Address,
    screener: Address,
    owner: Address,
    nominee: Address,
    treasury: Address,
    keeper_evaluator: Address,
    arbitration: Address,
    hook: Address,
    module: Address,
    usdc: Address,
    job_id: u64,
    budget: i128,
    net: i128,
    created_at: u64,
    expired_at: u64,
    funded_at: u64,
    submitted_at: u64,
    deliverable: BytesN<32>,
    reason: BytesN<32>,
    resolution: BytesN<32>,
    statement: BytesN<32>,
    commitment: BytesN<32>,
    request_hash: BytesN<32>,
    screening_record: BytesN<32>,
    source: BytesN<32>,
    evidence: BytesN<32>,
}

fn label(env: &Env, text: &str) -> BytesN<32> {
    env.crypto()
        .sha256(&Bytes::from_slice(env, text.as_bytes()))
        .into()
}

impl Samples {
    fn new(env: &Env) -> Self {
        env.ledger().set_timestamp(1_789_000_000);
        let client = Account::new(env).address;
        let provider = Account::new(env).address;
        let buyer = Account::new(env).address;
        let keeper = Account::new(env).address;
        let arbiter = Account::new(env).address;
        let screener = Account::new(env).address;
        let owner = Account::new(env).address;
        let nominee = Account::new(env).address;
        let treasury = Account::new(env).address;
        let keeper_evaluator = Address::generate(env);
        let arbitration = Address::generate(env);
        let hook = Address::generate(env);
        let module = Address::generate(env);
        let usdc = Address::generate(env);
        let job_id = 1;
        // 5 USDC at 7 decimals, a 100 bps platform fee and a 50 bps evaluator fee.
        let budget = 50_000_000;
        let net = budget - budget * 100 / 10_000 - budget * 50 / 10_000;
        let created_at = 1_789_000_000;
        let deliverable = label(env, "square.example.deliverable");
        let reason = hash::finalize_reason(env, job_id, &deliverable);
        let resolution = hash::resolution_hash(env, job_id, Outcome::Complete, 10_000);
        let statement =
            hash::statement_hash(env, &Bytes::from(label(env, "square.example.signals")));
        let commitment = field_of(env, &client);
        Samples {
            request_hash: label(env, "square.example.validation-request"),
            screening_record: label(env, "square.example.screening-record"),
            source: label(env, "square.example.screening-source"),
            evidence: label(env, "square.example.source-response"),
            client,
            provider,
            buyer,
            keeper,
            arbiter,
            screener,
            owner,
            nominee,
            treasury,
            keeper_evaluator,
            arbitration,
            hook,
            module,
            usdc,
            job_id,
            budget,
            net,
            created_at,
            expired_at: created_at + 7 * 86_400,
            funded_at: created_at + 60,
            submitted_at: created_at + 3_600,
            deliverable,
            reason,
            resolution,
            statement,
            commitment,
        }
    }
}

fn contracts(env: &Env, s: &Samples) -> Vec<Contract> {
    let refused = Some(Error::from_contract_error(
        SquareHookError::NotCleared as u32,
    ));
    vec![
        Contract {
            name: "square_job",
            evm: Some("SquareJob"),
            errors: SquareJobError::spec_xdr().to_vec(),
            owner: true,
            ttl: true,
            keys: Some(SquareJobKey::spec_xdr().to_vec()),
            events: vec![
                ex!(
                    env,
                    job::JobCreated {
                        job_id: s.job_id,
                        client: s.client.clone(),
                        provider: Some(s.provider.clone()),
                        evaluator: s.keeper_evaluator.clone(),
                        expired_at: s.expired_at,
                        hook: Some(s.hook.clone())
                    }
                ),
                ex!(
                    env,
                    job::ProviderSet {
                        job_id: s.job_id,
                        provider: s.provider.clone()
                    }
                ),
                ex!(
                    env,
                    job::BudgetSet {
                        job_id: s.job_id,
                        amount: s.budget
                    }
                ),
                ex!(
                    env,
                    job::JobFunded {
                        job_id: s.job_id,
                        client: s.client.clone(),
                        amount: s.budget
                    }
                ),
                ex!(
                    env,
                    job::JobSubmitted {
                        job_id: s.job_id,
                        provider: s.provider.clone(),
                        deliverable: s.deliverable.clone()
                    }
                ),
                ex!(
                    env,
                    job::JobCompleted {
                        job_id: s.job_id,
                        evaluator: s.keeper_evaluator.clone(),
                        reason: s.reason.clone()
                    }
                ),
                ex!(
                    env,
                    job::JobRejected {
                        job_id: s.job_id,
                        rejector: s.keeper_evaluator.clone(),
                        reason: s.resolution.clone()
                    }
                ),
                ex!(env, job::JobExpired { job_id: s.job_id }),
                ex!(
                    env,
                    job::PaymentReleased {
                        job_id: s.job_id,
                        provider: s.buyer.clone(),
                        amount: s.net
                    }
                ),
                ex!(
                    env,
                    job::EvaluatorFeePaid {
                        job_id: s.job_id,
                        evaluator: s.keeper_evaluator.clone(),
                        amount: s.budget * 50 / 10_000
                    }
                ),
                ex!(
                    env,
                    job::Refunded {
                        job_id: s.job_id,
                        client: s.client.clone(),
                        amount: s.budget
                    }
                ),
                ex!(
                    env,
                    job::HookWhitelistUpdated {
                        hook: Some(s.hook.clone()),
                        status: true
                    }
                ),
                ex!(
                    env,
                    job::JobDescribed {
                        job_id: s.job_id,
                        created_at: s.created_at,
                        description: String::from_str(env, "Summarise the Q3 filing")
                    }
                ),
                ex!(
                    env,
                    job::FeesSnapshotted {
                        job_id: s.job_id,
                        platform_fee_bp: 100,
                        evaluator_fee_bp: 50,
                        funded_at: s.funded_at
                    }
                ),
                ex!(
                    env,
                    job::SubmissionTimed {
                        job_id: s.job_id,
                        submitted_at: s.submitted_at,
                        expired_at: s.expired_at
                    }
                ),
                ex!(
                    env,
                    job::PayoutRouted {
                        job_id: s.job_id,
                        payee: s.buyer.clone(),
                        provider_bps: 10_000,
                        provider_share: s.net,
                        client_share: 0
                    }
                ),
                ex!(
                    env,
                    job::PlatformFeeAccrued {
                        job_id: s.job_id,
                        treasury: s.treasury.clone(),
                        amount: s.budget * 100 / 10_000
                    }
                ),
                ex!(
                    env,
                    job::Withdrawn {
                        account: s.provider.clone(),
                        to: s.provider.clone(),
                        amount: s.net
                    }
                ),
                ex!(
                    env,
                    job::FeesUpdated {
                        platform_fee_bp: 100,
                        evaluator_fee_bp: 50,
                        treasury: s.treasury.clone()
                    }
                ),
                ex!(
                    env,
                    job::FeesScheduled {
                        platform_fee_bp: 150,
                        evaluator_fee_bp: 50,
                        effective_from: s.created_at + 86_400
                    }
                ),
                ex!(
                    env,
                    job::Skimmed {
                        to: s.treasury.clone(),
                        amount: 1_000_000
                    }
                ),
                ex!(
                    env,
                    job::ComplianceProofSet {
                        job_id: s.job_id,
                        client: s.client.clone(),
                        digest: env
                            .crypto()
                            .keccak256(&Bytes::from(s.statement.clone()))
                            .into()
                    }
                ),
                ex!(
                    env,
                    job::HookFailed {
                        job_id: s.job_id,
                        hook: s.hook.clone(),
                        action: Symbol::new(env, "complete"),
                        hook_fn: Symbol::new(env, "after_action"),
                        error: Some(Error::from_contract_error(3))
                    }
                ),
                ex!(
                    env,
                    job::PayoutUnresolvable {
                        job_id: s.job_id,
                        hook: s.hook.clone()
                    }
                ),
            ],
        },
        Contract {
            name: "keeper_evaluator",
            evm: Some("KeeperEvaluator"),
            errors: KeeperEvaluatorError::spec_xdr().to_vec(),
            owner: true,
            ttl: true,
            keys: Some(KeeperEvaluatorKey::spec_xdr().to_vec()),
            events: vec![
                ex!(
                    env,
                    keeper::WindowsConfigured {
                        effective_from: s.created_at,
                        challenge_window: 120,
                        dispute_window: 300
                    }
                ),
                ex!(
                    env,
                    keeper::FinalizeGraceConfigured {
                        finalize_grace: 600
                    }
                ),
                ex!(
                    env,
                    keeper::ArbitrationSet {
                        arbitration: s.arbitration.clone()
                    }
                ),
                ex!(
                    env,
                    keeper::Finalized {
                        job_id: s.job_id,
                        keeper: s.keeper.clone(),
                        keeper_fee: s.budget * 50 / 10_000
                    }
                ),
                ex!(
                    env,
                    keeper::DisputeRaised {
                        job_id: s.job_id,
                        disputer: s.client.clone(),
                        disputed_at: s.submitted_at + 60,
                        challenge_end: s.submitted_at + 120
                    }
                ),
                ex!(
                    env,
                    keeper::DecisionApplied {
                        job_id: s.job_id,
                        keeper: s.keeper.clone(),
                        outcome: Outcome::Complete,
                        provider_bps: 10_000,
                        keeper_fee: s.budget * 50 / 10_000
                    }
                ),
            ],
        },
        Contract {
            name: "arbitration",
            evm: Some("Arbitration"),
            errors: ArbitrationError::spec_xdr().to_vec(),
            owner: true,
            ttl: true,
            keys: Some(ArbitrationKey::spec_xdr().to_vec()),
            events: vec![
                ex!(
                    env,
                    arb::ArbitersUpdated {
                        version: 1,
                        arbiters: soroban_sdk::vec![env, s.arbiter.clone()],
                        threshold: 1
                    }
                ),
                ex!(
                    env,
                    arb::BondParametersUpdated {
                        bond_bps: 1_000,
                        min_bond: 10_000_000
                    }
                ),
                ex!(
                    env,
                    arb::DisputeOpened {
                        job_id: s.job_id,
                        disputer: s.client.clone(),
                        bond: 10_000_000,
                        disputed_at: s.submitted_at + 60,
                        set_version: 1,
                        resolve_by: s.submitted_at + 360
                    }
                ),
                ex!(
                    env,
                    arb::VoteCast {
                        job_id: s.job_id,
                        arbiter: s.arbiter.clone(),
                        resolution_hash: s.resolution.clone(),
                        outcome: Outcome::Complete,
                        provider_bps: 10_000,
                        approvals: U256::from_u32(env, 1)
                    }
                ),
                ex!(
                    env,
                    arb::DecisionReached {
                        job_id: s.job_id,
                        outcome: Outcome::Complete,
                        provider_bps: 10_000,
                        resolution_hash: s.resolution.clone()
                    }
                ),
                ex!(env, arb::DisputeExpired { job_id: s.job_id }),
                ex!(
                    env,
                    arb::BondSettled {
                        job_id: s.job_id,
                        to: s.client.clone(),
                        amount: 10_000_000
                    }
                ),
                ex!(
                    env,
                    arb::BondWithdrawn {
                        account: s.client.clone(),
                        to: s.client.clone(),
                        amount: 10_000_000
                    }
                ),
                ex!(
                    env,
                    arb::RejectionNotApplied {
                        job_id: s.job_id,
                        error: Some(Error::from_contract_error(
                            SquareJobError::WrongStatus as u32
                        ))
                    }
                ),
            ],
        },
        Contract {
            name: "claim_market",
            evm: Some("ClaimMarket"),
            errors: ClaimMarketError::spec_xdr().to_vec(),
            owner: false,
            ttl: true,
            keys: Some(ClaimMarketKey::spec_xdr().to_vec()),
            events: vec![
                ex!(
                    env,
                    market::ClaimListed {
                        job_id: s.job_id,
                        seller: s.provider.clone(),
                        price: 48_000_000,
                        face_value: s.net as u64
                    }
                ),
                ex!(
                    env,
                    market::ClaimBought {
                        job_id: s.job_id,
                        buyer: s.buyer.clone(),
                        seller: s.provider.clone(),
                        price: 48_000_000
                    }
                ),
                ex!(
                    env,
                    market::ClaimCancelled {
                        job_id: s.job_id,
                        seller: s.provider.clone()
                    }
                ),
            ],
        },
        Contract {
            name: "square_hook",
            evm: Some("SquareHook"),
            errors: SquareHookError::spec_xdr().to_vec(),
            owner: true,
            ttl: true,
            keys: Some(SquareHookKey::spec_xdr().to_vec()),
            events: vec![
                ex!(
                    env,
                    hook::AgentBound {
                        job_id: s.job_id,
                        agent_id: 0,
                        validation_request_hash: Some(s.request_hash.clone())
                    }
                ),
                ex!(
                    env,
                    hook::ComplianceChecked {
                        job_id: s.job_id,
                        payee: s.buyer.clone(),
                        amount: s.net,
                        verified: true
                    }
                ),
                ex!(
                    env,
                    hook::ReputationRecorded {
                        job_id: s.job_id,
                        agent_id: 0,
                        outcome: ReputationOutcome::Completed,
                        value: 1
                    }
                ),
                ex!(
                    env,
                    hook::ReputationWriteFailed {
                        job_id: s.job_id,
                        agent_id: 0,
                        error: None
                    }
                ),
                ex!(
                    env,
                    hook::ValidationRecorded {
                        job_id: s.job_id,
                        request_hash: s.request_hash.clone(),
                        response: 100
                    }
                ),
                ex!(
                    env,
                    hook::ValidationWriteFailed {
                        job_id: s.job_id,
                        request_hash: s.request_hash.clone(),
                        error: Some(Error::from_contract_error(1))
                    }
                ),
                ex!(
                    env,
                    hook::ComplianceModuleUpdated {
                        module: Some(s.module.clone())
                    }
                ),
                ex!(env, hook::ScreeningUpdated { registry: None }),
                ex!(
                    env,
                    hook::ScreeningChecked {
                        job_id: s.job_id,
                        payee: s.buyer.clone(),
                        cleared: true
                    }
                ),
                ex!(
                    env,
                    hook::ComplianceCheckFailed {
                        job_id: s.job_id,
                        error: refused
                    }
                ),
                ex!(
                    env,
                    hook::ReputationPolicyUpdated {
                        trusted_evaluator: Some(s.keeper_evaluator.clone()),
                        min_reputation_budget: 10_000_000
                    }
                ),
                ex!(
                    env,
                    hook::ReputationSkipped {
                        job_id: s.job_id,
                        agent_id: 0,
                        reason: SkipReason::BudgetBelowMinimum.symbol(env),
                    }
                ),
                ex!(
                    env,
                    hook::ReleaseUnconfirmed {
                        job_id: s.job_id,
                        payee: s.buyer.clone(),
                        amount: s.net
                    }
                ),
                ex!(
                    env,
                    hook::PolicyPinned {
                        job_id: s.job_id,
                        client: s.client.clone(),
                        commitment: s.commitment.clone()
                    }
                ),
                ex!(env, hook::EvidenceUnreadable { job_id: s.job_id }),
                ex!(
                    env,
                    hook::EvidenceRecorded {
                        job_id: s.job_id,
                        payee: s.buyer.clone(),
                        amount: s.net,
                        token: s.usdc.clone(),
                        screening: Some(s.screening_record.clone()),
                        compliance_outcome: CheckOutcome::Passed,
                        screening_outcome: CheckOutcome::Passed,
                        commitment: hash::evidence_hash(
                            env,
                            s.job_id,
                            &s.buyer,
                            s.net,
                            &s.usdc,
                            &Some(s.screening_record.clone()),
                            CheckOutcome::Passed,
                            CheckOutcome::Passed
                        ),
                    }
                ),
                ex!(
                    env,
                    hook::RegistryWritesUpdated {
                        reputation: true,
                        validation: false
                    }
                ),
            ],
        },
        Contract {
            name: "compliance_module",
            evm: Some("ComplianceModule"),
            errors: ComplianceModuleError::spec_xdr().to_vec(),
            owner: true,
            ttl: true,
            keys: Some(ComplianceModuleKey::spec_xdr().to_vec()),
            events: vec![
                ex!(
                    env,
                    module::HookUpdated {
                        hook: s.hook.clone()
                    }
                ),
                ex!(env, module::TimestampToleranceUpdated { seconds: 600 }),
                ex!(
                    env,
                    module::ReleaseVerified {
                        job_id: s.job_id,
                        payee: s.buyer.clone(),
                        amount: s.net,
                        statement: s.statement.clone()
                    }
                ),
                ex!(
                    env,
                    module::VerdictDisagreed {
                        job_id: s.job_id,
                        verdict: Verdict::LimitExceeded
                    }
                ),
                ex!(
                    env,
                    module::ReleaseRefused {
                        job_id: s.job_id,
                        statement: Some(s.statement.clone()),
                        reason: RefusalReason::Recipient.symbol(env),
                    }
                ),
            ],
        },
        Contract {
            name: "policy_registry",
            evm: Some("PolicyRegistry"),
            errors: PolicyRegistryError::spec_xdr().to_vec(),
            owner: true,
            ttl: true,
            keys: Some(PolicyRegistryKey::spec_xdr().to_vec()),
            events: vec![
                ex!(
                    env,
                    policy::PolicyCommitted {
                        poster: s.client.clone(),
                        commitment: s.commitment.clone(),
                        daily_limit: 1_000_000_000,
                        epoch: 1
                    }
                ),
                ex!(
                    env,
                    policy::SpendRecorded {
                        poster: s.client.clone(),
                        day: s.created_at / 86_400,
                        amount: s.net as u128,
                        spent_after: s.net as u128
                    }
                ),
                ex!(
                    env,
                    policy::ReleaseOutsidePolicy {
                        poster: s.client.clone(),
                        day: s.created_at / 86_400,
                        spent_after: 1_049_250_000,
                        daily_limit: 1_000_000_000,
                        verdict: Verdict::LimitExceeded
                    }
                ),
                ex!(
                    env,
                    policy::SpenderUpdated {
                        spender: s.module.clone(),
                        allowed: true
                    }
                ),
                ex!(
                    env,
                    policy::BuyerRootCommitted {
                        poster: s.client.clone(),
                        root: Some(hash::buyer_leaf(
                            env,
                            &s.buyer,
                            &label(env, "square.example.salt")
                        ))
                    }
                ),
            ],
        },
        Contract {
            name: "screening_registry",
            evm: Some("ScreeningRegistry"),
            errors: ScreeningRegistryError::spec_xdr().to_vec(),
            owner: true,
            ttl: true,
            keys: Some(ScreeningRegistryKey::spec_xdr().to_vec()),
            events: vec![
                ex!(
                    env,
                    screening::Screened {
                        subject: s.buyer.clone(),
                        source: s.source.clone(),
                        screener: s.screener.clone(),
                        sanctioned: false,
                        screened_at: s.created_at,
                        evidence: s.evidence.clone()
                    }
                ),
                ex!(
                    env,
                    screening::ScreenerUpdated {
                        screener: s.screener.clone(),
                        allowed: true
                    }
                ),
                ex!(env, screening::MaxAgeUpdated { max_age: 86_400 }),
            ],
        },
        Contract {
            name: "groth16_verifier",
            evm: None,
            errors: Groth16VerifierError::spec_xdr().to_vec(),
            owner: false,
            ttl: false,
            keys: None,
            events: vec![],
        },
    ]
}

fn shared_events(env: &Env, s: &Samples) -> (Vec<Example>, Vec<Example>) {
    let owner = vec![
        ex!(
            env,
            OwnershipTransferStarted {
                owner: s.owner.clone(),
                pending_owner: s.nominee.clone(),
                live_until_ledger: 1_000
            }
        ),
        ex!(
            env,
            OwnershipTransferCancelled {
                owner: s.owner.clone()
            }
        ),
        ex!(
            env,
            OwnershipTransferred {
                previous_owner: Some(s.owner.clone()),
                new_owner: s.nominee.clone()
            }
        ),
        ex!(
            env,
            OwnershipRenounced {
                previous_owner: s.owner.clone()
            }
        ),
    ];
    let ttl = vec![ex!(
        env,
        TtlConfigUpdated {
            ledger_close_ms: 5_000,
            min_persistent_ttl: 120_960
        }
    )];
    (owner, ttl)
}

// ---------------------------------------------------------------- rendering

fn text(bytes: &[u8]) -> Text {
    Text::from_utf8(bytes.to_vec()).expect("utf-8")
}

fn ty(t: &ScSpecTypeDef) -> Text {
    use ScSpecTypeDef as T;
    match t {
        T::Val => "Val".into(),
        T::Bool => "bool".into(),
        T::Void => "()".into(),
        T::Error => "Error".into(),
        T::U32 => "u32".into(),
        T::I32 => "i32".into(),
        T::U64 => "u64".into(),
        T::I64 => "i64".into(),
        T::Timepoint => "Timepoint".into(),
        T::Duration => "Duration".into(),
        T::U128 => "u128".into(),
        T::I128 => "i128".into(),
        T::U256 => "U256".into(),
        T::I256 => "I256".into(),
        T::Bytes => "Bytes".into(),
        T::String => "String".into(),
        T::Symbol => "Symbol".into(),
        T::Address => "Address".into(),
        T::MuxedAddress => "MuxedAddress".into(),
        T::Option(o) => format!("Option<{}>", ty(&o.value_type)),
        T::Result(r) => format!("Result<{}, {}>", ty(&r.ok_type), ty(&r.error_type)),
        T::Vec(v) => format!("Vec<{}>", ty(&v.element_type)),
        T::Map(m) => format!("Map<{}, {}>", ty(&m.key_type), ty(&m.value_type)),
        T::Tuple(t) => format!(
            "({})",
            t.value_types.iter().map(ty).collect::<Vec<_>>().join(", ")
        ),
        T::BytesN(b) => format!("BytesN<{}>", b.n),
        T::Udt(u) => text(u.name.as_slice()),
    }
}

fn json(v: &ScVal) -> Text {
    serde_json::to_string(v).expect("an ScVal serialises")
}

fn one_line(doc: &[u8]) -> Text {
    text(doc).split_whitespace().collect::<Vec<_>>().join(" ")
}

fn render_events(out: &mut Text, events: &[Example]) {
    out.push_str("| Event | Topics after the name | Data | Meaning |\n|---|---|---|---|\n");
    for e in events {
        let field = |p: &soroban_sdk::xdr::ScSpecEventParamV0| {
            format!("`{}: {}`", text(p.name.as_slice()), ty(&p.type_))
        };
        let topics: Vec<Text> = e
            .spec
            .params
            .iter()
            .filter(|p| p.location == ScSpecEventParamLocationV0::TopicList)
            .map(field)
            .collect();
        let data: Vec<Text> = e
            .spec
            .params
            .iter()
            .filter(|p| p.location == ScSpecEventParamLocationV0::Data)
            .map(field)
            .collect();
        let dash = |v: Vec<Text>| {
            if v.is_empty() {
                "—".to_string()
            } else {
                v.join(", ")
            }
        };
        writeln!(
            out,
            "| `{}` | {} | {} | {} |",
            text(e.spec.name.as_slice()),
            dash(topics),
            dash(data),
            one_line(e.spec.doc.as_slice())
        )
        .unwrap();
    }
    out.push_str("\n```text\n");
    for e in events {
        writeln!(out, "{}", text(e.spec.name.as_slice())).unwrap();
        for topic in &e.topics {
            writeln!(out, "  topic  {}", json(topic)).unwrap();
        }
        match &e.data {
            ScVal::Map(Some(map)) if !map.is_empty() => {
                let width = map
                    .iter()
                    .map(|entry| json_key(&entry.key).len())
                    .max()
                    .unwrap_or(0);
                for (i, entry) in map.iter().enumerate() {
                    let lead = if i == 0 { "  data  " } else { "        " };
                    writeln!(
                        out,
                        "{lead} {:width$}  {}",
                        json_key(&entry.key),
                        json(&entry.val)
                    )
                    .unwrap();
                }
            }
            other => writeln!(out, "  data   {}", json(other)).unwrap(),
        }
    }
    out.push_str("```\n");
}

fn json_key(key: &ScVal) -> Text {
    match key {
        ScVal::Symbol(s) => text(s.0.as_slice()),
        other => json(other),
    }
}

fn errors_of(spec: &[u8]) -> (Text, Vec<(u32, Text, Text)>) {
    match ScSpecEntry::from_xdr(spec, Limits::none()).expect("an error spec") {
        ScSpecEntry::UdtErrorEnumV0(e) => (
            text(e.name.as_slice()),
            e.cases
                .iter()
                .map(|c| (c.value, text(c.name.as_slice()), one_line(c.doc.as_slice())))
                .collect(),
        ),
        other => panic!("not an error enum: {other:?}"),
    }
}

/// The error names an EVM contract's ABI declares, from packages/core/src/abi.
fn evm_errors(root: &Path, evm: &str) -> Vec<Text> {
    let source =
        std::fs::read_to_string(root.join("packages/core/src/abi").join(format!("{evm}.ts")))
            .expect("the EVM ABI");
    let abi: serde_json::Value =
        serde_json::from_str(&source[source.find('[').unwrap()..=source.rfind(']').unwrap()])
            .expect("an ABI array");
    let mut names: Vec<Text> = abi
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["type"] == "error")
        .map(|e| e["name"].as_str().unwrap().to_string())
        .collect();
    names.sort();
    names.dedup();
    names
}

fn render_error_table(
    out: &mut Text,
    contract: &str,
    evm: Option<&str>,
    spec: &[u8],
    evm_names: &[Text],
) {
    let (enum_name, cases) = errors_of(spec);
    writeln!(out, "#### `{contract}`: `{enum_name}`\n").unwrap();
    out.push_str("| Code | Name | EVM |\n|---:|---|---|\n");
    for (code, name, _doc) in cases {
        let origin = match evm {
            Some(evm) if evm_names.contains(&name) => format!("`{evm}.{name}`"),
            Some(_) => "new on Soroban".to_string(),
            None => "new on Soroban (`Groth16Verifier.sol` declares no errors)".to_string(),
        };
        writeln!(out, "| {code} | `{name}` | {origin} |").unwrap();
    }
    out.push('\n');
}

fn render_keys(out: &mut Text, contract: &str, spec: &[u8]) {
    let union = match ScSpecEntry::from_xdr(spec, Limits::none()).expect("a key spec") {
        ScSpecEntry::UdtUnionV0(u) => u,
        other => panic!("not a key enum: {other:?}"),
    };
    writeln!(
        out,
        "#### `{contract}`: `{}`\n",
        text(union.name.as_slice())
    )
    .unwrap();
    out.push_str("| Key | Storage and TTL class | Value, and its EVM origin |\n|---|---|---|\n");
    for case in union.cases.iter() {
        let (key, doc) = match case {
            ScSpecUdtUnionCaseV0::VoidV0(c) => {
                (text(c.name.as_slice()), one_line(c.doc.as_slice()))
            }
            ScSpecUdtUnionCaseV0::TupleV0(c) => (
                format!(
                    "{}({})",
                    text(c.name.as_slice()),
                    c.type_.iter().map(ty).collect::<Vec<_>>().join(", ")
                ),
                one_line(c.doc.as_slice()),
            ),
        };
        let (class, value) = doc
            .split_once(": ")
            .unwrap_or_else(|| panic!("{contract}::{key} has no `class: value` doc"));
        writeln!(out, "| `{key}` | {class} | {value} |").unwrap();
    }
    out.push('\n');
}

fn replace_section(doc: &str, name: &str, body: &str) -> Text {
    let open = format!("<!-- generated:{name} -->\n");
    let close = format!("<!-- /generated:{name} -->");
    let start = doc
        .find(&open)
        .unwrap_or_else(|| panic!("the document has no {open:?} marker"))
        + open.len();
    let end = doc
        .find(&close)
        .unwrap_or_else(|| panic!("the document has no {close:?} marker"));
    format!("{}{}{}", &doc[..start], body, &doc[end..])
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}

#[test]
fn the_schema_document_and_errors_json_match_the_code() {
    let env = Env::default();
    let root = repo_root();
    let samples = Samples::new(&env);
    let contracts = contracts(&env, &samples);
    let (owner_events, ttl_events) = shared_events(&env, &samples);

    // Errors: the document's tables and errors.json, from the same specs.
    let (owner_enum, owner_codes) = errors_of(&OwnerError::spec_xdr());
    let (ttl_enum, ttl_codes) = errors_of(&TtlError::spec_xdr());
    let mut errors_doc = Text::new();
    let mut errors_json = Text::from(
        "{\n  \"_about\": \"Every contract's #[contracterror] codes, by contract crate name: its own enum, plus the owner and TTL codes it can raise. Generated by contracts/common/tests/schema.rs from the contract specs; docs/design/storage-and-events.md holds the same table.\",\n",
    );
    let mut evm_only: Vec<(Text, Text)> = Vec::new();
    for (i, c) in contracts.iter().enumerate() {
        let evm_names = c.evm.map(|evm| evm_errors(&root, evm)).unwrap_or_default();
        render_error_table(&mut errors_doc, c.name, c.evm, &c.errors, &evm_names);
        let (_, own) = errors_of(&c.errors);
        for name in &evm_names {
            if !own.iter().any(|(_, n, _)| n == name) {
                evm_only.push((c.evm.unwrap().to_string(), name.clone()));
            }
        }
        let mut codes = own.clone();
        if c.owner {
            codes.extend(owner_codes.iter().cloned());
        }
        if c.ttl {
            codes.extend(ttl_codes.iter().cloned());
        }
        codes.sort_by_key(|(code, _, _)| *code);
        let entries: Vec<Text> = codes
            .iter()
            .map(|(code, name, _)| format!("    \"{code}\": \"{name}\""))
            .collect();
        let comma = if i + 1 == contracts.len() { "" } else { "," };
        writeln!(
            errors_json,
            "  \"{}\": {{\n{}\n  }}{comma}",
            c.name,
            entries.join(",\n")
        )
        .unwrap();
    }
    errors_json.push_str("}\n");
    writeln!(errors_doc, "#### Shared: `{owner_enum}` (every contract with an owner) and `{ttl_enum}` (every contract that stores a `TtlConfig`)\n").unwrap();
    errors_doc.push_str("| Code | Name | Raised by |\n|---:|---|---|\n");
    for (code, name, _) in &owner_codes {
        writeln!(
            errors_doc,
            "| {code} | `{name}` | `owner`: {} |",
            contracts
                .iter()
                .filter(|c| c.owner)
                .map(|c| format!("`{}`", c.name))
                .collect::<Vec<_>>()
                .join(", ")
        )
        .unwrap();
    }
    for (code, name, _) in &ttl_codes {
        writeln!(
            errors_doc,
            "| {code} | `{name}` | `ttl`: {} |",
            contracts
                .iter()
                .filter(|c| c.ttl)
                .map(|c| format!("`{}`", c.name))
                .collect::<Vec<_>>()
                .join(", ")
        )
        .unwrap();
    }

    // Events, per contract, then the shared ones.
    let mut events_doc = Text::new();
    for c in contracts.iter().filter(|c| !c.events.is_empty()) {
        writeln!(events_doc, "#### `{}`\n", c.name).unwrap();
        render_events(&mut events_doc, &c.events);
        events_doc.push('\n');
    }
    events_doc.push_str("#### Every contract with an owner\n\n");
    render_events(&mut events_doc, &owner_events);
    events_doc.push_str("\n#### Every contract that stores a `TtlConfig`\n\n");
    render_events(&mut events_doc, &ttl_events);

    // Storage keys.
    let mut keys_doc = Text::new();
    for c in &contracts {
        if let Some(spec) = &c.keys {
            render_keys(&mut keys_doc, c.name, spec);
        }
    }

    let doc_path = root.join("docs/design/storage-and-events.md");
    let json_path = root.join("contracts/common/errors.json");
    let current = std::fs::read_to_string(&doc_path).expect("the document");
    let mut generated = replace_section(&current, "errors", &errors_doc);
    generated = replace_section(&generated, "events", &events_doc);
    generated = replace_section(&generated, "keys", &keys_doc);

    if std::env::var("SQUARE_WRITE_SCHEMA").is_ok() {
        std::fs::write(&doc_path, &generated).unwrap();
        std::fs::write(&json_path, &errors_json).unwrap();
        return;
    }
    assert!(
        generated == current,
        "docs/design/storage-and-events.md is stale; run SQUARE_WRITE_SCHEMA=1 cargo test -p square-common --test schema"
    );
    assert_eq!(
        std::fs::read_to_string(&json_path).unwrap_or_default(),
        errors_json,
        "contracts/common/errors.json is stale; run SQUARE_WRITE_SCHEMA=1 cargo test -p square-common --test schema"
    );
    // Every EVM error with no Soroban code is explained in the hand-written part.
    for (evm, name) in &evm_only {
        assert!(
            current.contains(&format!("`{name}`")),
            "{evm}.{name} has no Soroban code and the document does not say why"
        );
    }
}
