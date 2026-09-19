extern crate std;

use super::*;
use soroban_sdk::Bytes;
use std::{println, string::String, vec::Vec as StdVec};

const VECTORS: &str = include_str!("../vectors.json");

fn hex(env: &Env, text: &str) -> Bytes {
    let raw: StdVec<u8> = (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect();
    Bytes::from_slice(env, &raw)
}

struct Case {
    set: String,
    name: String,
    expect: String,
    vk: String,
    proof: String,
}

fn cases() -> StdVec<Case> {
    let root: serde_json::Value = serde_json::from_str(VECTORS).unwrap();
    let mut out = StdVec::new();
    for (set, body) in root["sets"].as_object().unwrap() {
        let vk = body["vk"].as_str().unwrap();
        for case in body["cases"].as_array().unwrap() {
            out.push(Case {
                set: set.clone(),
                name: case["name"].as_str().unwrap().into(),
                expect: case["expect"].as_str().unwrap().into(),
                vk: vk.into(),
                proof: case["proof"].as_str().unwrap().into(),
            });
        }
    }
    out
}

/// Every vector has the outcome it declares, on the same host code the network runs.
#[test]
fn every_vector_has_its_declared_outcome() {
    let all = cases();
    assert_eq!(all.len(), 14);
    for case in all {
        let env = Env::default();
        let id = env.register(Groth16Probe, ());
        let client = Groth16ProbeClient::new(&env, &id);
        let result = client.try_verify(&hex(&env, &case.vk), &hex(&env, &case.proof));
        let outcome = match result {
            Ok(Ok(true)) => "valid",
            Ok(Ok(false)) => "invalid",
            _ => "error",
        };
        println!("{:9} {:36} {}", case.set, case.name, outcome);
        assert_eq!(outcome, case.expect, "{}/{}", case.set, case.name);
    }
}

/// One verification of the prover's compliant proof, as the local host meters it.
#[test]
fn cost_of_one_verification() {
    let case = cases().into_iter().find(|c| c.set == "fixtures" && c.name == "compliant").unwrap();
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let id = env.register(Groth16Probe, ());
    let client = Groth16ProbeClient::new(&env, &id);
    let vk = hex(&env, &case.vk);
    let proof = hex(&env, &case.proof);
    env.cost_estimate().budget().reset_unlimited();
    assert!(client.verify(&vk, &proof));
    let budget = env.cost_estimate().budget();
    println!("cpu_instructions {}", budget.cpu_instruction_cost());
    println!("memory_bytes {}", budget.memory_bytes_cost());
    budget.print();
}

#[test]
fn a_proof_of_the_wrong_length_is_refused() {
    let env = Env::default();
    let id = env.register(Groth16Probe, ());
    let client = Groth16ProbeClient::new(&env, &id);
    let result = client.try_verify(&Bytes::new(&env), &Bytes::from_array(&env, &[0u8; 257]));
    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(ProbeError::ProofLength as u32))));
}
