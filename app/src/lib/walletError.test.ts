import { describe, expect, it } from "vitest";

import { thrownMessage, walletDeclined, walletErrorMessage, walletUnreachable } from "./walletError";

describe("thrownMessage", () => {
  it("reads the message off a plain object, which is what an extension rejects with", () => {
    // Verbatim from the deposit page's console: the wallet's messaging layer
    // rejected with this, and nothing about it is an Error.
    expect(thrownMessage({ code: 4900, message: "Message channel disconnected" })).toBe("Message channel disconnected");
  });

  it("reads an Error and a bare string", () => {
    expect(thrownMessage(new Error("boom"))).toBe("boom");
    expect(thrownMessage("boom")).toBe("boom");
  });

  it("unwraps the `{ error }` shape a wallet answers with instead of throwing", () => {
    expect(thrownMessage({ error: { code: -1, message: "User declined access" } })).toBe("User declined access");
  });

  it("has nothing to say about a value that carries no message", () => {
    expect(thrownMessage({ code: 4900 })).toBeNull();
    expect(thrownMessage(undefined)).toBeNull();
    expect(thrownMessage("   ")).toBeNull();
  });

  it("does not loop on a value that refers back to itself", () => {
    const cycle: { error?: unknown } = {};
    cycle.error = cycle;
    expect(thrownMessage(cycle)).toBeNull();
  });
});

describe("walletErrorMessage", () => {
  it("names an extension the page cannot reach, by its message or by its code", () => {
    expect(walletErrorMessage(new Error("Could not establish connection. Receiving end does not exist."))).toBe(walletUnreachable);
    expect(walletErrorMessage({ code: 4900, message: "Message channel disconnected" })).toBe(walletUnreachable);
    expect(walletErrorMessage(new Error("Extension context invalidated."))).toBe(walletUnreachable);
  });

  it("says to reload, because that is what fixes an extension the page lost", () => {
    expect(walletUnreachable).toMatch(/reload/i);
  });

  it("separates a refusal from a failure: nothing was signed and nothing was spent", () => {
    expect(walletErrorMessage({ code: 4001, message: "User rejected the request" })).toBe(walletDeclined);
    expect(walletErrorMessage(new Error("User declined access"))).toBe(walletDeclined);
    expect(walletDeclined).toMatch(/nothing was (signed|spent)/i);
  });

  it("leaves anything it does not recognise to the caller", () => {
    expect(walletErrorMessage(new Error("the ledger is full"))).toBeNull();
    expect(walletErrorMessage(undefined)).toBeNull();
  });
});
