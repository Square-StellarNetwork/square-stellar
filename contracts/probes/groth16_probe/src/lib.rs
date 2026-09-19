//! Groth16 over BN254 with Soroban's host functions (CAP-0074, CAP-0080).
//!
//! This is the probe docs/decisions/groth16-on-soroban.md was decided on, not
//! the verifier Square deploys: `groth16_verifier` (#10) embeds its key, this
//! takes the key as an argument so one deployment can check any key's proofs.
//!
//! Byte layout (the decision record has the derivation):
//!   vk    = alpha(G1) || beta(G2) || gamma(G2) || delta(G2) || IC_0..IC_n(G1)
//!   proof = A(G1) || B(G2) || C(G1) || n x signal(32, big-endian)
//!   G1 = be(X) || be(Y); G2 = be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0)
//!
//! The check is e(-A, B) * e(vk_x, gamma) * e(C, delta) * e(alpha, beta) == 1
//! with vk_x = IC_0 + sum(signal_i * IC_i), the equation
//! contracts/src/Groth16Verifier.sol evaluates on EVM precompiles.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    panic_with_error, vec, Bytes, BytesN, Env, Vec, U256,
};

const G1: u32 = 64;
const G2: u32 = 128;
const WORD: u32 = 32;
const PROOF_POINTS: u32 = G1 + G2 + G1;
const VK_FIXED: u32 = G1 + 3 * G2;

/// r, the order of BN254's scalar field, big-endian.
const R: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ProbeError {
    /// The proof is not 256 bytes of points followed by whole 32-byte signals.
    ProofLength = 1,
    /// The key does not carry one IC point per signal, plus IC_0.
    KeyLength = 2,
}

#[contract]
pub struct Groth16Probe;

#[contractimpl]
impl Groth16Probe {
    /// True when `proof` verifies against `vk`. A signal that is not below r
    /// is refused before any curve arithmetic, as the EVM verifier refuses it:
    /// `Fr` reduces modulo r, so without the check `s` and `s + r` would both
    /// verify. Points that do not decode, or lie off the curve, make the host
    /// trap rather than return false.
    pub fn verify(env: Env, vk: Bytes, proof: Bytes) -> bool {
        let len = proof.len();
        if len < PROOF_POINTS || (len - PROOF_POINTS) % WORD != 0 {
            panic_with_error!(&env, ProbeError::ProofLength);
        }
        let n = (len - PROOF_POINTS) / WORD;
        if vk.len() != VK_FIXED + (n + 1) * G1 {
            panic_with_error!(&env, ProbeError::KeyLength);
        }

        let r = U256::from_be_bytes(&env, &Bytes::from_array(&env, &R));
        let mut scalars: Vec<Bn254Fr> = Vec::new(&env);
        let mut ic: Vec<Bn254G1Affine> = Vec::new(&env);
        for i in 0..n {
            let at = PROOF_POINTS + i * WORD;
            let signal = U256::from_be_bytes(&env, &proof.slice(at..at + WORD));
            if signal >= r {
                return false;
            }
            scalars.push_back(Bn254Fr::from_u256(signal));
            ic.push_back(g1(&vk, VK_FIXED + (i + 1) * G1));
        }

        let bn = env.crypto().bn254();
        let vk_x = bn.g1_add(&g1(&vk, VK_FIXED), &bn.g1_msm(ic, scalars));

        let a = g1(&proof, 0);
        let b = g2(&proof, G1);
        let c = g1(&proof, G1 + G2);
        let alpha = g1(&vk, 0);
        let beta = g2(&vk, G1);
        let gamma = g2(&vk, G1 + G2);
        let delta = g2(&vk, G1 + 2 * G2);

        bn.pairing_check(vec![&env, -a, vk_x, c, alpha], vec![&env, b, gamma, delta, beta])
    }
}

fn g1(bytes: &Bytes, at: u32) -> Bn254G1Affine {
    let raw: BytesN<64> = bytes.slice(at..at + G1).try_into().unwrap();
    Bn254G1Affine::from_bytes(raw)
}

fn g2(bytes: &Bytes, at: u32) -> Bn254G2Affine {
    let raw: BytesN<128> = bytes.slice(at..at + G2).try_into().unwrap();
    Bn254G2Affine::from_bytes(raw)
}

#[cfg(test)]
mod test;
