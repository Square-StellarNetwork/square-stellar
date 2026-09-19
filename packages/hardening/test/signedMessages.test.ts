import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  ActorMismatchError,
  actionMessage,
  canonicalJson,
  decodeSignature,
  DEFAULT_MAX_ACTION_LIFETIME_SECONDS,
  memoryNonceStore,
  signAction,
  verifyAction,
} from "../src/signedMessages.js";
import type { MessageSigner, SquareAction, VerifyActionInput } from "../src/signedMessages.js";

const ALICE = Keypair.random();
const BOB = Keypair.random();
const NOW = 1_700_000_000n;
const NETWORK = "stellar:testnet";
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));

function action(overrides: Partial<SquareAction> = {}): SquareAction {
  return {
    actor: ALICE.publicKey(),
    action: "settle",
    resource: "invoice:42",
    nonce: 1n,
    issuedAt: NOW - 10n,
    expiresAt: NOW + 60n,
    network: NETWORK,
    ...overrides,
  };
}

function freshStore() {
  return memoryNonceStore({ now: () => NOW });
}

async function verify(message: SquareAction, signature: string, overrides: Partial<VerifyActionInput> = {}) {
  return verifyAction({ message, signature, expectedActor: ALICE.publicKey(), now: NOW, nonceStore: freshStore(), expectedNetwork: NETWORK, ...overrides });
}

/**
 * The three test cases of SEP-53 itself
 * (stellar-protocol/ecosystem/sep-0053.md, "Test cases"): the published seed,
 * its address, and the signatures the SEP prints. The seed is the SEP's,
 * public by design, and controls nothing.
 */
describe("SEP-53", () => {
  const seed = Keypair.fromSecret("SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW");

  it("is implemented by the SDK the way the SEP's vectors say", () => {
    expect(seed.publicKey()).toBe("GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L");
    expect(seed.signMessage("Hello, World!").toString("base64")).toBe("fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==");
    expect(seed.signMessage("こんにちは、世界！").toString("base64")).toBe("CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==");
    expect(seed.signMessage(Buffer.from("2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=", "base64")).toString("base64")).toBe(
      "VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ==",
    );
  });

  it("verifies the SEP's signature for the SEP's message, and refuses it hex-decoded as something else", () => {
    const signature = decodeSignature("7cee5d6d885752104c85eea421dfdcb95abf01f1271d11c4bec3fcbd7874dccd6e2e98b97b8eb23b643cac4073bb77de5d07b0710139180ae9f3cbba78f2ba04")!;
    expect(Keypair.fromPublicKey(seed.publicKey()).verifyMessage("Hello, World!", signature)).toBe(true);
    expect(Keypair.fromPublicKey(seed.publicKey()).verifyMessage("Hello, World?", signature)).toBe(false);
  });
});

describe("actionMessage", () => {
  it("is canonical JSON of the domain with the network, the type and the message with decimal integers", () => {
    expect(actionMessage(action())).toBe(
      `{"domain":{"name":"Square","network":"stellar:testnet","version":"1"},"message":{"action":"settle","actor":"${ALICE.publicKey()}","expiresAt":"${NOW + 60n}","issuedAt":"${NOW - 10n}","nonce":"1","resource":"invoice:42"},"primaryType":"SquareAction"}`,
    );
  });

  it("changes with every field, so no two actions share a text", () => {
    const base = actionMessage(action());
    for (const overrides of [{ action: "settled" }, { resource: "invoice:43" }, { nonce: 2n }, { issuedAt: NOW - 11n }, { expiresAt: NOW + 61n }, { network: "stellar:pubnet" }, { actor: BOB.publicKey() }]) {
      expect(actionMessage(action(overrides))).not.toBe(base);
    }
  });
});

