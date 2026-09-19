pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";

// The range check #20 measured on the two public address signals and did not
// add. Not part of payment.circom, and not a candidate for it.
//
// On Stellar, recipient and token are f(addr): the first 31 bytes of a sha256,
// so every honest value is below 2^248 (docs/decisions/address-field-mapping.md).
// The obvious way to enforce that in the circuit is the one the amounts use,
// Num2Bits(64) there and Num2Bits(248) here. It buys nothing: no constraint in
// payment.circom depends on an address's width, the verifier refuses a signal
// at or above r, and the compliance module compares signals 2 and 4 with an f
// it computes itself. So the block below is compiled on its own, the way the
// timestamp templates are, and circuits/README.md quotes what it would have
// cost. test/constraint-cost.test.js holds that figure to this compile, and the
// figure for payment.circom with the block inserted to it by arithmetic.
template AddressRange() {
    signal input recipient;
    signal input token;

    component recipient_bits = Num2Bits(248);
    recipient_bits.in <== recipient;

    component token_bits = Num2Bits(248);
    token_bits.in <== token;
}

component main = AddressRange();
