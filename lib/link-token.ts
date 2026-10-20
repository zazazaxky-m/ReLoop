/**
 * Emailed single-use tokens on the web (A03). The link carries the token in
 * the URL fragment (`#token=…`), which browsers never send to a server or in a
 * Referer. `linkTokenCaptureScript` runs inline at the top of the page, before
 * the app's scripts: it moves the token into this tab's sessionStorage (so it
 * survives a sign-in detour) and removes the fragment from the address bar.
 * The page component then reads it with `takeLinkToken` and forgets it once
 * the token was used or refused for good.
 */

export type LinkTokenKind = "accept-invitation" | "verify-email";

const STORAGE_PREFIX = "reloop:link-token:";
const TOKEN_RE = "[A-Za-z0-9_-]{32,128}";

export function linkTokenStorageKey(kind: LinkTokenKind): string {
  return `${STORAGE_PREFIX}${kind}`;
}

/** Inline script body for the page (rendered with the CSP nonce). */
export function linkTokenCaptureScript(kind: LinkTokenKind): string {
  const key = JSON.stringify(linkTokenStorageKey(kind));
  return `(function(){try{var h=window.location.hash;if(!h)return;var m=/(?:^#|&)token=(${TOKEN_RE})(?:&|$)/.exec(h);` +
    `if(m){window.__reloopLinkToken=m[1];try{window.sessionStorage.setItem(${key},m[1]);}catch(e){}}` +
    `window.history.replaceState(window.history.state,"",window.location.pathname+window.location.search);}catch(e){}})();`;
}

/** Token for this page: from the capture script, this tab's storage, or (fallback) the fragment. */
export function takeLinkToken(kind: LinkTokenKind): string | null {
  if (typeof window === "undefined") return null;
  const pattern = new RegExp(`^${TOKEN_RE}$`);
  const fromFragment = new RegExp(`(?:^#|&)token=(${TOKEN_RE})(?:&|$)`).exec(window.location.hash)?.[1] ?? null;
  if (window.location.hash) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }
  const captured = (window as unknown as { __reloopLinkToken?: unknown }).__reloopLinkToken;
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(linkTokenStorageKey(kind));
  } catch {
    stored = null;
  }
  const token = fromFragment ?? (typeof captured === "string" ? captured : null) ?? stored;
  if (!token || !pattern.test(token)) return null;
  try {
    window.sessionStorage.setItem(linkTokenStorageKey(kind), token);
  } catch {
    // Without storage the token lives only in this page's memory.
  }
  return token;
}

/** Drops the token from this tab once it was used or can never work. */
export function forgetLinkToken(kind: LinkTokenKind): void {
  if (typeof window === "undefined") return;
  (window as unknown as { __reloopLinkToken?: unknown }).__reloopLinkToken = undefined;
  try {
    window.sessionStorage.removeItem(linkTokenStorageKey(kind));
  } catch {
    // nothing stored
  }
}

/** Internal pages a sign-in may return to (never an arbitrary URL: no open redirect). */
export const POST_AUTH_PATHS = ["/accept-invitation", "/verify-email"] as const;

export function safeNextPath(value: unknown): (typeof POST_AUTH_PATHS)[number] | null {
  return POST_AUTH_PATHS.find((path) => path === value) ?? null;
}