describe("signAction", () => {
  it("signs with a keypair, per SEP-53, base64", async () => {
    const message = action();
    const signature = await signAction(ALICE, message);
    expect(signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    expect(ALICE.verifyMessage(actionMessage(message), Buffer.from(signature, "base64"))).toBe(true);
  });

  it("signs with a SEP-43 wallet, whatever encoding it answers in", async () => {
    const message = action();
    const hexWallet: MessageSigner = {
      address: ALICE.publicKey(),
      signMessage: async (text) => ({ signedMessage: ALICE.signMessage(text).toString("hex"), signerAddress: ALICE.publicKey() }),
    };
    const base64Wallet: MessageSigner = {
      address: ALICE.publicKey(),
      signMessage: async (text) => ({ signedMessage: ALICE.signMessage(text).toString("base64") }),
    };
    const fromHex = await signAction(hexWallet, message);
    const fromBase64 = await signAction(base64Wallet, message);
    expect(fromHex).toBe(fromBase64);
    expect((await verify(message, fromHex)).ok).toBe(true);
  });

  it("refuses to sign for an actor other than the signer", async () => {
    await expect(signAction(BOB, action())).rejects.toThrow(ActorMismatchError);
    const wallet: MessageSigner = { address: BOB.publicKey(), signMessage: async () => ({ signedMessage: "" }) };
    await expect(signAction(wallet, action())).rejects.toThrow(ActorMismatchError);
    const lying: MessageSigner = {
      address: ALICE.publicKey(),
      signMessage: async (text) => ({ signedMessage: BOB.signMessage(text).toString("base64"), signerAddress: BOB.publicKey() }),
    };
    await expect(signAction(lying, action())).rejects.toThrow(ActorMismatchError);
  });

  it("refuses a wallet answer that is not a signature", async () => {
    const wallet: MessageSigner = { address: ALICE.publicKey(), signMessage: async () => ({ signedMessage: "signed!" }) };
    await expect(signAction(wallet, action())).rejects.toThrow(/64-byte signature/);
  });
});

describe("verifyAction", () => {
  it("accepts a valid signature from the named and expected actor", async () => {
    const message = action();
    const signature = await signAction(ALICE, message);
    expect(await verify(message, signature)).toEqual({ ok: true, actor: ALICE.publicKey(), message });
  });

  it("accepts the signature in hex as well as base64", async () => {
    const message = action();
    const signature = await signAction(ALICE, message);
    expect((await verify(message, Buffer.from(signature, "base64").toString("hex"))).ok).toBe(true);
  });

  it("rejects when the server expected a different actor", async () => {
    const message = action();
    const signature = await signAction(ALICE, message);
    expect(await verify(message, signature, { expectedActor: BOB.publicKey() })).toMatchObject({ ok: false, reason: "unexpected_actor" });
  });

  it("rejects when the message names an actor who did not sign it", async () => {
    const message = action({ actor: BOB.publicKey() });
    const signature = ALICE.signMessage(actionMessage(message)).toString("base64");
    expect(await verify(message, signature, { expectedActor: BOB.publicKey() })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a tampered message", async () => {
    const message = action();
    const signature = await signAction(ALICE, message);
    expect(await verify({ ...message, resource: "invoice:43" }, signature)).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects an expired message, including exactly at expiresAt", async () => {
    const message = action();
    const signature = await signAction(ALICE, message);
    expect(await verify(message, signature, { now: NOW + 60n })).toMatchObject({ ok: false, reason: "expired" });
    expect(await verify(message, signature, { now: NOW + 61n })).toMatchObject({ ok: false, reason: "expired" });
  });

  it("rejects a message that is not yet valid", async () => {
    const message = action({ issuedAt: NOW + 5n, expiresAt: NOW + 65n });
    const signature = await signAction(ALICE, message);
    expect(await verify(message, signature)).toMatchObject({ ok: false, reason: "not_yet_valid" });
  });

  it("rejects a reused nonce while keeping other nonces and actors usable", async () => {
    const store = freshStore();
    const message = action();
    const signature = await signAction(ALICE, message);
    expect((await verify(message, signature, { nonceStore: store })).ok).toBe(true);
    expect(await verify(message, signature, { nonceStore: store })).toMatchObject({ ok: false, reason: "nonce_reused" });
    const next = action({ nonce: 2n });
    expect((await verify(next, await signAction(ALICE, next), { nonceStore: store })).ok).toBe(true);
    const bobs = action({ actor: BOB.publicKey() });
    expect((await verify(bobs, await signAction(BOB, bobs), { nonceStore: store, expectedActor: BOB.publicKey() })).ok).toBe(true);
  });

  it("does not burn the nonce when an earlier check fails", async () => {
    const store = freshStore();
    const message = action();
    const signature = await signAction(ALICE, message);
    expect(await verify(message, signature, { nonceStore: store, now: NOW + 60n })).toMatchObject({ ok: false, reason: "expired" });
    expect((await verify(message, signature, { nonceStore: store })).ok).toBe(true);
  });

  it("rejects a network mismatch when the verifier pins a network", async () => {
    const message = action({ network: "stellar:pubnet" });
    const signature = await signAction(ALICE, message);
    expect(await verify(message, signature)).toMatchObject({ ok: false, reason: "network_mismatch" });
    expect((await verify(message, signature, { expectedNetwork: "stellar:pubnet" })).ok).toBe(true);
  });

  it("refuses to verify at all when the caller leaves expectedNetwork out", async () => {
    const message = action();
    const signature = await signAction(ALICE, message);
    expect(await verify(message, signature, { expectedNetwork: undefined as unknown as string })).toMatchObject({ ok: false, reason: "missing_expected_network" });
    expect(await verify(message, signature, { expectedNetwork: "" })).toMatchObject({ ok: false, reason: "missing_expected_network" });
  });

  it("refuses an expiresAt the signer stretched past the cap, and does not burn the nonce", async () => {
    const store = freshStore();
    const message = action({ expiresAt: NOW - 10n + DEFAULT_MAX_ACTION_LIFETIME_SECONDS + 1n });
    const signature = await signAction(ALICE, message);
    expect(await verify(message, signature, { nonceStore: store })).toMatchObject({ ok: false, reason: "malformed_message" });
    const capped = action({ expiresAt: NOW - 10n + DEFAULT_MAX_ACTION_LIFETIME_SECONDS });
    expect((await verify(capped, await signAction(ALICE, capped), { nonceStore: store })).ok).toBe(true);
  });

  it("lets the verifier pick a shorter cap than the default", async () => {
    const message = action({ expiresAt: NOW - 10n + 31n });
    const signature = await signAction(ALICE, message);
    expect(await verify(message, signature, { maxLifetimeSeconds: 30 })).toMatchObject({ ok: false, reason: "malformed_message" });
  });

  it("names a contract actor as unsupported rather than malformed", async () => {
    const message = action({ actor: CONTRACT });
    const signature = await signAction(ALICE, action());
    expect(await verify(message, signature, { expectedActor: CONTRACT })).toMatchObject({ ok: false, reason: "contract_actor_unsupported" });
    expect(await verify(action(), signature, { expectedActor: CONTRACT })).toMatchObject({ ok: false, reason: "contract_actor_unsupported" });
  });

  it("rejects garbage signatures without throwing", async () => {
    const message = action();
    for (const garbage of ["", "nope", "AAAA", "0x" + "00".repeat(64), Buffer.alloc(64).toString("base64")]) {
      expect(await verify(message, garbage)).toMatchObject({ ok: false, reason: "invalid_signature" });
    }
  });

  it("rejects malformed messages", async () => {
    const signature = await signAction(ALICE, action());
    expect(await verify(action({ actor: "0x1111111111111111111111111111111111111111" }), signature)).toMatchObject({ ok: false, reason: "malformed_message" });
    expect(await verify(action({ actor: ALICE.publicKey().toLowerCase() }), signature)).toMatchObject({ ok: false, reason: "malformed_message" });
    expect(await verify(action({ expiresAt: NOW - 10n }), signature)).toMatchObject({ ok: false, reason: "malformed_message" });
    expect(await verify(action({ nonce: 1 as unknown as bigint }), signature)).toMatchObject({ ok: false, reason: "malformed_message" });
  });
});

describe("memoryNonceStore", () => {
  it("forgets nonces once their message has expired", async () => {
    let clock = NOW;
    const store = memoryNonceStore({ now: () => clock });
    expect(await store.consume(ALICE.publicKey(), 1n, NOW + 10n)).toBe(true);
    expect(await store.consume(ALICE.publicKey(), 1n, NOW + 10n)).toBe(false);
    clock = NOW + 10n;
    expect(await store.consume(ALICE.publicKey(), 1n, NOW + 20n)).toBe(true);
  });

  it("drops an actor entry once every nonce it holds has expired", async () => {
    let clock = NOW;
    const store = memoryNonceStore({ now: () => clock, pruneIntervalSeconds: 3_600 });
    for (let index = 0; index < 200; index += 1) {
      const actor = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, index));
      expect(await store.consume(actor, 1n, NOW + 10n)).toBe(true);
    }
    expect(store.size()).toBe(200);
    clock = NOW + 10n;
    expect(store.prune()).toBe(200);
    expect(store.size()).toBe(0);
  });

  it("prunes on a time interval rather than on a call count", async () => {
    let clock = NOW;
    const store = memoryNonceStore({ now: () => clock, pruneIntervalSeconds: 30 });
    for (let index = 0; index < 200; index += 1) {
      const actor = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, index));
      await store.consume(actor, 1n, NOW + 10n);
    }
    expect(store.size()).toBe(200);

    clock = NOW + 31n;
    await store.consume(BOB.publicKey(), 1n, clock + 10n);
    expect(store.size()).toBe(1);
  });

  it("keeps a live nonce when a prune runs", async () => {
    const store = memoryNonceStore({ now: () => NOW, pruneIntervalSeconds: 0 });
    expect(await store.consume(ALICE.publicKey(), 1n, NOW + 10n)).toBe(true);
    expect(await store.consume(ALICE.publicKey(), 1n, NOW + 10n)).toBe(false);
    expect(store.size()).toBe(1);
  });

  const fastestOf = async (runs: number, measure: () => Promise<number>): Promise<number> => {
    let fastest = Number.POSITIVE_INFINITY;
    for (let run = 0; run < runs; run += 1) fastest = Math.min(fastest, await measure());
    return fastest;
  };

  const fillFreshStore = async (count: number, alreadyHolding = 0): Promise<number> => {
    const store = memoryNonceStore({ now: () => NOW, pruneIntervalSeconds: 3_600 });
    for (let nonce = 0; nonce < alreadyHolding; nonce += 1) await store.consume(ALICE.publicKey(), BigInt(nonce), NOW + 300n);
    const startedAt = performance.now();
    for (let nonce = alreadyHolding; nonce < alreadyHolding + count; nonce += 1) {
      await store.consume(ALICE.publicKey(), BigInt(nonce), NOW + 300n);
    }
    return performance.now() - startedAt;
  };

  it(
    "consumes at a cost that does not grow with the number of live nonces the actor holds",
    async () => {
      await fillFreshStore(10_000);
      const onAnEmptyStore = await fastestOf(5, () => fillFreshStore(10_000));
      const onAStoreHolding40k = await fastestOf(5, () => fillFreshStore(10_000, 40_000));

      expect(onAStoreHolding40k).toBeLessThan(Math.max(onAnEmptyStore, 1) * 4);
    },
    60_000
  );

  const fillFreshMap = async (count: number): Promise<number> => {
    const used = new Map<string, Map<bigint, bigint>>();
    const set = async (actor: string, nonce: bigint, expiresAt: bigint): Promise<boolean> => {
      const nonces = used.get(actor) ?? new Map<bigint, bigint>();
      const seen = nonces.get(nonce);
      if (seen !== undefined && seen > NOW) return false;
      nonces.set(nonce, expiresAt);
      used.set(actor, nonces);
      return true;
    };
    const startedAt = performance.now();
    for (let nonce = 0; nonce < count; nonce += 1) await set(ALICE.publicKey(), BigInt(nonce), NOW + 300n);
    return performance.now() - startedAt;
  };

  const fastestFillsOf = async (runs: number, count: number): Promise<{ store: number; map: number }> => {
    let store = Number.POSITIVE_INFINITY;
    let map = Number.POSITIVE_INFINITY;
    for (let run = 0; run < runs; run += 1) {
      map = Math.min(map, await fillFreshMap(count));
      store = Math.min(store, await fillFreshStore(count));
    }
    return { store, map };
  };

  it(
    "fills in linear time, so an actor cannot make its own verification quadratic",
    async () => {
      await fillFreshStore(80_000);
      await fillFreshMap(80_000);
      const fiveThousand = await fastestFillsOf(5, 5_000);
      const eightyThousand = await fastestFillsOf(5, 80_000);

      const storeGrowth = eightyThousand.store / fiveThousand.store;
      const mapGrowth = eightyThousand.map / fiveThousand.map;
      expect(storeGrowth / mapGrowth).toBeLessThan(3);
    },
    60_000
  );
});

