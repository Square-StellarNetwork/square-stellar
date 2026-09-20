/**
 * What a browser wallet threw, in words (#58).
 *
 * A wallet here is a browser extension, and an extension's messaging layer
 * does not reject with an `Error`. It rejects with the raw object it built —
 * `{ code: 4900, message: "Message channel disconnected" }` — which carries a
 * message but fails `instanceof Error`. Reading that as unknown is what put
 * "Unknown error" on the deposit page while the real cause, an extension the
 * page could no longer reach, was visible only in the console.
 *
 * Two failures are worth naming apart from the rest, because what to do about
 * them differs and neither is the chain's doing: an extension that has stopped
 * answering, and a person who said no.
 */

/** EIP-1193's "the provider is disconnected", which both wallets in use send. */
const DISCONNECTED = 4900;
/** EIP-1193's "the user rejected the request". */
const REJECTED = 4001;

/** How deep to look through nested `{ error }` wrappers before giving up. */
const MAX_DEPTH = 3;

const UNREACHABLE = [/receiving end does not exist/i, /could not establish connection/i, /message channel disconnected/i, /extension context invalidated/i];

const DECLINED = [/user (declined|rejected|denied)/i, /(declined|rejected|denied) by the user/i];

export const walletUnreachable =
  "The wallet extension is not answering this page, so nothing could be sent to it to sign. " +
  "A browser that has updated or suspended the extension does this. Reload the page; if it still does not answer, open the wallet once and reload again.";

export const walletDeclined = "The wallet refused the request, so nothing was signed and nothing was spent.";

/** The message a thrown value carries, whatever shape it arrived in. */
export function thrownMessage(error: unknown, depth = 0): string | null {
  if (typeof error === "string") return error.trim().length === 0 ? null : error;
  if (error instanceof Error) return error.message.trim().length === 0 ? null : error.message;
  if (typeof error !== "object" || error === null) return null;

  const { message, error: nested } = error as { message?: unknown; error?: unknown };
  if (typeof message === "string" && message.trim().length > 0) return message;
  // A wallet often answers `{ error }` rather than throwing, and the kit hands
  // that object on unchanged.
  if (nested === undefined || nested === error || depth >= MAX_DEPTH) return null;
  return thrownMessage(nested, depth + 1);
}

/** The error's numeric code, when it has one. */
function codeOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { code } = error as { code?: unknown };
  return typeof code === "number" ? code : null;
}

/**
 * A plain-language sentence when the wallet, rather than the chain, is what
 * went wrong — and `null` when it is not, so the caller keeps saying whatever
 * it said before.
 */
export function walletErrorMessage(error: unknown): string | null {
  const code = codeOf(error);
  const message = thrownMessage(error) ?? "";
  if (code === DISCONNECTED || UNREACHABLE.some((pattern) => pattern.test(message))) return walletUnreachable;
  if (code === REJECTED || DECLINED.some((pattern) => pattern.test(message))) return walletDeclined;
  return null;
}
