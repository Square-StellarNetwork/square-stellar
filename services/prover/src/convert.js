// Shape a snarkjs proof into the arguments an on-chain Groth16 verifier takes:
// the Soroban blob (`encodeForSoroban`, the Stellar verifier's and the kernel's
// format) and, while the Solidity contracts remain, their calldata
// (`encodeForSolidity`).
//
// The Solidity shape replaced the groth16-solana encoding the Solana service
// used. That one negated pi_a's Y coordinate and reordered pi_b's Fp2 limbs,
// because the Rust verifier expected arkworks byte layout. The Solidity
// verifier snarkjs generates does neither: it negates internally, and it reads
// pi_b in the order snarkjs already emits.
//
// Getting this wrong does not produce a wrong answer — it produces a proof that
// simply fails to verify, which is a confusing way to lose an afternoon. The
// layout below is the one `snarkjs zkey export soliditycalldata` produces, and
// solidity-encoding.test.js checks this function against that command's output
// rather than against a description of it.

const BN254_P = BigInt(
  '21888242871839275222246405745257275088696311157297823662689037894645226208583',
);

function toHex32(value) {
  const n = BigInt(value);
  if (n < 0n || n >= BN254_P) {
    throw new Error('field element out of range');
  }
  return `0x${n.toString(16).padStart(64, '0')}`;
}

// snarkjs emits pi_a as [x, y, 1]. The Solidity verifier takes [x, y] and does
// its own negation, so the Y coordinate is passed through untouched.
function encodeA(pi_a) {
  return [toHex32(pi_a[0]), toHex32(pi_a[1])];
}

// pi_b is a G2 point over Fp2: [[x0, x1], [y0, y1], [1, 0]]. Solidity's pairing
// precompile takes each Fp2 coefficient pair in reverse order, which is the
// order snarkjs already writes into its own calldata export — so the swap here
// is the one the verifier expects, not an extra one.
function encodeB(pi_b) {
  return [
    [toHex32(pi_b[0][1]), toHex32(pi_b[0][0])],
    [toHex32(pi_b[1][1]), toHex32(pi_b[1][0])],
  ];
}

function encodeC(pi_c) {
  return [toHex32(pi_c[0]), toHex32(pi_c[1])];
}

// The four arguments `verifyProof(uint[2] a, uint[2][2] b, uint[2] c, uint[N] input)`
// takes, as 32-byte hex strings. Callers pass them straight to a contract call.
export function encodeForSolidity(proof, publicSignals) {
  return {
    a: encodeA(proof.pi_a),
    b: encodeB(proof.pi_b),
    c: encodeC(proof.pi_c),
    input: publicSignals.map(toHex32),
  };
}

// ---------------------------------------------------------------- Soroban
//
// The byte layout Soroban's BN254 host functions take (CAP-0074, "Field and
// groups"), as docs/decisions/groth16-on-soroban.md (#2) settled it and
// contracts/probes/groth16_probe verified on testnet:
//
//   fp   32 bytes, big-endian, < p
//   G1   be(X) || be(Y)                                  64 bytes
//   fp2  be(c1) || be(c0)                                imaginary part first
//   G2   be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0)    128 bytes
//
// The proof the kernel stores and the verifier reads is one blob:
//   A(64) || B(128) || C(64) || 8 x signal(32, big-endian)   512 bytes
//
// snarkjs writes every fp2 as [c0, c1], so each G2 coordinate pair is swapped
// here; A is passed as the prover made it and the verifier negates it; signals
// are carried unreduced, so a signal >= r is the verifier's to refuse, as it
// refuses `s + r` (the `compliant_with_signal_plus_r` vector). Getting the G2
// order wrong is not a wrong answer but a host error, `Error(Crypto,
// InvalidInput)` (the `compliant_with_b_in_snarkjs_order` vector), which is
// why test/soroban-encoding.test.js holds this to the probe's vectors rather
// than to a description.

// snarkjs keeps a projective z; an affine point has z = 1 (G1) or [1, 0] (G2).
function assertAffine(point, one) {
  if (point.length === 3 && JSON.stringify(point[2]) !== JSON.stringify(one)) {
    throw new Error('proof point is not affine');
  }
}

const word = (value) => toHex32(value).slice(2);

// A 32-byte word that is carried as it is: a public signal.
function unreducedWord(value) {
  const n = BigInt(value);
  if (n < 0n || n >= 2n ** 256n) throw new Error('public signal does not fit 32 bytes');
  return n.toString(16).padStart(64, '0');
}

function g1(point) {
  assertAffine(point, '1');
  return word(point[0]) + word(point[1]);
}

function g2(point) {
  assertAffine(point, ['1', '0']);
  const [[x0, x1], [y0, y1]] = point;
  return word(x1) + word(x0) + word(y1) + word(y0);
}

/**
 * The proof as `groth16_verifier.verify_proof` and `square_job.set_compliance_proof`
 * take it (#10, #12): the three points and the eight signals, each as
 * `0x`-prefixed hex, and `proof`, the 512-byte blob they concatenate to.
 */
export function encodeForSoroban(proof, publicSignals) {
  const a = g1(proof.pi_a);
  const b = g2(proof.pi_b);
  const c = g1(proof.pi_c);
  const input = publicSignals.map(unreducedWord);
  return {
    a: `0x${a}`,
    b: `0x${b}`,
    c: `0x${c}`,
    input: input.map((signal) => `0x${signal}`),
    proof: `0x${a}${b}${c}${input.join('')}`,
  };
}

/**
 * A snarkjs verification key in the same layout, and the blob the probe
 * contract takes as `vk`: alpha(64) || beta(128) || gamma(128) || delta(128)
 * || IC_0..IC_n(64). `groth16_verifier` embeds these as constants (#10 reads
 * them from here or from the key directly); contracts/script/verify-on-stellar.mjs
 * hands the blob to the probe.
 */
export function encodeVerifyingKey(vk) {
  if (vk.protocol !== 'groth16' || vk.curve !== 'bn128') {
    throw new Error('verification key is not groth16 over bn128');
  }
  const alpha = g1(vk.vk_alpha_1);
  const beta = g2(vk.vk_beta_2);
  const gamma = g2(vk.vk_gamma_2);
  const delta = g2(vk.vk_delta_2);
  const ic = vk.IC.map(g1);
  return {
    alpha: `0x${alpha}`,
    beta: `0x${beta}`,
    gamma: `0x${gamma}`,
    delta: `0x${delta}`,
    ic: ic.map((point) => `0x${point}`),
    blob: `0x${alpha}${beta}${gamma}${delta}${ic.join('')}`,
  };
}