describe("canonicalJson", () => {
  it("sorts keys recursively and strips whitespace", () => {
    expect(canonicalJson({ b: [3, { z: 1, y: "s" }], a: null, c: true })).toBe('{"a":null,"b":[3,{"y":"s","z":1}],"c":true}');
  });

  it("drops undefined members and turns undefined array items into null", () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
  });

  it("keeps numbers exactly as JSON numbers", () => {
    expect(canonicalJson({ n: 1e21, m: -0, k: 0.1, j: 1000000 })).toBe('{"j":1000000,"k":0.1,"m":0,"n":1e+21}');
  });

  it("escapes strings like JSON.stringify", () => {
    expect(canonicalJson({ s: 'quote " and \n newline' })).toBe('{"s":"quote \\" and \\n newline"}');
  });

  it("uses toJSON like JSON.stringify", () => {
    expect(canonicalJson({ at: new Date(0) })).toBe('{"at":"1970-01-01T00:00:00.000Z"}');
  });

  it("refuses values that have no canonical form", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ big: 1n })).toThrow(TypeError);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });

  it("refuses a Map instead of flattening two different maps to the same empty object", () => {
    const alice = new Map<string, unknown>([
      ["amount", 1],
      ["to", "0xalice"],
    ]);
    const mallory = new Map<string, unknown>([
      ["amount", 1_000_000],
      ["to", "0xmallory"],
    ]);

    expect(() => canonicalJson(alice)).toThrow(TypeError);
    expect(() => canonicalJson(alice)).toThrow(/cannot represent Map/);
    expect(() => canonicalJson(mallory)).toThrow(TypeError);
  });

  it("refuses a Set", () => {
    expect(() => canonicalJson(new Set([1, 2, 3]))).toThrow(/cannot represent Set/);
  });

  it("refuses an instance whose state hides behind a non-plain prototype", () => {
    class Payout {
      readonly #amount: number;

      constructor(amount: number) {
        this.#amount = amount;
      }

      amount(): number {
        return this.#amount;
      }
    }

    expect(() => canonicalJson(new Payout(1))).toThrow(/cannot represent Payout/);
    expect(() => canonicalJson(new Payout(1_000_000))).toThrow(TypeError);
    expect(() => canonicalJson(Object.create(Object.create(null)) as object)).toThrow(
      /cannot represent an object with a non-plain prototype/
    );
  });

  it("refuses a typed array, which would otherwise collide with the plain object of its indices", () => {
    expect(() => canonicalJson(new Uint8Array([1, 2]))).toThrow(/cannot represent Uint8Array/);
    expect(canonicalJson({ 0: 1, 1: 2 })).toBe('{"0":1,"1":2}');
  });

  it("refuses a Map nested inside an otherwise plain body", () => {
    expect(() => canonicalJson({ payout: new Map([["amount", 1]]) })).toThrow(/cannot represent Map/);
    expect(() => canonicalJson({ recipients: [new Set(["0xalice"])] })).toThrow(/cannot represent Set/);
  });

  it("still serialises plain objects, null-prototype dictionaries and classes that define toJSON", () => {
    class Money {
      constructor(private readonly amount: number) {}

      toJSON(): unknown {
        return { amount: this.amount };
      }
    }

    const dictionary = Object.create(null) as Record<string, unknown>;
    dictionary["b"] = 2;
    dictionary["a"] = 1;

    expect(canonicalJson(new Money(5))).toBe('{"amount":5}');
    expect(canonicalJson({ paid: new Money(5) })).toBe('{"paid":{"amount":5}}');
    expect(canonicalJson(dictionary)).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ at: new Date(0) })).toBe('{"at":"1970-01-01T00:00:00.000Z"}');
  });
});
