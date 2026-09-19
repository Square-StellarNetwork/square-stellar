// The proof encoding the Stellar verifier reads: docs/decisions/groth16-on-soroban.md.
//
// Getting the byte order wrong does not produce a wrong answer, it produces a
// host error (`Error(Crypto, InvalidInput)` for a G2 point in snarkjs' own
// limb order) or a proof that fails to verify, either of which looks like a
// broken circuit, key or contract and is none of those. So rather than assert
// the layout against a description, this holds `encodeForSoroban` to the
// vectors contracts/probes/groth16_probe carries — the bytes the probe
// contract verified on the Soroban host and on testnet — and, with artifacts,
// to a proof this service made, checked by snarkjs against the same key.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { encodeForSoroban, encodeVerifyingKey } from '../src/convert.js';
import { addressToField } from '../src/hash.js';
import { generateProof } from '../src/prover.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PROBE = path.resolve(HERE, '..', '..', '..', 'contracts', 'probes', 'groth16_probe');
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(PROBE, ...parts), 'utf8'));

const ARTIFACTS = process.env.PROVER_ARTIFACTS_DIR
  ? path.resolve(process.env.PROVER_ARTIFACTS_DIR)
  : path.resolve(HERE, '..', 'artifacts');
const HAVE_ARTIFACTS = fs.existsSync(path.join(ARTIFACTS, 'payment.wasm'))
  && fs.existsSync(path.join(ARTIFACTS, 'payment.zkey'));

const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

describe('the Soroban proof blob', () => {
  const vectors = read('vectors.json');
  const proof = read('snarkjs', 'proof.json');
  const publicSignals = read('snarkjs', 'public.json');
  const vk = read('snarkjs', 'vk.json');
  const snarkjsSet = vectors.sets.snarkjs;
  const vector = (name) => snarkjsSet.cases.find((c) => c.name === name);

  it('is the probe vector, byte for byte, for snarkjs\'s own proof', () => {
    const encoded = encodeForSoroban(proof, publicSignals);
    expect(encoded.proof).toBe(`0x${vector('compliant').proof}`);
    expect(encoded.proof).toHaveLength(2 + 512 * 2);
    expect(encoded.proof).toBe(`0x${[encoded.a, encoded.b, encoded.c, ...encoded.input].map((h) => h.slice(2)).join('')}`);
    expect(encoded.a).toHaveLength(2 + 64 * 2);
    expect(encoded.b).toHaveLength(2 + 128 * 2);
    expect(encoded.c).toHaveLength(2 + 64 * 2);
    expect(encoded.input).toHaveLength(8);
  });

  it('writes G2 with the imaginary part first, which is what the host takes', () => {
    // snarkjs writes [c0, c1]; the blob carries be(c1) || be(c0).
    const [[x0, x1], [y0, y1]] = proof.pi_b;
    const b = encodeForSoroban(proof, publicSignals).b.slice(2);
    const word = (v) => BigInt(v).toString(16).padStart(64, '0');
    expect(b).toBe(word(x1) + word(x0) + word(y1) + word(y0));
    // The probe's "error" vector is the same proof with each pair in snarkjs's
    // order, the one the host refuses with Error(Crypto, InvalidInput): swapping
    // the pairs of the valid vector's B segment gives it exactly.
    const fixtures = vectors.sets.fixtures;
    const valid = fixtures.cases.find((c) => c.name === 'compliant').proof;
    const wrongOrder = fixtures.cases.find((c) => c.name === 'compliant_with_b_in_snarkjs_order');
    expect(wrongOrder.expect).toBe('error');
    const segment = valid.slice(128, 384);
    const swapped = [segment.slice(64, 128), segment.slice(0, 64), segment.slice(192, 256), segment.slice(128, 192)].join('');
    expect(wrongOrder.proof).toBe(valid.slice(0, 128) + swapped + valid.slice(384));
  });

  it('carries the signals unreduced, so a tampered one is the verifier\'s to refuse', () => {
    // Every case in the snarkjs set is this proof with its signals as the
    // case carries them; the encoder reproduces each blob from those signals,
    // so a tampered signal changes exactly its own word. The flipped and the
    // changed-amount cases are "invalid": the verifier answers false, nothing
    // here reduces or refuses them.
    for (const c of snarkjsSet.cases) {
      const words = c.proof.slice(512).match(/.{64}/g);
      expect(words).toHaveLength(8);
      const signals = words.map((w) => BigInt(`0x${w}`).toString());
      expect(encodeForSoroban(proof, signals).proof).toBe(`0x${c.proof}`);
    }
    const flipped = snarkjsSet.cases.find((c) => c.name === 'compliant_with_is_compliant_flipped');
    expect(flipped.expect).toBe('invalid');
    expect(flipped.proof.slice(0, 512)).toBe(snarkjsSet.cases[0].proof.slice(0, 512));
    // s + r is carried as it is; the verifier's own s < r check is what refuses it.
    const plusR = [...publicSignals];
    plusR[2] = (BigInt(plusR[2]) + BN254_R).toString();
    expect(encodeForSoroban(proof, plusR).input[2]).toBe(`0x${BigInt(plusR[2]).toString(16).padStart(64, '0')}`);
    expect(() => encodeForSoroban(proof, [...publicSignals.slice(0, 7), (2n ** 256n).toString()])).toThrow(/32 bytes/);
  });

  it('refuses a coordinate that is not below p, and a point that is not affine', () => {
    const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
    expect(() => encodeForSoroban({ ...proof, pi_a: [p.toString(), proof.pi_a[1], '1'] }, publicSignals)).toThrow(/out of range/);
    expect(() => encodeForSoroban({ ...proof, pi_a: [proof.pi_a[0], proof.pi_a[1], '2'] }, publicSignals)).toThrow(/affine/);
  });

  it('encodes the verification key as the probe takes it', () => {
    const encoded = encodeVerifyingKey(vk);
    expect(encoded.blob).toBe(`0x${snarkjsSet.vk}`);
    expect(encoded.ic).toHaveLength(9);
    expect(encoded.blob).toHaveLength(2 + (64 + 3 * 128 + 9 * 64) * 2);
    expect(() => encodeVerifyingKey({ ...vk, curve: 'bls12381' })).toThrow(/groth16 over bn128/);
  });
});

