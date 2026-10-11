/** Applied only when TLS terminates in front of the app (production). */

export const HSTS_HEADER = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains; preload",
} as const;

/** Build connect-src from known app origins — no wildcard ws:/wss:/https:. */
export function buildConnectSrc(
  realtimeWsUrl = process.env.NEXT_PUBLIC_REALTIME_WS_URL,
): string {
  const sources = new Set<string>(["'self'"]);
  const candidates = [
    realtimeWsUrl,
    !realtimeWsUrl && process.env.NODE_ENV !== "production"
      ? "ws://localhost:3001/ws"
      : undefined,
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      const u = new URL(raw);
      sources.add(`${u.protocol}//${u.host}`);
    } catch {
      /* ignore bad env */
    }
  }
  return `connect-src ${[...sources].join(" ")}`;
}

/**
 * React's streaming renderer emits hidden segments as `style="display:none"`.
 * Nonces can't cover style attributes, so allow exactly that value by hash
 * (sha256 of "display:none") instead of opening up 'unsafe-inline'.
 */
const REACT_STREAMING_STYLE_HASH =
  "'sha256-aqNNdDLnnrDOnTNdkJpYlAxKVJtLt9CtFLklmInuUAE='";

function buildCsp(
  nonce: string,
  options?: { allowUnsafeEval?: boolean; allowUnsafeInlineStyles?: boolean },
): string {
  const scriptSrc = options?.allowUnsafeEval
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const styleSrc = options?.allowUnsafeInlineStyles
    ? `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`
    : `style-src 'self' 'nonce-${nonce}' 'unsafe-hashes' ${REACT_STREAMING_STYLE_HASH}`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    scriptSrc,
    styleSrc,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    buildConnectSrc(),
    "media-src 'self' blob:",
  ].join("; ");
}

export function buildSecurityHeaders(options?: {
  hsts?: boolean;
  allowUnsafeEval?: boolean;
  allowUnsafeInlineStyles?: boolean;
  nonce?: string;
}) {
  const nonce = options?.nonce ?? "";

  const headers: Array<{ key: string; value: string }> = [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(self), geolocation=(self), microphone=()",
    },
  ];

  if (nonce) {
    headers.push({
      key: "Content-Security-Policy",
      value: buildCsp(nonce, {
        allowUnsafeEval: options?.allowUnsafeEval,
        allowUnsafeInlineStyles: options?.allowUnsafeInlineStyles,
      }),
    });
  }

  if (options?.hsts) headers.push(HSTS_HEADER);

  return headers;
}

export const NONCE_HEADER = "x-nonce";
