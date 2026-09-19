// f, the one field element a 32-byte Stellar address becomes, in the helper
// every other suite here builds its inputs with.
//
// The circuit cannot check f: an address arrives as a field element and is only
// ever compared for equality. So the helper that makes those elements is held
// to the reference instead, contracts/probes/address_field_probe/vectors.json,
// which the address_field_probe contract asserts byte for byte. If the two
// drifted, every test below would still pass on inputs the compliance module
// would never produce, and a proof about the payee would name nobody the chain
// can see (docs/decisions/address-field-mapping.md).

import { describe, it, expect } from 'vitest';
import { Keypair, MuxedAccount, Account, Address } from '@stellar/stellar-sdk/base';
import { ADDRESSES, VECTOR_OF, addressToField, addressXdr } from './helpers/inputs.mjs';
import { addressVector, signalHex } from './helpers/signals.mjs';

const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const NAMES = ['usdc_issuer_testnet', 'usdc_sac_testnet', 'usdc_issuer_pubnet', 'usdc_sac_pubnet'];

describe('f in the test helpers', () => {
  it.each(NAMES)('writes the XDR bytes the reference records for %s', (name) => {
    const vector = addressVector(name);
    expect(addressXdr(vector.address).toString('hex')).toBe(vector.scval_xdr);
  });

  it.each(NAMES)('lands on the reference field element for %s', (name) => {
    const vector = addressVector(name);
    expect(addressToField(vector.address)).toBe(vector.decimal);
    expect(signalHex(addressToField(vector.address))).toBe(vector.signal);
  });

  it('is below 2^248, so below r, with the first signal byte zero', () => {
    for (const name of NAMES) {
      const value = BigInt(addressToField(addressVector(name).address));
      expect(value < 1n << 248n).toBe(true);
      expect(value < R).toBe(true);
      expect(signalHex(value).slice(0, 2)).toBe('00');
    }
  });

  // #4 named Address.toScAddress().toXDR(). That is the bare ScAddress, four
  // bytes shorter than what a contract's `Address::to_xdr` writes, and an f
  // over it would disagree with the compliance module on every address.
  it('hashes the ScVal, not the bare ScAddress', () => {
    for (const name of NAMES) {
      const { address } = addressVector(name);
      const scVal = addressXdr(address);
      const scAddress = Address.fromString(address).toScAddress().toXDR();
      expect(scVal.subarray(0, 4).toString('hex')).toBe('00000012');
      expect(scVal.subarray(4).equals(scAddress)).toBe(true);
    }
  });

  it('names the four addresses the suites use after their vectors', () => {
    for (const [key, name] of Object.entries(VECTOR_OF)) {
      expect(ADDRESSES[key]).toBe(addressVector(name).address);
    }
  });

  it('takes both kinds: a G… account and a C… contract', () => {
    expect(ADDRESSES.provider.startsWith('G')).toBe(true);
    expect(ADDRESSES.usdc.startsWith('C')).toBe(true);
    expect(addressToField(ADDRESSES.provider)).not.toBe(addressToField(ADDRESSES.usdc));
    // The operator is a keypair's public key, drawn for these tests.
    expect(BigInt(addressToField(ADDRESSES.operator)) < 1n << 248n).toBe(true);
  });

  // Anything that is not a G… or C… strkey is refused rather than hashed: a
  // wrong string would otherwise become a field element that matches nothing,
  // and a blocked-list entry that matches nothing blocks nobody.
  it.each([
    ['a muxed account (M…)', () => new MuxedAccount(new Account(ADDRESSES.provider, '0'), '7').accountId()],
    ['a lowercased strkey', () => ADDRESSES.provider.toLowerCase()],
    ['a strkey with a broken checksum', () => `${ADDRESSES.provider.slice(0, -1)}${ADDRESSES.provider.endsWith('A') ? 'B' : 'A'}`],
    ['a 20-byte EVM address', () => '0x3600000000000000000000000000000000000000'],
    ['an empty string', () => ''],
  ])('refuses %s', (_, make) => {
    expect(() => addressToField(make())).toThrow(/not a Stellar account \(G…\) or contract \(C…\) address/);
  });

  it('still takes a freshly drawn account, whatever its key', () => {
    const value = BigInt(addressToField(Keypair.random().publicKey()));
    expect(value < 1n << 248n).toBe(true);
  });
});