describe('f, the field element of an address', () => {
  // The decision record's vectors (contracts/probes/address_field_probe), which
  // the probe contract is tested against: this is the third implementation of
  // f, after the probe's script and the circuit's test helper.
  const { vectors } = JSON.parse(fs.readFileSync(path.resolve(PROBE, '..', 'address_field_probe', 'vectors.json'), 'utf8'));

  it('lands on the decision record\'s integers, below r, for accounts and contracts alike', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(4);
    for (const vector of vectors) {
      expect(addressToField(vector.address, vector.name), vector.name).toBe(vector.decimal);
      expect(BigInt(vector.decimal) < BN254_R).toBe(true);
    }
  });

  it('refuses what is not an address, by field name, without the value', () => {
    for (const bad of ['acme-corp', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'.toLowerCase(), 'MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAAAA', '']) {
      let message;
      try {
        addressToField(bad, 'payment_recipient');
      } catch (error) {
        message = error.message;
      }
      expect(message).toBe('payment_recipient: must be a Stellar account (G…) or contract (C…) address');
    }
  });
});

// Real testnet addresses: the USDC SAC, the auth probe's client and payer, and
// the pubnet USDC issuer as the blocked account (docs/decisions/*.md).
const REQUEST = {
  policy_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  policy_salt: '7777777777777777777777777777777777777777777777777777777777777',
  operator_id: 'GCYUOI4ZTDRVX4STYKSQOZRSD3ZJ6ALX43WTS2N3M5LES63PW5IM272D',
  max_daily_spend: '1000000000',
  max_per_transaction: '100000000',
  allowed_endpoint_categories: ['api-call'],
  blocked_addresses: ['GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'],
  token_whitelist: ['CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'],
  payment_amount: '50000000',
  payment_token: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  payment_recipient: 'GBGFKN6QTTVHBK6JLS2NAVDBW6VRA74HUPF7HS66HXL7YGEACA4SXOQ3',
  payment_endpoint_category: 'api-call',
  daily_spent_before: '500000000',
  current_unix_timestamp: '1788356730',
};

describe.skipIf(!HAVE_ARTIFACTS)('a proof this service made, with Stellar addresses', () => {
  // The key is read out of the zkey itself: the artifact directory holds the
  // wasm and the zkey wherever the service runs, and payment_vk.json only
  // where a build left it beside them.
  const verifyingKey = async () => (await import('snarkjs')).zKey.exportVerificationKey(path.join(ARTIFACTS, 'payment.zkey'));

  it('verifies with snarkjs and carries f of the addresses in the blob', async () => {
    const snarkjs = await import('snarkjs');
    const result = await generateProof(REQUEST);
    expect(result.is_compliant).toBe(true);
    const key = await verifyingKey();
    expect(await snarkjs.groth16.verify(key, result.raw_public, result.raw_proof)).toBe(true);

    const { soroban } = result;
    expect(soroban.proof).toBe(`0x${[soroban.a, soroban.b, soroban.c, ...soroban.input].map((h) => h.slice(2)).join('')}`);
    expect(soroban.proof).toHaveLength(2 + 512 * 2);
    expect(soroban.input.map((hex) => BigInt(hex).toString())).toEqual(result.raw_public);
    // Signals 2 and 4 are f of the payee and the token: the decision record's
    // vectors for these two addresses.
    expect(soroban.input[2]).toBe(`0x${BigInt(addressToField(REQUEST.payment_recipient)).toString(16).padStart(64, '0')}`);
    expect(soroban.input[2].startsWith('0x00')).toBe(true);
    expect(soroban.input[4]).toBe('0x00f3f621aaa28a2f21130f183b450020ee2016bb79edd9fdaf15bf5ecba4f002');
    expect(soroban.input[3]).toBe(`0x${(50000000n).toString(16).padStart(64, '0')}`);
    // The Solidity shape stays beside it while the EVM contracts remain.
    expect(result.solidity.input).toHaveLength(8);
  });

  it('is the same blob for the same proof, and a different one for a tampered signal', async () => {
    const result = await generateProof(REQUEST);
    const again = encodeForSoroban(result.raw_proof, result.raw_public);
    expect(again.proof).toBe(result.soroban.proof);
    const tampered = [...result.raw_public];
    tampered[3] = '1';
    expect(encodeForSoroban(result.raw_proof, tampered).proof).not.toBe(result.soroban.proof);
    const key = await verifyingKey();
    const snarkjs = await import('snarkjs');
    expect(await snarkjs.groth16.verify(key, tampered, result.raw_proof)).toBe(false);
  });
});

describe.skipIf(HAVE_ARTIFACTS)('a proof this service made', () => {
  it('skipped: no circuit artifacts present', () => {
    expect(HAVE_ARTIFACTS).toBe(false);
  });
});
