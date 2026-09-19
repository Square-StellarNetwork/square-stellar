//! keccak256 preimages, with explicit byte layouts instead of `abi.encode`
//! (#8). `packages/core` builds the same bytes; both sides are held to
//! `contracts/test-support/vectors.json`.

use soroban_sdk::{Address, Bytes, BytesN, Env};

use crate::address::sc_address_xdr;
use crate::types::{CheckOutcome, Outcome};

pub const FINALIZE_TAG: &[u8] = b"square.finalize.v1";
pub const RESOLUTION_TAG: &[u8] = b"square.resolution.v1";
pub const EVIDENCE_TAG: &[u8] = b"square.evidence.v1";

/// keccak256("square.finalize.v1" || job_id (u64 BE) || deliverable (32)).
pub fn finalize_reason(env: &Env, job_id: u64, deliverable: &BytesN<32>) -> BytesN<32> {
    let mut pre = Bytes::from_slice(env, FINALIZE_TAG);
    pre.extend_from_array(&job_id.to_be_bytes());
    pre.append(&Bytes::from(deliverable.clone()));
    env.crypto().keccak256(&pre).into()
}

/// keccak256("square.resolution.v1" || job_id (u64 BE) || outcome (u32 BE) || provider_bps (u32 BE)).
pub fn resolution_hash(env: &Env, job_id: u64, outcome: Outcome, provider_bps: u32) -> BytesN<32> {
    let mut pre = Bytes::from_slice(env, RESOLUTION_TAG);
    pre.extend_from_array(&job_id.to_be_bytes());
    pre.extend_from_array(&(outcome as u32).to_be_bytes());
    pre.extend_from_array(&provider_bps.to_be_bytes());
    env.crypto().keccak256(&pre).into()
}

/// The settlement evidence `square_hook` writes to the validation registry as
/// its `response_hash`, and publishes beside it in `EvidenceRecorded`:
///
/// keccak256("square.evidence.v1" || job_id (u64 BE) || ScAddress XDR(payee)
/// || amount (i128 BE, 16) || ScAddress XDR(token) || screening (0x00, or
/// 0x01 || 32 bytes) || compliance_outcome (u32 BE) || screening_outcome (u32 BE)).
///
/// An `ScAddress` carries its own type tag, so the variable-length fields
/// cannot run into each other.
#[allow(clippy::too_many_arguments)]
pub fn evidence_hash(
    env: &Env,
    job_id: u64,
    payee: &Address,
    amount: i128,
    token: &Address,
    screening: &Option<BytesN<32>>,
    compliance_outcome: CheckOutcome,
    screening_outcome: CheckOutcome,
) -> BytesN<32> {
    let mut pre = Bytes::from_slice(env, EVIDENCE_TAG);
    pre.extend_from_array(&job_id.to_be_bytes());
    pre.append(&sc_address_xdr(env, payee));
    pre.extend_from_array(&amount.to_be_bytes());
    pre.append(&sc_address_xdr(env, token));
    match screening {
        Some(record) => {
            pre.push_back(1);
            pre.append(&Bytes::from(record.clone()));
        }
        None => pre.push_back(0),
    }
    pre.extend_from_array(&(compliance_outcome as u32).to_be_bytes());
    pre.extend_from_array(&(screening_outcome as u32).to_be_bytes());
    env.crypto().keccak256(&pre).into()
}

/// keccak256 of the eight public signals, each 32 bytes big-endian: the same
/// bytes as the EVM's `keccak256(abi.encode(uint256[8]))`.
pub fn statement_hash(env: &Env, signals: &Bytes) -> BytesN<32> {
    env.crypto().keccak256(signals).into()
}

/// keccak256(keccak256(ScAddress XDR(buyer) || salt)): a leaf is the hash of a
/// 32-byte inner hash, an internal node the hash of 64 bytes, so a leaf can
/// never pass for a node (docs/decisions/buyer-eligibility.md).
pub fn buyer_leaf(env: &Env, buyer: &Address, salt: &BytesN<32>) -> BytesN<32> {
    let mut pre = sc_address_xdr(env, buyer);
    pre.append(&Bytes::from(salt.clone()));
    let inner: BytesN<32> = env.crypto().keccak256(&pre).into();
    env.crypto().keccak256(&Bytes::from(inner)).into()
}

/// A sorted-pair keccak256 Merkle proof, the rule OpenZeppelin's `MerkleProof`
/// and `packages/core/src/buyers.ts` use: each step hashes the smaller node first.
pub fn merkle_verify(
    env: &Env,
    proof: &soroban_sdk::Vec<BytesN<32>>,
    root: &BytesN<32>,
    leaf: &BytesN<32>,
) -> bool {
    let mut node = leaf.clone();
    for sibling in proof.iter() {
        let (lo, hi) = if node.to_array() <= sibling.to_array() {
            (node, sibling)
        } else {
            (sibling, node)
        };
        let mut pre = Bytes::from(lo);
        pre.append(&Bytes::from(hi));
        node = env.crypto().keccak256(&pre).into();
    }
    node == *root
}
