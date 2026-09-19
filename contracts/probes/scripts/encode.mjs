// Groth16 over BN254: snarkjs and Solidity-calldata shapes -> the byte layout
// Soroban's BN254 host functions take (CAP-0074, "Field and groups").
//
//   fp  : 32 bytes, big-endian, < p
//   G1  : be(X) || be(Y)                                   64 bytes, infinity = (0,0)
//   fp2 : be(c1) || be(c0)                                 imaginary part first
//   G2  : be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0)     128 bytes
//
// snarkjs writes every fp2 as [c0, c1], so G2 coordinates are swapped here. The
// Solidity verifier's calldata (services/prover/src/convert.js encodeB) already
// carries them as [c1, c0], the EIP-197 order, so those are copied as they are.
//
// The proof blob is A(64) || B(128) || C(64) || n x signal(32, big-endian).
// A is passed as the prover made it; the verifier negates it.

export const BN254_P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function be32(value, { bound } = {}) {
  const n = BigInt(value);
  if (n < 0n || n >= 2n ** 256n) throw new Error(`does not fit 32 bytes: ${value}`);
  if (bound !== undefined && n >= bound) throw new Error(`not below the modulus: ${value}`);
  return n.toString(16).padStart(64, '0');
}

const fp = (v) => be32(v, { bound: BN254_P });

// snarkjs keeps a projective z; an affine point has z = 1 (G1) or [1, 0] (G2).
function affine(point, one) {
  if (point.length === 3 && JSON.stringify(point[2]) !== JSON.stringify(one)) {
    throw new Error(`not affine: z = ${JSON.stringify(point[2])}`);
  }
}

// snarkjs: [x, y, "1"]
export function g1FromSnarkjs(point) {
  affine(point, '1');
  return fp(point[0]) + fp(point[1]);
}

// snarkjs: [[x.c0, x.c1], [y.c0, y.c1], ["1", "0"]]
export function g2FromSnarkjs(point) {
  affine(point, ['1', '0']);
  const [[x0, x1], [y0, y1]] = point;
  return fp(x1) + fp(x0) + fp(y1) + fp(y0);
}

// Solidity calldata: [[x.c1, x.c0], [y.c1, y.c0]]
export function g2FromSolidity([[x1, x0], [y1, y0]]) {
  return fp(x1) + fp(x0) + fp(y1) + fp(y0);
}

export function g1FromSolidity([x, y]) {
  return fp(x) + fp(y);
}

// Signals are not reduced: a signal >= r is carried as it is, so the verifier
// is the one that refuses it.
export function signals(values) {
  return values.map((v) => be32(v)).join('');
}

export function proofFromSnarkjs(proof, publicSignals) {
  return g1FromSnarkjs(proof.pi_a) + g2FromSnarkjs(proof.pi_b) + g1FromSnarkjs(proof.pi_c) + signals(publicSignals);
}

export function proofFromSolidity({ a, b, c, input }) {
  return g1FromSolidity(a) + g2FromSolidity(b) + g1FromSolidity(c) + signals(input);
}

export function vkFromSnarkjs(vk) {
  if (vk.protocol !== 'groth16' || vk.curve !== 'bn128') throw new Error(`not a groth16/bn128 key: ${vk.protocol}/${vk.curve}`);
  return {
    alpha: g1FromSnarkjs(vk.vk_alpha_1),
    beta: g2FromSnarkjs(vk.vk_beta_2),
    gamma: g2FromSnarkjs(vk.vk_gamma_2),
    delta: g2FromSnarkjs(vk.vk_delta_2),
    ic: vk.IC.map(g1FromSnarkjs),
  };
}

// The constants of contracts/src/Groth16Verifier.sol, in the same layout.
export function vkFromSolidity(source) {
  const c = {};
  for (const m of source.matchAll(/uint256 private constant ([A-Z0-9_]+) =\s*(\d+);/g)) c[m[1]] = m[2];
  const need = (k) => { if (c[k] === undefined) throw new Error(`missing constant ${k}`); return c[k]; };
  const g2 = (n) => g2FromSolidity([[need(`${n}_X_IM`), need(`${n}_X_RE`)], [need(`${n}_Y_IM`), need(`${n}_Y_RE`)]]);
  const count = Number(need('PUBLIC_INPUTS'));
  return {
    alpha: g1FromSolidity([need('ALPHA_X'), need('ALPHA_Y')]),
    beta: g2('BETA'),
    gamma: g2('GAMMA'),
    delta: g2('DELTA'),
    ic: Array.from({ length: count + 1 }, (_, i) => g1FromSolidity([need(`IC${i}_X`), need(`IC${i}_Y`)])),
  };
}

// The blob the probe contract's `verify` takes as its `vk` argument:
// alpha(64) || beta(128) || gamma(128) || delta(128) || n+1 x IC(64).
export function vkBlob(vk) {
  return vk.alpha + vk.beta + vk.gamma + vk.delta + vk.ic.join('');
}
