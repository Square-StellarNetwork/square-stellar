import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { canonicalJson } from "./canonicalJson.js";

export { canonicalJson } from "./canonicalJson.js";

/**
 * A signed action: who acts, on what, once, within a window, on one network.
 * The Stellar counterpart of the EIP-712 `SquareAction` (#25): the same
 * fields, with the actor a `G…` account and the network its CAIP-2 id
 * (`stellar:testnet`, `stellar:pubnet`) or `stellar:local`, signed per
 * SEP-53 over the canonical JSON `actionMessage` builds.
 */
export interface SquareAction {
  actor: string;
  action: string;
  resource: string;
  nonce: bigint;
  issuedAt: bigint;
  expiresAt: bigint;
  network: string;
}

export const SQUARE_ACTION_DOMAIN = { name: "Square", version: "1" } as const;
export const SQUARE_ACTION_PRIMARY_TYPE = "SquareAction";

/**
 * The text a signer signs and a wallet shows: RFC 8785-style canonical JSON
 * of the domain (name, version and the network the signature is for), the
 * type name and the message, with the integers as decimal strings. One
 * message has one text, so the verifier rebuilds it from the fields it was
 * handed and the signature either covers exactly those fields or nothing.
 */
export function actionMessage(message: SquareAction): string {
  return canonicalJson({
    domain: { ...SQUARE_ACTION_DOMAIN, network: message.network },
    primaryType: SQUARE_ACTION_PRIMARY_TYPE,
    message: {
      actor: message.actor,
      action: message.action,
      resource: message.resource,
      nonce: message.nonce.toString(),
      issuedAt: message.issuedAt.toString(),
      expiresAt: message.expiresAt.toString(),
    },
  });
}

/**
 * A SEP-43 wallet's `signMessage`, with the address it signs as: what
 * Stellar Wallets Kit and Freighter expose. `signedMessage` is the 64-byte
 * ed25519 signature, base64 (or hex) encoded.
 */
export interface MessageSigner {
  address: string;
  signMessage(message: string, opts?: { networkPassphrase?: string; address?: string }): Promise<{ signedMessage: string; signerAddress?: string }>;
}

export type ActionSigner = Keypair | MessageSigner;

export class ActorMismatchError extends Error {
  constructor(
    readonly signer: string,
    readonly actor: string,
  ) {
    super(`the signer is ${signer} but the message names ${actor} as its actor`);
    this.name = "ActorMismatchError";
  }
}

/**
 * Sign an action per SEP-53: the message text, prefixed with
 * `"Stellar Signed Message:\n"`, hashed with SHA-256, signed with the
 * actor's ed25519 key. Answers the signature base64 encoded. Refuses to sign
 * for an actor other than the signer's own address, which is the one
 * mistake a caller cannot detect from the signature alone.
 */
export async function signAction(signer: ActionSigner, message: SquareAction): Promise<string> {
  if (signer instanceof Keypair) {
    if (signer.publicKey() !== message.actor) throw new ActorMismatchError(signer.publicKey(), message.actor);
    return signer.signMessage(actionMessage(message)).toString("base64");
  }
  if (signer.address !== message.actor) throw new ActorMismatchError(signer.address, message.actor);
  const { signedMessage, signerAddress } = await signer.signMessage(actionMessage(message), { address: message.actor });
  if (signerAddress !== undefined && signerAddress !== message.actor) throw new ActorMismatchError(signerAddress, message.actor);
  const signature = decodeSignature(signedMessage);
  if (signature === undefined) throw new Error("the wallet answered with something other than a 64-byte signature");
  return signature.toString("base64");
}

/** A 64-byte signature from its base64 or hex text; undefined for anything else. */
export function decodeSignature(text: string): Buffer | undefined {
  if (/^[0-9a-fA-F]{128}$/.test(text)) return Buffer.from(text, "hex");
  if (/^[A-Za-z0-9+/]{86}==$/.test(text)) {
    const bytes = Buffer.from(text, "base64");
    if (bytes.length === 64) return bytes;
  }
  return undefined;
}

export interface NonceStore {
  consume(actor: string, nonce: bigint, expiresAt: bigint): Promise<boolean>;
}

export function currentUnixSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export interface MemoryNonceStore extends NonceStore {
  prune(): number;
  size(): number;
}

export interface MemoryNonceStoreOptions {
  now?: (() => bigint) | undefined;
  pruneIntervalSeconds?: bigint | number | undefined;
}

export const MEMORY_NONCE_PRUNE_INTERVAL_SECONDS = 60n;

export function memoryNonceStore(options: MemoryNonceStoreOptions = {}): MemoryNonceStore {
  const now = options.now ?? currentUnixSeconds;
  const requestedInterval = BigInt(options.pruneIntervalSeconds ?? MEMORY_NONCE_PRUNE_INTERVAL_SECONDS);
  const pruneIntervalSeconds = requestedInterval < 0n ? 0n : requestedInterval;
  const used = new Map<string, Map<bigint, bigint>>();
  let lastPrunedAt = now();
  const pruneAt = (current: bigint): number => {
    let droppedActors = 0;
    for (const [actor, nonces] of used) {
      for (const [seen, expiry] of nonces) if (expiry <= current) nonces.delete(seen);
      if (nonces.size === 0) {
        used.delete(actor);
        droppedActors += 1;
      }
    }
    lastPrunedAt = current;
    return droppedActors;
  };
  return {
    async consume(actor, nonce, expiresAt) {
      const current = now();
      if (current - lastPrunedAt >= pruneIntervalSeconds) pruneAt(current);
      // A strkey has one spelling, so the actor is the key as given.
      const nonces = used.get(actor) ?? new Map<bigint, bigint>();
      const seen = nonces.get(nonce);
      if (seen !== undefined && seen > current) return false;
      nonces.set(nonce, expiresAt);
      used.set(actor, nonces);
      return true;
    },
    prune() {
      return pruneAt(now());
    },
    size() {
      return used.size;
    },
  };
}

