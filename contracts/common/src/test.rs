extern crate std;

use crate::address::{field_of, sc_address_xdr};
use crate::bn254;
use crate::hash;
use crate::keys::*;
use crate::owner::PendingOwner;
use crate::ttl::{self, TtlConfig, TtlConfigUpdated};
use crate::types::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger},
    xdr::{FromXdr, ToXdr},
    Address, Bytes, BytesN, Env, Event, String, Vec, U256,
};
use std::string::String as StdString;

const VECTORS: &str = include_str!("../../test-support/vectors.json");

fn vectors() -> serde_json::Value {
    serde_json::from_str(VECTORS).unwrap()
}

fn bytes_of(env: &Env, text: &str) -> Bytes {
    let raw: std::vec::Vec<u8> = (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect();
    Bytes::from_slice(env, &raw)
}

fn n32(env: &Env, text: &str) -> BytesN<32> {
    bytes_of(env, text).try_into().unwrap()
}

fn hex(bytes: impl IntoIterator<Item = u8>) -> StdString {
    bytes.into_iter().map(|b| std::format!("{b:02x}")).collect()
}

fn addr(env: &Env, strkey: &str) -> Address {
    Address::from_string(&String::from_str(env, strkey))
}

// ---------------------------------------------------------------- XDR round trips

macro_rules! round_trip {
    ($env:expr, $($value:expr),+ $(,)?) => {{
        $(
            let value = $value;
            let bytes = value.clone().to_xdr($env);
            let back = FromXdr::from_xdr($env, &bytes).expect("decodes");
            assert_eq!(value, back);
        )+
    }};
}

fn sample_job(env: &Env) -> JobRecord {
    JobRecord {
        client: Address::generate(env),
        created_at: 1_789_000_000,
        expired_at: 1_789_086_400,
        provider: Some(Address::generate(env)),
        funded_at: 1_789_000_100,
        submitted_at: 0,
        evaluator: Address::generate(env),
        budget: 50_000_000,
        status: JobStatus::Funded,
        hook: Some(Address::generate(env)),
        platform_fee_bp: 100,
        evaluator_fee_bp: 50,
        provider_bps: 0,
        hook_resolves_payout: true,
        payee: None,
        deliverable: BytesN::from_array(env, &[7; 32]),
        description: String::from_str(env, "summarise the filing"),
        settlement_horizon: 1_020,
        commitment_at_fund: Some(BytesN::from_array(env, &[9; 32])),
    }
}

#[test]
fn every_contracttype_round_trips_through_xdr() {
    let env = Env::default();
    let e = &env;
    let job: JobRecord = sample_job(e);
    let payout = Payout {
        payee: Address::generate(e),
        provider_bps: 10_000,
        provider_share: 49_250_000,
        client_share: 0,
    };
    let ctx = HookContext {
        job_id: 3,
        client: job.client.clone(),
        provider: job.provider.clone(),
        evaluator: job.evaluator.clone(),
        hook: Address::generate(e),
        status: JobStatus::Submitted,
        budget: 50_000_000,
        net_payout: 49_250_000,
        payment_token: Address::generate(e),
        submitted_at: 1_789_000_200,
        compliance_proof: Bytes::from_array(e, &[1; 512]),
        commitment_at_fund: job.commitment_at_fund.clone(),
        payout: PayoutStatus::Resolved(payout.clone()),
    };
    let submit = SubmitParams {
        agent_id: Some(0),
        request_hash: Some(BytesN::from_array(e, &[4; 32])),
    };
    let complete = CompleteParams {
        provider_bps: 5_000,
    };
    round_trip!(
        e,
        JobStatus::Open,
        JobStatus::Expired,
        job.clone(),
        payout.clone(),
        ctx.clone(),
        submit.clone(),
        complete.clone()
    );
    round_trip!(
        e,
        HookContext {
            payout: PayoutStatus::Unresolved,
            provider: None,
            commitment_at_fund: None,
            ..ctx.clone()
        }
    );
    round_trip!(
        e,
        Action::SetProvider(Address::generate(e)),
        Action::SetBudget(1),
        Action::Fund(50_000_000),
        Action::Submit(BytesN::from_array(e, &[2; 32]), submit.clone()),
        Action::Complete(BytesN::from_array(e, &[3; 32]), complete.clone()),
        Action::Reject(BytesN::from_array(e, &[5; 32])),
    );
    round_trip!(
        e,
        CheckOutcome::NotRun,
        CheckOutcome::Failed,
        BeforeOutcome {
            compliance: CheckOutcome::Passed,
            screening: CheckOutcome::NotRun,
            screening_commitment: None,
            policy_pin: Some(BytesN::from_array(e, &[6; 32]))
        },
        Release {
            job_id: 3,
            hook: ctx.hook.clone(),
            payee: payout.payee.clone(),
            amount: 49_250_000,
            token: ctx.payment_token.clone(),
            client: job.client.clone(),
            commitment_at_fund: None
        },
        ProofState::NotGated,
        ProofState::Decidable,
        Verdict::LimitExceeded,
        Policy {
            commitment: BytesN::from_array(e, &[8; 32]),
            daily_limit: 1_000_000_000,
            updated_at: 1_789_000_000,
            epoch: 2
        },
        DailySpend {
            day: 20_705,
            spent: 250_000_000
        },
        Screening {
            subject: Address::generate(e),
            sanctioned: false,
            screened_at: 1_789_000_000,
            source: BytesN::from_array(e, &[10; 32]),
            evidence: BytesN::from_array(e, &[11; 32])
        },
        ScreeningRecord {
            screener: Address::generate(e),
            screened_at: 1_789_000_000,
            sanctioned: true,
            source: BytesN::from_array(e, &[10; 32]),
            evidence: BytesN::from_array(e, &[11; 32])
        },
        Outcome::Lapsed,
        Dispute {
            disputer: Address::generate(e),
            bond: 10_000_000,
            disputed_at: 1_789_000_300,
            resolve_by: 1_789_000_600,
            set_version: 1,
            voted: U256::from_u32(e, 0b101),
            outcome: Outcome::Complete,
            provider_bps: 5_000,
            resolution_hash: Some(BytesN::from_array(e, &[12; 32])),
            bond_settled: false
        },
        Window {
            effective_from: 1_789_000_000,
            challenge_window: 120,
            dispute_window: 300,
            finalize_grace: 600
        },
        DisputeRef {
            disputer: Address::generate(e),
            disputed_at: 1_789_000_300,
            resolved: true
        },
        ListingStatus::Sold,
        Listing {
            seller: Address::generate(e),
            buyer: Some(Address::generate(e)),
            price: 40_000_000,
            face_value: 49_250_000,
            status: ListingStatus::Listed
        },
        TtlConfig {
            ledger_close_ms: 5_000,
            min_persistent_ttl: 120_960
        },
        PendingOwner {
            account: Address::generate(e),
            live_until_ledger: 1_000
        },
        PayoutStatus::Unresolved,
        PayoutStatus::Resolved(payout.clone()),
        ReputationOutcome::Completed,
        ReputationOutcome::Expired,
    );
    let who = Address::generate(e);
    let hash = BytesN::from_array(e, &[13; 32]);
    round_trip!(
        e,
        SquareJobKey::PaymentToken,
        SquareJobKey::JobCounter,
        SquareJobKey::PlatformFeeBp,
        SquareJobKey::EvaluatorFeeBp,
        SquareJobKey::Treasury,
        SquareJobKey::PendingFees,
        SquareJobKey::TotalWithdrawable,
        SquareJobKey::TotalEscrowed,
        SquareJobKey::Job(u64::MAX),
        SquareJobKey::ComplianceProof(1),
        SquareJobKey::Withdrawable(who.clone()),
        SquareJobKey::HookWhitelisted(None),
        SquareJobKey::HookWhitelisted(Some(who.clone())),
        KeeperEvaluatorKey::SquareJob,
        KeeperEvaluatorKey::Arbitration,
        KeeperEvaluatorKey::WindowCount,
        KeeperEvaluatorKey::Window(0),
        KeeperEvaluatorKey::Dispute(1),
        ArbitrationKey::Token,
        ArbitrationKey::KeeperEvaluator,
        ArbitrationKey::SquareJob,
        ArbitrationKey::CurrentVersion,
        ArbitrationKey::BondBps,
        ArbitrationKey::MinBond,
        ArbitrationKey::Arbiters(1),
        ArbitrationKey::Threshold(1),
        ArbitrationKey::ArbiterIndex(1, who.clone()),
        ArbitrationKey::Dispute(1),
        ArbitrationKey::Approval(1, hash.clone()),
        ArbitrationKey::Withdrawable(who.clone()),
        ClaimMarketKey::SquareJob,
        ClaimMarketKey::KeeperEvaluator,
        ClaimMarketKey::Token,
        ClaimMarketKey::PolicyRegistry,
        ClaimMarketKey::Listing(1),
        SquareHookKey::Kernel,
        SquareHookKey::PaymentToken,
        SquareHookKey::ClaimMarket,
        SquareHookKey::IdentityRegistry,
        SquareHookKey::ReputationRegistry,
        SquareHookKey::ValidationRegistry,
        SquareHookKey::ComplianceModule,
        SquareHookKey::Screening,
        SquareHookKey::TrustedEvaluator,
        SquareHookKey::MinReputationBudget,
        SquareHookKey::ReputationWrites,
        SquareHookKey::ValidationWrites,
        SquareHookKey::BoundAgent(1),
        SquareHookKey::ValidationOf(1),
        SquareHookKey::Recorded(1),
        ComplianceModuleKey::Hook,
        ComplianceModuleKey::Verifier,
        ComplianceModuleKey::PolicyRegistry,
        ComplianceModuleKey::Kernel,
        ComplianceModuleKey::TimestampTolerance,
        ComplianceModuleKey::Consumed(hash.clone()),
        PolicyRegistryKey::Policy(who.clone()),
        PolicyRegistryKey::DailySpend(who.clone()),
        PolicyRegistryKey::BuyerRoot(who.clone()),
        PolicyRegistryKey::Spender(who.clone()),
        ScreeningRegistryKey::MaxAge,
        ScreeningRegistryKey::Record(who.clone()),
        ScreeningRegistryKey::Screener(who),
    );
}

/// Every `#[contracttype]` under `src/` appears in the round-trip test above,
/// so a type added later without its round trip fails here.
#[test]
fn the_round_trip_test_covers_every_contracttype() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = std::vec![root.clone()];
    let mut types = std::vec::Vec::new();
    while let Some(path) = files.pop() {
        if path.is_dir() {
            files.extend(std::fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
            continue;
        }
        if path.file_name().unwrap() == "test.rs" {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let mut lines = text.lines();
        while let Some(line) = lines.next() {
            if line.trim() != "#[contracttype]" {
                continue;
            }
            let decl = lines
                .by_ref()
                .find(|l| l.contains("struct ") || l.contains("enum "))
                .unwrap();
            let name = decl
                .split_whitespace()
                .skip_while(|w| *w != "struct" && *w != "enum")
                .nth(1)
                .unwrap();
            types.push(StdString::from(
                name.trim_end_matches('{').trim_end_matches('('),
            ));
        }
    }
    let source = include_str!("test.rs");
    let body_start = source
        .find("fn every_contracttype_round_trips_through_xdr")
        .unwrap();
    let body = &source[body_start..body_start + source[body_start..].find("\n}\n").unwrap()];
    // The scan itself works: it finds a struct, a unit enum, a tuple enum and a key enum.
    for known in ["JobRecord", "JobStatus", "Action", "SquareJobKey"] {
        assert!(types.iter().any(|t| t == known), "the scan missed {known}");
    }
    for name in &types {
        let used = body
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .any(|w| w == name);
        assert!(used, "{name} is a #[contracttype] with no round trip");
    }
}

/// A refusal or skip reason travels as a `Symbol`: each text must be one, and
/// each must be the EVM constant's text with its spaces as underscores.
#[test]
fn reason_texts_are_the_evm_strings_as_symbols() {
    let env = Env::default();
    let evm = [
        "no proof bound",
        "malformed proof",
        "invalid proof",
        "is_compliant is 0",
        "policy commitment",
        "recipient",
        "amount",
        "token",
        "daily_spent_before",
        "timestamp outside window",
        "stripe_receipt_hash",
        "proof already used",
        "daily ceiling",
        "hook not authorised",
        "not a spender",
        "spend not recorded",
    ];
    for (reason, evm) in RefusalReason::ALL.iter().zip(evm) {
        assert_eq!(reason.text(), evm.replace(' ', "_"));
        let _ = reason.symbol(&env);
    }
    for (reason, evm) in [
        (SkipReason::UntrustedEvaluator, "untrusted evaluator"),
        (SkipReason::BudgetBelowMinimum, "budget below minimum"),
    ] {
        assert_eq!(reason.text(), evm.replace(' ', "_"));
        let _ = reason.symbol(&env);
    }
}

// ---------------------------------------------------------------- hashes against vectors.json

#[test]
fn finalize_reason_matches_the_vectors() {
    let env = Env::default();
    let v = vectors();
    for case in v["finalize_reason"].as_array().unwrap() {
        let job_id: u64 = case["job_id"].as_str().unwrap().parse().unwrap();
        let got = hash::finalize_reason(
            &env,
            job_id,
            &n32(&env, case["deliverable"].as_str().unwrap()),
        );
        assert_eq!(
            hex(got.to_array()),
            case["reason"].as_str().unwrap(),
            "job {job_id}"
        );
    }
}

#[test]
fn resolution_hash_matches_the_vectors() {
    let env = Env::default();
    let v = vectors();
    let outcome = |name: &str| match name {
        "None" => Outcome::None,
        "Complete" => Outcome::Complete,
        "Reject" => Outcome::Reject,
        "Lapsed" => Outcome::Lapsed,
        other => panic!("unknown outcome {other}"),
    };
    let cases = v["resolution_hash"].as_array().unwrap();
    assert_eq!(cases.len(), 12);
    for case in cases {
        let got = hash::resolution_hash(
            &env,
            7,
            outcome(case["outcome"].as_str().unwrap()),
            case["provider_bps"].as_u64().unwrap() as u32,
        );
        assert_eq!(hex(got.to_array()), case["hash"].as_str().unwrap());
    }
}

#[test]
fn statement_hash_matches_the_vector() {
    let env = Env::default();
    let v = vectors();
    let got = hash::statement_hash(
        &env,
        &bytes_of(&env, v["statement_hash"]["signals"].as_str().unwrap()),
    );
    assert_eq!(
        hex(got.to_array()),
        v["statement_hash"]["hash"].as_str().unwrap()
    );
}

#[test]
fn buyer_leaves_and_merkle_proofs_match_the_vectors() {
    let env = Env::default();
    let v = vectors();
    for case in v["buyer_leaf"].as_array().unwrap() {
        let buyer = addr(&env, case["buyer"].as_str().unwrap());
        assert_eq!(
            hex(sc_address_xdr(&env, &buyer).iter()),
            case["sc_address_xdr"].as_str().unwrap()
        );
        let leaf = hash::buyer_leaf(&env, &buyer, &n32(&env, case["salt"].as_str().unwrap()));
        assert_eq!(hex(leaf.to_array()), case["leaf"].as_str().unwrap());
    }
    let root = n32(&env, v["merkle"]["root"].as_str().unwrap());
    for case in v["merkle"]["proofs"].as_array().unwrap() {
        let leaf = n32(&env, case["leaf"].as_str().unwrap());
        let mut proof = Vec::new(&env);
        for p in case["proof"].as_array().unwrap() {
            proof.push_back(n32(&env, p.as_str().unwrap()));
        }
        assert!(
            hash::merkle_verify(&env, &proof, &root, &leaf),
            "{}",
            case["buyer"]
        );
        // The same proof does not admit a different leaf, and a changed sibling breaks it.
        let other = BytesN::from_array(&env, &[0xab; 32]);
        assert!(!hash::merkle_verify(&env, &proof, &root, &other));
        if !proof.is_empty() {
            proof.set(0, BytesN::from_array(&env, &[0xcd; 32]));
            assert!(!hash::merkle_verify(&env, &proof, &root, &leaf));
        }
    }
}

#[test]
fn evidence_hash_matches_the_vectors() {
    let env = Env::default();
    let v = vectors();
    let outcome = |name: &str| match name {
        "NotRun" => CheckOutcome::NotRun,
        "Passed" => CheckOutcome::Passed,
        "Failed" => CheckOutcome::Failed,
        other => panic!("unknown outcome {other}"),
    };
    let cases = v["evidence_hash"].as_array().unwrap();
    assert_eq!(cases.len(), 3);
    for case in cases {
        let screening = case["screening"].as_str().map(|s| n32(&env, s));
        let got = hash::evidence_hash(
            &env,
            case["job_id"].as_str().unwrap().parse().unwrap(),
            &addr(&env, case["payee"].as_str().unwrap()),
            case["amount"].as_str().unwrap().parse().unwrap(),
            &addr(&env, case["asset"].as_str().unwrap()),
            &screening,
            outcome(case["compliance_outcome"].as_str().unwrap()),
            outcome(case["screening_outcome"].as_str().unwrap()),
        );
        assert_eq!(hex(got.to_array()), case["commitment"].as_str().unwrap());
    }
}

#[test]
fn field_of_matches_the_vectors() {
    let env = Env::default();
    let v = vectors();
    let cases = v["address_field"].as_array().unwrap();
    assert_eq!(cases.len(), 4);
    for case in cases {
        let got = field_of(&env, &addr(&env, case["address"].as_str().unwrap()));
        assert_eq!(hex(got.to_array()), case["signal"].as_str().unwrap());
        assert!(bn254::is_scalar(
            &env,
            &U256::from_be_bytes(&env, &Bytes::from(got))
        ));
    }
}

#[test]
fn field_constants_are_r_and_p() {
    let env = Env::default();
    assert_eq!(
        hex(bn254::SCALAR_FIELD),
        "30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001"
    );
    assert_eq!(
        hex(bn254::BASE_FIELD),
        "30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47"
    );
    let r = bn254::scalar_field(&env);
    assert!(!bn254::is_scalar(&env, &r));
    assert!(bn254::is_scalar(&env, &r.sub(&U256::from_u32(&env, 1))));
}

// ---------------------------------------------------------------- TTL

#[contract]
struct Ttl;

#[contractimpl]
impl Ttl {
    pub fn __constructor(env: Env, cfg: TtlConfig) {
        ttl::set_config(&env, &cfg);
    }
    pub fn write_job(env: Env, key: u64, expired_at: u64, horizon: u64) -> u32 {
        env.storage().persistent().set(&key, &true);
        let cfg = ttl::config(&env);
        ttl::extend_for_settlement(&env, &cfg, &key, expired_at, horizon);
        env.storage().persistent().get_ttl(&key)
    }
    pub fn write_for_job(env: Env, key: u64, job: JobRecord) -> u32 {
        env.storage().persistent().set(&key, &true);
        ttl::bump_job(&env, &ttl::config(&env), &key, &job);
        env.storage().persistent().get_ttl(&key)
    }
    pub fn write_for_dispute(env: Env, key: u64, job: JobRecord, resolve_by: u64) -> u32 {
        env.storage().persistent().set(&key, &true);
        ttl::bump_dispute(&env, &ttl::config(&env), &key, &job, resolve_by);
        env.storage().persistent().get_ttl(&key)
    }
    pub fn write_until(env: Env, key: u64, end: u64) -> u32 {
        env.storage().persistent().set(&key, &true);
        let cfg = ttl::config(&env);
        ttl::extend_until(&env, &cfg, &key, end);
        env.storage().persistent().get_ttl(&key)
    }
}

const DAY: u64 = 86_400;

fn ttl_contract(env: &Env) -> (TtlClient<'_>, TtlConfig) {
    // Testnet's values on 2026-09-19 (docs/decisions/fees-and-ttl.md, "Seconds to ledgers").
    let cfg = TtlConfig {
        ledger_close_ms: 5_000,
        min_persistent_ttl: 120_960,
    };
    env.ledger().set_timestamp(1_789_000_000);
    env.ledger().set_sequence_number(1_000);
    let id = env.register(Ttl, (cfg,));
    (TtlClient::new(env, &id), cfg)
}

#[test]
fn ledgers_for_rounds_up() {
    let cfg = TtlConfig {
        ledger_close_ms: 5_000,
        min_persistent_ttl: 120_960,
    };
    assert_eq!(ttl::ledgers_for(&cfg, 0), 0);
    assert_eq!(ttl::ledgers_for(&cfg, 1), 1);
    assert_eq!(ttl::ledgers_for(&cfg, 5), 1);
    assert_eq!(ttl::ledgers_for(&cfg, 6), 2);
    assert_eq!(ttl::ledgers_for(&cfg, DAY), 17_280);
}

#[test]
fn a_job_expiring_inside_the_minimum_lifetime_keeps_the_ttl_it_was_created_with() {
    let env = Env::default();
    let (c, cfg) = ttl_contract(&env);
    let created = c.write_until(&1, &env.ledger().timestamp());
    // One day plus a 1 020 s horizon is below min_persistent_ttl: no extension happens.
    let after = c.write_job(&1, &(env.ledger().timestamp() + DAY), &1_020);
    assert!(after >= created);
    assert!(u64::from(after) >= u64::from(ttl::ledgers_for(&cfg, DAY + 1_020)));
}

#[test]
fn a_job_expiring_in_thirty_days_lives_until_expiry_plus_horizon_and_one_more_horizon() {
    let env = Env::default();
    let (c, cfg) = ttl_contract(&env);
    let horizon = 1_020;
    let got = c.write_job(&2, &(env.ledger().timestamp() + 30 * DAY), &horizon);
    let expected = ttl::ledgers_for(&cfg, 30 * DAY + horizon) + ttl::ledgers_for(&cfg, horizon);
    assert_eq!(got, expected);
}

#[test]
fn a_job_expiring_past_max_ttl_is_clamped_without_trapping() {
    let env = Env::default();
    let (c, _cfg) = ttl_contract(&env);
    let max = env.as_contract(&c.address, || env.storage().max_ttl());
    let got = c.write_job(&3, &(env.ledger().timestamp() + 10 * 365 * DAY), &1_020);
    assert_eq!(got, max);
}

#[test]
fn bump_job_uses_the_jobs_expiry_and_horizon() {
    let env = Env::default();
    let (c, cfg) = ttl_contract(&env);
    let mut job = sample_job(&env);
    job.expired_at = env.ledger().timestamp() + 30 * DAY;
    job.settlement_horizon = 1_020;
    let got = c.write_for_job(&4, &job);
    assert_eq!(
        got,
        ttl::ledgers_for(&cfg, 30 * DAY + 1_020) + ttl::ledgers_for(&cfg, 1_020)
    );
}

#[test]
fn bump_dispute_runs_to_the_later_of_expiry_and_resolve_by() {
    let env = Env::default();
    let (c, cfg) = ttl_contract(&env);
    let now = env.ledger().timestamp();
    let mut job = sample_job(&env);
    job.expired_at = now + 30 * DAY;
    job.settlement_horizon = 1_020;
    // A window added after create_job can put resolve_by past expiry (fees-and-ttl.md, class D).
    let later = c.write_for_dispute(&5, &job, &(now + 40 * DAY));
    assert_eq!(
        later,
        ttl::ledgers_for(&cfg, 40 * DAY + 1_020) + ttl::ledgers_for(&cfg, 1_020)
    );
    let earlier = c.write_for_dispute(&6, &job, &(now + DAY));
    assert_eq!(
        earlier,
        ttl::ledgers_for(&cfg, 30 * DAY + 1_020) + ttl::ledgers_for(&cfg, 1_020)
    );
}

#[test]
fn setting_the_config_publishes_it() {
    let env = Env::default();
    let cfg = TtlConfig {
        ledger_close_ms: 5_000,
        min_persistent_ttl: 120_960,
    };
    let id = env.register(Ttl, (cfg,));
    assert_eq!(
        env.events().all().filter_by_contract(&id),
        [TtlConfigUpdated {
            ledger_close_ms: 5_000,
            min_persistent_ttl: 120_960
        }
        .to_xdr(&env, &id)]
    );
}

#[test]
fn a_config_of_zeroes_is_refused() {
    let env = Env::default();
    let bad = TtlConfig {
        ledger_close_ms: 0,
        min_persistent_ttl: 120_960,
    };
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(Ttl, (bad,));
    }));
    assert!(refused.is_err());
}
