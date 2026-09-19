#!/usr/bin/env node
// f: a Stellar address (G… account or C… contract) -> one BN254 field element,
// as decided in docs/decisions/address-field-mapping.md (#4).
//
//   f(addr) = sha256(XDR(ScVal::Address(addr)))[0..31]   read as a big-endian integer
//
// 31 bytes are 248 bits, so the result is always below r (~2^253.6) and never
// needs reducing. As a 32-byte signal it is 0x00 || the first 31 digest bytes.
// The bytes hashed are the ScVal encoding because that is what a contract gets
// from `Address::to_xdr(&env)`; the probe in address_field_probe checks both
// sides produce the same bytes.
//
//   node scripts/address-field.mjs          write address_field_probe/vectors.json
//   node scripts/address-field.mjs --check  exit 1 if the file is stale

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address } from '@stellar/stellar-sdk';

export const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function addressXdr(strkey) {
  return Address.fromString(strkey).toScVal().toXDR();
}

// The 32-byte big-endian signal, as hex.
export function fieldOfAddress(strkey) {
  const digest = createHash('sha256').update(addressXdr(strkey)).digest();
  return `00${digest.subarray(0, 31).toString('hex')}`;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'address_field_probe', 'vectors.json');

// Real addresses, so the vectors can be checked against the chain:
// the USDC issuers (Circle) and their Stellar Asset Contracts (stellar-target.md).
const ADDRESSES = [
  { name: 'usdc_issuer_testnet', address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
  { name: 'usdc_sac_testnet', address: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' },
  { name: 'usdc_issuer_pubnet', address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
  { name: 'usdc_sac_pubnet', address: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75' },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const vectors = {
    _about: 'f(addr) = sha256(XDR(ScVal::Address(addr)))[0..31] as a big-endian integer; signal = 0x00 || those 31 bytes. Written by contracts/probes/scripts/address-field.mjs; decided in docs/decisions/address-field-mapping.md.',
    vectors: ADDRESSES.map(({ name, address }) => {
      const signal = fieldOfAddress(address);
      if (BigInt(`0x${signal}`) >= R) throw new Error(`${name} is not below r`);
      return { name, address, scval_xdr: addressXdr(address).toString('hex'), signal, decimal: BigInt(`0x${signal}`).toString() };
    }),
  };
  const text = `${JSON.stringify(vectors, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== text) {
      console.error('address_field_probe/vectors.json is stale; run scripts/address-field.mjs');
      process.exit(1);
    }
    console.log('address_field_probe/vectors.json is current');
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    for (const v of vectors.vectors) console.log(`${v.name.padEnd(20)} ${v.address} -> ${v.signal}`);
  }
}
