/**
 * What the EVM buyer list (`./buyers.ts`) and the Stellar one
 * (`./stellar/buyers.ts`) share, kept free of either chain's library.
 */

export class BuyerListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuyerListError";
  }
}

/**
 * The same floor the prover holds `policy_salt` to (square#178). A leaf hides
 * its buyer only as far as its salt cannot be guessed, and the buyer's address
 * is the half of the preimage anyone can guess.
 */
export const BUYER_SALT_FLOOR = 1n << 128n;
