// Build witness inputs for payment.circom.
//
// Kept beside the tests rather than in the prover service on purpose: the
// circuit is the source of truth for its own input shape, and the prover
// (square-stellar#21) and the policy package (#22) match it. Anything here that
// they also have to do — f for addresses, category hashing, the policy
// commitment layout — is the part that must agree byte for byte.

import { createHash } from 'node:crypto';
import { buildPoseidon } from 'circomlibjs';
import { Address, StrKey } from '@stellar/stellar-sdk/base';

let poseidon = null;
export async function getPoseidon() {
  if (!poseidon) poseidon = await buildPoseidon();
  return poseidon;
}

// The bytes f hashes: the address as an XDR ScVal, which is what a contract's
// `Address::to_xdr` writes. Not the bare ScAddress, which is the same bytes
// without the 4-byte SCV_ADDRESS tag: #4 named that one, and f would then
// disagree between this side and the compliance module
// (docs/decisions/address-field-mapping.md).
export function addressXdr(strkey) {
  return Address.fromString(strkey).toScVal().toXDR();
}

// f: a Stellar address as one BN254 field element, as a decimal string.
//
//   f(addr) = sha256(XDR(ScVal::Address(addr)))[0..31], read big-endian
//
// A G… account key or a C… contract hash is 32 bytes and does not fit in the
// field, which is ~2^253.6. The first 31 digest bytes are 248 bits, so the value
// is always below r and never reduced. The Solana version split a 32-byte key
// into high and low halves and had ten public signals; the Arc version took a
// 20-byte address as it was. f keeps the eight.
//
// Only G… and C… are addresses a contract stores or pays. A muxed account
// (M…) is refused, as is anything else, so a typo cannot become a field
// element that matches nothing. contracts/probes/address_field_probe/vectors.json
// is the reference, written by contracts/probes/scripts/address-field.mjs and
// checked by a contract; test/address-field.test.js holds this to it.
export function addressToField(strkey) {
  if (!StrKey.isValidEd25519PublicKey(strkey) && !StrKey.isValidContract(strkey)) {
    throw new Error(`not a Stellar account (G…) or contract (C…) address: ${strkey}`);
  }
  const digest = createHash('sha256').update(addressXdr(strkey)).digest();
  return BigInt(`0x${digest.subarray(0, 31).toString('hex')}`).toString();
}

// Categories are short strings and 32 bytes does not fit in one field element,
// so they stay Poseidon images of the two halves — the same shape the policy
// service uses.
export async function hashCategory(category) {
  const utf8 = Buffer.from(category, 'utf8');
  if (utf8.length > 32) throw new Error(`category exceeds 32 bytes: ${category}`);
  const padded = Buffer.alloc(32);
  utf8.copy(padded);
  const high = BigInt(`0x${padded.subarray(0, 16).toString('hex')}`);
  const low = BigInt(`0x${padded.subarray(16, 32).toString('hex')}`);
  const p = await getPoseidon();
  return p.F.toString(p([high, low]));
}

// Zero-pad a list to the circuit's fixed size. There is no parallel mask any
// more: the circuit constrains the three lookup keys non-zero, so a padding
// slot cannot match, and an uncommitted mask array was a way to switch rule 4
// off without changing the policy commitment.
function pad(values, max) {
  if (values.length > max) {
    throw new Error(`list of ${values.length} exceeds the circuit maximum of ${max}`);
  }
  const out = [...values.map(String)];
  while (out.length < max) out.push('0');
  return out;
}

export const MAX_WHITELIST = 10;
export const MAX_BLOCKED = 10;
export const MAX_CATEGORIES = 8;

// 2026-09-02T13:45:30Z, a Wednesday. Mon=0, so day_of_week 2, hour 13.
export const TIMESTAMP = 1788356730;

// USDC's Stellar Asset Contract reports 7 decimals (docs/decisions/stellar-target.md).
export const USDC_DECIMALS = 7;
const usdc = (whole) => String(BigInt(whole) * 10n ** BigInt(USDC_DECIMALS));

// Real addresses, so an f computed here can be read against the chain and
// against the reference vectors. Four are the ones
// contracts/probes/address_field_probe/vectors.json carries, Circle's USDC
// issuers and their Stellar Asset Contracts (stellar-target.md); VECTOR_OF
// names each one's entry, so a test can compare a public signal with the 32
// bytes the reference implementation wrote.
//
//   usdc        the testnet USDC SAC, a C… contract: the token paid and whitelisted
//   otherSac    the pubnet USDC SAC, a C… contract on no whitelist here
//   provider    the testnet USDC issuer, a G… account: the payee
//   blocked     the pubnet USDC issuer, a G… account on the blocked list
//
// The operator's f enters only the commitment, so it needs no vector. It is the
// public key of a keypair drawn with Keypair.random() for these tests, whose
// secret was never written down: a real account nobody can sign for.
export const ADDRESSES = Object.freeze({
  usdc: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  otherSac: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  provider: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  blocked: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  operator: 'GBY4CRW3JPJYVS2HG4TNQS2PWEAYIHU7CGKZVOFNWJNCBIWX7D22C3ZC',
});

