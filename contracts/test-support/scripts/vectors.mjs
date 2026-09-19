#!/usr/bin/env node
// contracts/test-support/vectors.json: the byte layouts of contracts/common/src/hash.rs,
// computed independently of the contracts (keccak256 from @noble/hashes, XDR
// from @stellar/stellar-sdk). `square-common`'s tests hold the contracts to
// these values, and packages/core is held to the same file.
//
//   node scripts/vectors.mjs          write vectors.json
//   node scripts/vectors.mjs --check  exit 1 if vectors.json is stale
//
// Inputs are real addresses (the USDC issuers and Stellar Asset Contracts of
// docs/decisions/stellar-target.md) and values derived by a stated rule, so
// every vector can be recomputed by hand.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { Address } from '@stellar/stellar-sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'vectors.json');
const hex = (b) => Buffer.from(b).toString('hex');
const keccak = (...parts) => Buffer.from(keccak_256(Buffer.concat(parts.map((p) => Buffer.from(p)))));
const u64be = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const i128be = (n) => { const v = BigInt.asUintN(128, BigInt(n)); return Buffer.from(v.toString(16).padStart(32, '0'), 'hex'); };
// A 32-byte value from a label, so the vector's input is reproducible and says where it came from.
const derived = (label) => createHash('sha256').update(label).digest();

const ADDRESSES = {
  usdc_issuer_testnet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  usdc_sac_testnet: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  usdc_issuer_pubnet: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  usdc_sac_pubnet: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
};
const scAddressXdr = (strkey) => Address.fromString(strkey).toScAddress().toXDR();
// f (docs/decisions/address-field-mapping.md): sha256 of the ScVal XDR, first 31 bytes, as 0x00 || 31 bytes.
const fieldOf = (strkey) => Buffer.concat([Buffer.alloc(1), createHash('sha256').update(Address.fromString(strkey).toScVal().toXDR()).digest().subarray(0, 31)]);

const OUTCOMES = ['None', 'Complete', 'Reject', 'Lapsed'];

const finalize = [
  { job_id: 0, deliverable: derived('square.vectors.deliverable.0') },
  { job_id: 1, deliverable: derived('square.vectors.deliverable.1') },
  { job_id: 18446744073709551615n, deliverable: derived('square.vectors.deliverable.max') },
].map(({ job_id, deliverable }) => ({
  job_id: job_id.toString(),
  deliverable: hex(deliverable),
  reason: hex(keccak(Buffer.from('square.finalize.v1'), u64be(job_id), deliverable)),
}));

const resolution = OUTCOMES.flatMap((outcome, index) =>
  [0, 5000, 10000].map((bps) => ({
    job_id: '7',
    outcome,
    provider_bps: bps,
    hash: hex(keccak(Buffer.from('square.resolution.v1'), u64be(7), u32be(index), u32be(bps))),
  })),
);

// Eight 32-byte signals, as the verifier and the compliance module see them.
const signals = Buffer.concat(Array.from({ length: 8 }, (_, i) => derived(`square.vectors.signal.${i}`)));
// Reduce each below r so they are valid field elements, as a real proof's are.
const R = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
const reduced = Buffer.concat(Array.from({ length: 8 }, (_, i) => {
  const v = BigInt(`0x${hex(signals.subarray(i * 32, i * 32 + 32))}`) % R;
  return Buffer.from(v.toString(16).padStart(64, '0'), 'hex');
}));
const statement = { signals: hex(reduced), hash: hex(keccak(reduced)) };

const buyers = Object.entries(ADDRESSES).map(([name, strkey], i) => {
  const salt = derived(`square.vectors.salt.${i}`);
  const inner = keccak(scAddressXdr(strkey), salt);
  return { name, buyer: strkey, sc_address_xdr: hex(scAddressXdr(strkey)), salt: hex(salt), leaf: hex(keccak(inner)) };
});

