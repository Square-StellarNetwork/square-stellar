// The circuit's size, as the repository quotes it, against what circom compiled.
//
// square#238. circuits/README.md's constraint table was two circuit changes
// old: it said 2609 non-linear and "smaller than what it replaced" while the
// compiler said 4849, and the ptau record, fetch-ptau.mjs and a test comment
// each quoted a third figure. Nothing compared any of them with a build. The
// arithmetic of the table is checked here without one; the figures themselves
// are checked against build/*.r1cs whenever the circuits are compiled, which the
// circuits job does before its tests.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD, isCompiled, r1csConstraintCounts } from './helpers/signals.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPO = path.resolve(ROOT, '..');
const read = (...parts) => fs.readFileSync(path.join(REPO, ...parts), 'utf8');

const HAVE_BUILD = ['payment', 'timestamp_checked', 'timestamp_unchecked'].every((circuit) => isCompiled(circuit));

const README = read('circuits', 'README.md');
const SECTION = README.slice(README.indexOf('## Constraint cost, measured'), README.indexOf('## Building and testing'));

// "**+1986**", "−28", "11584" as numbers; the table uses a real minus sign.
const figure = (cell) => Number(cell.replace(/[*,\s]/g, '').replace('−', '-').replace(/^\+/, ''));

function row(label) {
  const line = SECTION.split('\n').find((l) => l.startsWith(`| ${label} |`));
  if (!line) throw new Error(`no row "${label}" in circuits/README.md's constraint table`);
  return line.split('|').slice(2, -1).map((cell) => figure(cell));
}

// A number the prose quotes, by the words around it.
function quoted(text, pattern, where) {
  const match = pattern.exec(text);
  if (!match) throw new Error(`${where}: nothing matches ${pattern}`);
  return Number(match[1].replaceAll(',', ''));
}