// Which reference vector each of the four is.
export const VECTOR_OF = Object.freeze({
  usdc: 'usdc_sac_testnet',
  otherSac: 'usdc_sac_pubnet',
  provider: 'usdc_issuer_testnet',
  blocked: 'usdc_issuer_pubnet',
});

// A policy that the default payment satisfies. Override pieces per test.
// Eight fixed salts. Real policies use commitment.js's randomPolicySalt; these
// are constants so a rebuilt input produces the same commitment and a failing
// test is reproducible. They are not secret and are not meant to be.
export const DEFAULT_SALTS = Object.freeze([
  '1000000000000000000000000000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000000000000000000000000000002',
  '1000000000000000000000000000000000000000000000000000000000000003',
  '1000000000000000000000000000000000000000000000000000000000000004',
  '1000000000000000000000000000000000000000000000000000000000000005',
  '1000000000000000000000000000000000000000000000000000000000000006',
  '1000000000000000000000000000000000000000000000000000000000000007',
  '1000000000000000000000000000000000000000000000000000000000000008',
]);

export async function buildInput(overrides = {}) {
  const {
    maxPerTx = usdc(10),              // 10 USDC, 100 000 000 base units
    maxDaily = usdc(100),             // 100 USDC
    tokenWhitelist = [ADDRESSES.usdc],
    blockedAddresses = [ADDRESSES.blocked],
    allowedCategories = ['api-call'],
    paymentCategory = 'api-call',
    operator = ADDRESSES.operator,
    policyIdField = '424242',
    policySalts = DEFAULT_SALTS,
    timeActive = '0',
    timeDaysBitmask = '0',
    timeStartHourUtc = '0',
    timeEndHourUtc = '0',
    recipient = ADDRESSES.provider,
    amount = usdc(5),                 // 5 USDC
    token = ADDRESSES.usdc,
    dailySpentBefore = usdc(50),      // 50 USDC
    timestamp = TIMESTAMP,
    stripeReceiptHash = '0',
  } = overrides;

  const tokens = pad(tokenWhitelist.map(addressToField), MAX_WHITELIST);
  const blocked = pad(blockedAddresses.map(addressToField), MAX_BLOCKED);
  const categories = pad(
    await Promise.all(allowedCategories.map(hashCategory)),
    MAX_CATEGORIES,
  );

  return {
    max_per_tx: String(maxPerTx),
    max_daily: String(maxDaily),
    token_whitelist: tokens,
    blocked_addresses: blocked,
    allowed_categories: categories,
    payment_category: await hashCategory(paymentCategory),
    operator_id_field: addressToField(operator),
    policy_id_field: String(policyIdField),
    // Fixed rather than random, so a rebuilt input produces the same
    // commitment and a failing test is reproducible. A real policy uses
    // commitment.js's randomPolicySalt.
    policy_salts: policySalts,
    time_active: String(timeActive),
    time_days_bitmask: String(timeDaysBitmask),
    time_start_hour_utc: String(timeStartHourUtc),
    time_end_hour_utc: String(timeEndHourUtc),
    recipient_in: addressToField(recipient),
    amount_in: String(amount),
    token_in: addressToField(token),
    daily_spent_before_in: String(dailySpentBefore),
    current_unix_timestamp_in: String(timestamp),
    stripe_receipt_hash_in: String(stripeReceiptHash),
  };
}

// The public signals, in the order payment.circom declares them. The verifier
// reads them positionally, so this order is part of the contract between the
// circuit, the prover service and the on-chain verifier.
export const PUBLIC_SIGNALS = [
  'is_compliant',
  'policy_data_hash',
  'recipient',
  'amount',
  'token',
  'daily_spent_before',
  'current_unix_timestamp',
  'stripe_receipt_hash',
];

// Recompute the policy commitment outside the circuit. #18 ports this into the
// prover service and #45 into the policy service; if either drifts from this,
// every proof it produces is bound to the wrong policy.
export async function policyDataHash(input) {
  const p = await getPoseidon();
  const f = (x) => p.F.toString(x);
  const catHash = p(input.allowed_categories.map(BigInt));
  const blockedHash = p(input.blocked_addresses.map(BigInt));
  const tokensHash = p(input.token_whitelist.map(BigInt));

  const timeField = BigInt(input.time_active) === 0n
    ? '0'
    : f(p([
      BigInt(input.time_active),
      BigInt(input.time_days_bitmask),
      BigInt(input.time_start_hour_utc),
      BigInt(input.time_end_hour_utc),
    ]));

  // square#45: eight salted, position-separated leaves, and the root is the
  // commitment. This is a third independent implementation of the construction
  // — the circuit is the first and services/prover/src/commitment.js the second
  // — and the point of writing it out longhand here rather than importing one
  // of the others is that a test which shares an implementation with the thing
  // it is testing proves only that the code equals itself.
  const values = [
    BigInt(input.max_daily),
    BigInt(input.max_per_tx),
    BigInt(input.operator_id_field),
    BigInt(input.policy_id_field),
    BigInt(f(catHash)),
    BigInt(f(blockedHash)),
    BigInt(f(tokensHash)),
    BigInt(timeField),
  ];
  const leaves = values.map((value, i) => BigInt(f(p([
    BigInt(i), BigInt(input.policy_salts[i]), value,
  ]))));
  return f(p(leaves));
}
