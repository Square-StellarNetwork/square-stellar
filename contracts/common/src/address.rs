//! Addresses as bytes (docs/decisions/address-field-mapping.md, #4).

use soroban_sdk::{xdr::ToXdr, Address, Bytes, BytesN, Env};

/// Length of the `ScVal` discriminant that `Address::to_xdr` puts before the
/// `ScAddress` (`SCV_ADDRESS`, 4 bytes).
const SCVAL_TAG: u32 = 4;

/// f(addr) = sha256(XDR(ScVal::Address(addr)))[0..31], as the 32-byte
/// big-endian field element 0x00 || those 31 bytes. Always < r.
pub fn field_of(env: &Env, addr: &Address) -> BytesN<32> {
    let digest = env.crypto().sha256(&addr.clone().to_xdr(env)).to_array();
    let mut signal = [0u8; 32];
    signal[1..].copy_from_slice(&digest[..31]);
    BytesN::from_array(env, &signal)
}

/// The XDR of the bare `ScAddress` (no `ScVal` tag): the buyer-leaf preimage
/// the claim market hashes (#16).
pub fn sc_address_xdr(env: &Env, addr: &Address) -> Bytes {
    let full = addr.clone().to_xdr(env);
    full.slice(SCVAL_TAG..full.len())
}