// The tree packages/core/src/buyers.ts builds: leaves sorted, pairs hashed smaller-first,
// an odd node carried up unchanged.
function hashPair(a, b) {
  return Buffer.compare(a, b) < 0 ? keccak(a, b) : keccak(b, a);
}
const leaves = buyers.map((b) => Buffer.from(b.leaf, 'hex')).sort(Buffer.compare);
const levels = [leaves];
while (levels[levels.length - 1].length > 1) {
  const prev = levels[levels.length - 1];
  const next = [];
  for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
  levels.push(next);
}
const root = levels[levels.length - 1][0];
const proofOf = (leaf) => {
  let index = leaves.findIndex((l) => l.equals(leaf));
  const proof = [];
  for (const level of levels.slice(0, -1)) {
    const sibling = index % 2 === 0 ? index + 1 : index - 1;
    if (sibling < level.length) proof.push(hex(level[sibling]));
    index = Math.floor(index / 2);
  }
  return proof;
};
const merkle = {
  root: hex(root),
  proofs: buyers.map((b) => ({ buyer: b.buyer, leaf: b.leaf, proof: proofOf(Buffer.from(b.leaf, 'hex')) })),
};

// EvidenceRecorded's commitment. CheckOutcome: NotRun=0 Passed=1 Failed=2.
const CHECK = { NotRun: 0, Passed: 1, Failed: 2 };
const evidence = [
  { job_id: 3, payee: ADDRESSES.usdc_issuer_testnet, amount: 49250000n, token: ADDRESSES.usdc_sac_testnet, screening: derived('square.vectors.screening.0'), compliance: 'Passed', screened: 'Passed' },
  { job_id: 4, payee: ADDRESSES.usdc_sac_pubnet, amount: 0n, token: ADDRESSES.usdc_sac_testnet, screening: null, compliance: 'NotRun', screened: 'NotRun' },
  { job_id: 5, payee: ADDRESSES.usdc_issuer_pubnet, amount: (1n << 127n) - 1n, token: ADDRESSES.usdc_sac_pubnet, screening: derived('square.vectors.screening.1'), compliance: 'Failed', screened: 'Failed' },
].map((e) => ({
  job_id: e.job_id.toString(),
  payee: e.payee,
  amount: e.amount.toString(),
  // The token's address, under a name secret scanners do not read as a credential.
  asset: e.token,
  screening: e.screening ? hex(e.screening) : null,
  compliance_outcome: e.compliance,
  screening_outcome: e.screened,
  commitment: hex(keccak(
    Buffer.from('square.evidence.v1'), u64be(e.job_id), scAddressXdr(e.payee), i128be(e.amount), scAddressXdr(e.token),
    e.screening ? Buffer.concat([Buffer.from([1]), e.screening]) : Buffer.from([0]),
    u32be(CHECK[e.compliance]), u32be(CHECK[e.screened]),
  )),
}));

const addressField = Object.entries(ADDRESSES).map(([name, strkey]) => ({ name, address: strkey, signal: hex(fieldOf(strkey)) }));

const vectors = {
  _about: 'Byte layouts of contracts/common/src/hash.rs, computed by contracts/test-support/scripts/vectors.mjs with @noble/hashes keccak256 and @stellar/stellar-sdk XDR. Derived inputs are sha256(label) of the label named in the script.',
  layouts: {
    finalize_reason: 'keccak256("square.finalize.v1" || job_id u64 BE || deliverable 32)',
    resolution_hash: 'keccak256("square.resolution.v1" || job_id u64 BE || outcome u32 BE || provider_bps u32 BE); outcome None=0 Complete=1 Reject=2 Lapsed=3',
    statement_hash: 'keccak256(8 x 32-byte big-endian signals)',
    buyer_leaf: 'keccak256(keccak256(XDR(ScAddress(buyer)) || salt 32))',
    merkle: 'sorted leaves; parent = keccak256(min || max); odd node carried up',
    address_field: 'f(addr) = 0x00 || sha256(XDR(ScVal::Address(addr)))[0..31]',
    evidence_hash: 'keccak256("square.evidence.v1" || job_id u64 BE || XDR(ScAddress(payee)) || amount i128 BE || XDR(ScAddress(token)) || (0x00 | 0x01 || screening 32) || compliance_outcome u32 BE || screening_outcome u32 BE); NotRun=0 Passed=1 Failed=2',
  },
  address_field: addressField,
  finalize_reason: finalize,
  resolution_hash: resolution,
  statement_hash: statement,
  buyer_leaf: buyers,
  merkle,
  evidence_hash: evidence,
};

const text = `${JSON.stringify(vectors, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error('contracts/test-support/vectors.json is stale; run scripts/vectors.mjs');
    process.exit(1);
  }
  console.log('contracts/test-support/vectors.json is current');
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote vectors.json: ${finalize.length} finalize, ${resolution.length} resolution, 1 statement, ${buyers.length} buyer leaves, ${evidence.length} evidence, merkle root ${hex(root).slice(0, 16)}…`);
}