export type VerifyActionFailure =
  | "malformed_message"
  | "contract_actor_unsupported"
  | "missing_expected_network"
  | "network_mismatch"
  | "invalid_signature"
  | "unexpected_actor"
  | "not_yet_valid"
  | "expired"
  | "nonce_reused";

export type VerifyActionResult =
  | { ok: true; actor: string; message: SquareAction }
  | { ok: false; reason: VerifyActionFailure; detail: string };

export interface VerifyActionInput {
  message: SquareAction;
  /** The signature, base64 or hex. */
  signature: string;
  expectedActor: string;
  nonceStore: NonceStore;
  expectedNetwork: string;
  now?: bigint | number | undefined;
  maxLifetimeSeconds?: bigint | number | undefined;
}

export const DEFAULT_MAX_ACTION_LIFETIME_SECONDS = 300n;

function failure(reason: VerifyActionFailure, detail: string): VerifyActionResult {
  return { ok: false, reason, detail };
}

function actorProblem(value: unknown, what: string): VerifyActionResult | undefined {
  if (typeof value !== "string") return failure("malformed_message", `${what} is not an address`);
  if (StrKey.isValidEd25519PublicKey(value)) return undefined;
  if (StrKey.isValidContract(value)) {
    // A contract has no ed25519 key to sign a SEP-53 message with; what it
    // has is an authorization policy, which is fee sponsorship's to use (#27).
    return failure("contract_actor_unsupported", `${what} ${value} is a contract, and SEP-53 messages are signed by ed25519 keys only`);
  }
  return failure("malformed_message", `${what} is not a Stellar account address (G…)`);
}

/**
 * Verify a signed action. Every failure is a `{ ok: false, reason }`, never
 * a throw. The checks run cheapest first and the nonce is consumed last, so
 * a rejected message never burns a nonce. `expectedNetwork` is required: the
 * message carries its own network and the text is built from it, so a
 * signature made for one network verifies on any verifier that does not say
 * which network it is on.
 */
export async function verifyAction(input: VerifyActionInput): Promise<VerifyActionResult> {
  const { message, signature, expectedActor, nonceStore } = input;
  const actorIssue = actorProblem(message.actor, "message.actor") ?? actorProblem(expectedActor, "expectedActor");
  if (actorIssue) return actorIssue;
  if (typeof message.nonce !== "bigint" || typeof message.issuedAt !== "bigint" || typeof message.expiresAt !== "bigint") {
    return failure("malformed_message", "nonce, issuedAt and expiresAt must be bigints");
  }
  if (typeof message.action !== "string" || typeof message.resource !== "string" || typeof message.network !== "string") {
    return failure("malformed_message", "action, resource and network must be strings");
  }
  if (message.expiresAt <= message.issuedAt) return failure("malformed_message", "expiresAt must be after issuedAt");
  const maxLifetimeSeconds = BigInt(input.maxLifetimeSeconds ?? DEFAULT_MAX_ACTION_LIFETIME_SECONDS);
  const lifetimeSeconds = message.expiresAt - message.issuedAt;
  if (lifetimeSeconds > maxLifetimeSeconds) {
    return failure("malformed_message", `lifetime of ${lifetimeSeconds} seconds is longer than the ${maxLifetimeSeconds} second cap this verifier accepts`);
  }
  if (input.expectedNetwork === undefined || input.expectedNetwork === null || input.expectedNetwork === "") {
    return failure("missing_expected_network", "expectedNetwork is required: without it a signature made for another network verifies here");
  }
  if (input.expectedNetwork !== message.network) {
    return failure("network_mismatch", `message is for ${message.network}, expected ${input.expectedNetwork}`);
  }
  if (message.actor !== expectedActor) {
    return failure("unexpected_actor", `message names ${message.actor} but ${expectedActor} was expected`);
  }
  const bytes = typeof signature === "string" ? decodeSignature(signature) : undefined;
  if (bytes === undefined) return failure("invalid_signature", "signature is not a 64-byte ed25519 signature in base64 or hex");
  if (!Keypair.fromPublicKey(message.actor).verifyMessage(actionMessage(message), bytes)) {
    return failure("invalid_signature", `signature does not verify for ${message.actor} over this message`);
  }
  const now = BigInt(input.now ?? currentUnixSeconds());
  if (now < message.issuedAt) return failure("not_yet_valid", `issuedAt ${message.issuedAt} is after now ${now}`);
  if (now >= message.expiresAt) return failure("expired", `expiresAt ${message.expiresAt} is not after now ${now}`);
  const fresh = await nonceStore.consume(message.actor, message.nonce, message.expiresAt);
  if (!fresh) return failure("nonce_reused", `nonce ${message.nonce} was already consumed for ${message.actor}`);
  return { ok: true, actor: message.actor, message };
}
