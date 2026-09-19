//! # Stellar Tokens
//!
//! This crate provides implementations for both fungible and non-fungible
//! tokens for use in Soroban smart contracts on the Stellar network.
//!
//! ## Modules
//!
//! - `fungible`: Implementation of fungible tokens (similar to ERC-20)
//! - `non_fungible`: Implementation of non-fungible tokens (similar to ERC-721)
//!
//! Each module provides its own set of traits, functions, and extensions for
//! working with the respective token type.

#![no_std]

// Port (contracts/vendor/stellar-8004/PORTING.md): upstream also declares
// `fungible`, `rwa` and `vault`. The 8004 registries use only `non_fungible`,
// so the other three are not vendored.
pub mod non_fungible;
