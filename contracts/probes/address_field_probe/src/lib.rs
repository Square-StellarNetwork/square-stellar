//! f(addr) = sha256(XDR(ScVal::Address(addr)))[0..31], as the 32-byte signal
//! 0x00 || those 31 bytes (docs/decisions/address-field-mapping.md, #4).
//!
//! `compliance_module` (#12) computes exactly this for the payee and the token
//! and compares it with the proof's `recipient` and `token` signals.
#![no_std]

use soroban_sdk::{contract, contractimpl, xdr::ToXdr, Address, BytesN, Env};

#[contract]
pub struct AddressFieldProbe;

#[contractimpl]
impl AddressFieldProbe {
    pub fn field_of(env: Env, addr: Address) -> BytesN<32> {
        let digest = env.crypto().sha256(&addr.to_xdr(&env)).to_array();
        let mut signal = [0u8; 32];
        signal[1..].copy_from_slice(&digest[..31]);
        BytesN::from_array(&env, &signal)
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::String;

    fn hex(bytes: impl IntoIterator<Item = u8>) -> std::string::String {
        bytes.into_iter().map(|b| std::format!("{b:02x}")).collect()
    }

    #[test]
    fn the_contract_gives_the_vectors_the_js_implementation_wrote() {
        let file: serde_json::Value = serde_json::from_str(include_str!("../vectors.json")).unwrap();
        let vectors = file["vectors"].as_array().unwrap();
        assert_eq!(vectors.len(), 4);
        let env = Env::default();
        let id = env.register(AddressFieldProbe, ());
        let client = AddressFieldProbeClient::new(&env, &id);
        for v in vectors {
            let strkey = v["address"].as_str().unwrap();
            let addr = Address::from_string(&String::from_str(&env, strkey));
            assert_eq!(hex(addr.clone().to_xdr(&env).iter()), v["scval_xdr"].as_str().unwrap(), "XDR of {strkey}");
            let got = hex(client.field_of(&addr).to_array());
            std::println!("{:20} {} -> {}", v["name"].as_str().unwrap(), strkey, got);
            assert_eq!(got, v["signal"].as_str().unwrap(), "f({strkey})");
        }
    }
}