const APERTURE = row("Aperture's original `payment.circom`");
const THIS = row('This `payment.circom`');
const CHANGE = row('Change');
const ATTRIBUTION = ['Rule 6 constrained properly', '`Num2Bits(64)` on the two amounts']
  .concat(SECTION.split('\n').filter((l) => /^\| .*(#119|#45|lookup keys|Mask arrays|Addresses collapsed)/.test(l)).map((l) => l.split('|')[1].trim()));
const NET = row('net')[0];

describe("circuits/README.md's constraint table adds up", () => {
  it("has a change row that is this circuit minus Aperture's, column by column", () => {
    expect(CHANGE).toEqual(THIS.map((value, i) => value - APERTURE[i]));
  });

  it('has an attribution that sums to its net, and a net that is the change in non-linear constraints', () => {
    const sum = ATTRIBUTION.reduce((total, label) => total + row(label)[0], 0);
    expect(ATTRIBUTION).toHaveLength(7);
    expect(sum).toBe(NET);
    expect(NET).toBe(CHANGE[0]);
  });

  it("measures #45's and #119's rows by the variants it names", () => {
    const without45 = quoted(SECTION, /without #45's leaves it is (\d+) non-linear/, 'README');
    const without119 = quoted(SECTION, /without #119's ceiling bounds (\d+)/, 'README');
    const withoutBoth = quoted(SECTION, /without both (\d+)/, 'README');
    const leaves = row('Salted leaves, eight `Poseidon(3)` under the root ([#45](https://github.com/Square-StellarNetwork/square/issues/45))')[0];
    const ceilings = row('`Num2Bits(64)` on the two ceilings ([#119](https://github.com/Square-StellarNetwork/square/issues/119))')[0];
    expect(THIS[0] - without45).toBe(leaves);
    expect(THIS[0] - without119).toBe(ceilings);
    expect(without45 - withoutBoth).toBe(ceilings);
  });
});

describe.skipIf(!HAVE_BUILD)('what the compiler says', () => {
  const payment = HAVE_BUILD ? r1csConstraintCounts(path.join(BUILD, 'payment.r1cs')) : null;

  it("is the table's row for this circuit", () => {
    expect(THIS).toEqual([payment.nonLinear, payment.linear, payment.wires]);
  });

  it('is the soundness figure, the two timestamp templates compiled standalone', () => {
    const checked = r1csConstraintCounts(path.join(BUILD, 'timestamp_checked.r1cs'));
    const unchecked = r1csConstraintCounts(path.join(BUILD, 'timestamp_unchecked.r1cs'));
    expect(quoted(SECTION, /`timestamp_checked` is (\d+) non-linear/, 'README')).toBe(checked.nonLinear);
    expect(quoted(SECTION, /against `timestamp_unchecked`'s (\d+)/, 'README')).toBe(unchecked.nonLinear);
    expect(checked.nonLinear - unchecked.nonLinear).toBe(row('Rule 6 constrained properly')[0]);
  });

  // Every other place that states this circuit's size today.
  it.each([
    ['docs/ceremony/phase1-ptau.md', ['docs', 'ceremony', 'phase1-ptau.md'], /compiles to ([\d,]+) constraints/, 'constraints'],
    ['docs/ceremony/phase1-ptau.md, the refusal', ['docs', 'ceremony', 'phase1-ptau.md'], /(\d+)\*2 > 2\*\*13/, 'constraints'],
    ['docs/ceremony/phase1-ptau.md, the total', ['docs', 'ceremony', 'phase1-ptau.md'], /\*\*total\*\*, which went from [\d,]+ to ([\d,]+)/, 'constraints'],
    ['docs/ceremony/phase1-ptau.md, the non-linear count', ['docs', 'ceremony', 'phase1-ptau.md'], /took those from\s+[\d,]+ to ([\d,]+)/, 'nonLinear'],
    ['circuits/scripts/fetch-ptau.mjs', ['circuits', 'scripts', 'fetch-ptau.mjs'], /not the non-linear count: ([\d,]+)/, 'constraints'],
    ['circuits/scripts/fetch-ptau.mjs, the refusal', ['circuits', 'scripts', 'fetch-ptau.mjs'], /(\d+)\*2 > 2\*\*13/, 'constraints'],
    ['circuits/test/ptau-adoption.test.js, the non-linear count', ['circuits', 'test', 'ptau-adoption.test.js'], /constraints from [\d,]+ to ([\d,]+)/, 'nonLinear'],
    ['circuits/test/ptau-adoption.test.js, the total', ['circuits', 'test', 'ptau-adoption.test.js'], /total went from [\d,]+ to ([\d,]+)/, 'constraints'],
    ['circuits/test/helpers/signals.mjs', ['circuits', 'test', 'helpers', 'signals.mjs'], /nine wires — ([\d,]+) of them/, 'wires'],
    ['circuits/test/payment.test.js', ['circuits', 'test', 'payment.test.js'], /it has ([\d,]+)/, 'wires'],
    ['docs/deploy/end-to-end-5042002.md, the proof', ['docs', 'deploy', 'end-to-end-5042002.md'], /over ([\d,]+) witness variables/, 'wires'],
    ['docs/deploy/end-to-end-5042002.md, the growth', ['docs', 'deploy', 'end-to-end-5042002.md'], /witness variables to ([\d,]+)/, 'wires'],
  ])('is what %s quotes', (where, parts, pattern, measure) => {
    expect(quoted(read(...parts), pattern, where)).toBe(payment[measure]);
  });
});

describe.skipIf(HAVE_BUILD)('what the compiler says', () => {
  it('skipped: run `npm run build -- --no-zkey` first', () => {
    expect(HAVE_BUILD).toBe(false);
  });
});

// square-stellar#20. The Stellar port changed what the address inputs mean,
// f of a 32-byte address instead of a 20-byte one, and changed no constraint.
// The README says so with numbers: the circuit re-measured, the r1cs hash, and
// what the one candidate constraint, a Num2Bits(248) range check on the
// addresses, would have cost. These hold those numbers to the compiler where a
// compile exists, and to each other where the variant was measured once.
const STELLAR = SECTION.slice(SECTION.indexOf('### The Stellar port, measured again'));
const stellarRow = (label) => {
  const line = STELLAR.split('\n').find((l) => l.startsWith(`| ${label} |`));
  if (!line) throw new Error(`no row "${label}" in the Stellar port's table`);
  return line.split('|').slice(2, -1).map((cell) => figure(cell));
};
const BLOCK = stellarRow('`Num2Bits(248)` on `recipient` and `token`, the block alone');
const WITH_BLOCK = stellarRow('This `payment.circom` with that block');
const ALL_23 = stellarRow('This `payment.circom` with `Num2Bits(248)` on all 23 address inputs');
const PER_CHECK = BLOCK.map((value) => value / 2);

describe("circuits/README.md's Stellar port adds up", () => {
  it('re-measures this circuit as the table above has it, a change of zero', () => {
    const quotedNow = /\*\*(\d+)\*\* non-linear, \*\*(\d+)\*\* linear, \*\*(\d+)\*\*\s+wires, a change of \*\*0\*\*/.exec(STELLAR);
    expect(quotedNow, 'the re-measured figures are not quoted').not.toBeNull();
    expect(quotedNow.slice(1, 4).map(Number)).toEqual(THIS);
  });

  it('prices one Num2Bits(248) at 248 non-linear constraints, one linear, 248 bits', () => {
    // The block alone is its own circuit: a constant wire and two input wires
    // besides the 496 bits, which payment.circom already has as recipient and token.
    expect(PER_CHECK[0]).toBe(248);
    expect(PER_CHECK[1]).toBe(1);
    expect(BLOCK[2] - 1 - 2).toBe(2 * 248);
  });

  it('puts the block into this circuit at exactly its own cost', () => {
    expect(WITH_BLOCK[0] - THIS[0]).toBe(BLOCK[0]);
    expect(WITH_BLOCK[1] - THIS[1]).toBe(BLOCK[1]);
    expect(WITH_BLOCK[2] - THIS[2]).toBe(BLOCK[2] - 1 - 2);
    expect(quoted(STELLAR, /the\s+two signals add (\d+)/, 'README')).toBe(WITH_BLOCK[0] - THIS[0]);
  });

  it('prices the check on all 23 address inputs at 23 times one', () => {
    // recipient, token, ten whitelist entries, ten blocked entries, operator_id_field.
    const inputs = 1 + 1 + 10 + 10 + 1;
    expect(inputs).toBe(23);
    expect(ALL_23[0] - THIS[0]).toBe(inputs * PER_CHECK[0]);
    expect(ALL_23[1] - THIS[1]).toBe(inputs * PER_CHECK[1]);
    expect(ALL_23[2] - THIS[2]).toBe(inputs * 248);
    expect(quoted(STELLAR, /the 23 inputs, .*?, add (\d+)/s, 'README')).toBe(ALL_23[0] - THIS[0]);
  });

  // payment.circom quotes the same two costs in its own note, so it is held too.
  it('is what payment.circom quotes', () => {
    const circuit = read('circuits', 'payment.circom');
    expect(quoted(circuit, /would cost (\d+) non-linear constraints on the\s*\/\/\s*two public address signals/, 'payment.circom')).toBe(BLOCK[0]);
    expect(quoted(circuit, /and (\d+) on all 23 address inputs/, 'payment.circom')).toBe(ALL_23[0] - THIS[0]);
  });
});

const HAVE_ADDRESS_RANGE = isCompiled('address_range') && isCompiled('payment');

describe.skipIf(!HAVE_ADDRESS_RANGE)("what the compiler says about the Stellar port", () => {
  it('is the block alone, test/circuits/address_range.circom compiled standalone', () => {
    const block = r1csConstraintCounts(path.join(BUILD, 'address_range.r1cs'));
    expect(BLOCK).toEqual([block.nonLinear, block.linear, block.wires]);
  });

  it('is the r1cs hash the README quotes, so the comment-only edit is a byte-identical circuit', () => {
    const sha = createHash('sha256').update(fs.readFileSync(path.join(BUILD, 'payment.r1cs'))).digest('hex');
    const quotedSha = /sha256\s+`([0-9a-f]{64})`/.exec(STELLAR);
    expect(quotedSha, 'the README quotes no r1cs sha256').not.toBeNull();
    expect(quotedSha[1]).toBe(sha);
  });

  // The ceremony runs over this r1cs, and three pages tell its coordinator and
  // its verifiers which one that is. A hash that went stale there would send a
  // ceremony, or a check of one, to a different circuit.
  it.each([
    ['docs/ceremony/README.md', ['docs', 'ceremony', 'README.md'], /hashes to\s+`([0-9a-f]{64})`/],
    ['docs/disclosure/zk-setup-status.md', ['docs', 'disclosure', 'zk-setup-status.md'], /sha256\s+`([0-9a-f]{64})`/],
  ])('is the r1cs hash %s quotes', (where, parts, pattern) => {
    const sha = createHash('sha256').update(fs.readFileSync(path.join(BUILD, 'payment.r1cs'))).digest('hex');
    const match = pattern.exec(read(...parts));
    expect(match, `${where} quotes no r1cs sha256`).not.toBeNull();
    expect(match[1]).toBe(sha);
  });

  it('is the r1cs hash docs/ceremony/running.md abbreviates', () => {
    const sha = createHash('sha256').update(fs.readFileSync(path.join(BUILD, 'payment.r1cs'))).digest('hex');
    const match = /the Stellar version: ([0-9a-f]{16})…([0-9a-f]{8})/.exec(read('docs', 'ceremony', 'running.md'));
    expect(match, 'docs/ceremony/running.md quotes no r1cs sha256').not.toBeNull();
    expect(sha.startsWith(match[1]) && sha.endsWith(match[2])).toBe(true);
  });
});

describe.skipIf(HAVE_ADDRESS_RANGE)("what the compiler says about the Stellar port", () => {
  it('skipped: run `npm run build -- --no-zkey` first', () => {
    expect(HAVE_ADDRESS_RANGE).toBe(false);
  });
});
