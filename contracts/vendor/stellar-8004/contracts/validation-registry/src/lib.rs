#![no_std]

use soroban_sdk::contractmeta;
contractmeta!(key = "Description", val = "8004 Validation Registry");
contractmeta!(key = "Version", val = "0.1.0");

pub mod contract;
pub mod errors;
pub mod events;
pub mod storage;
pub mod types;

