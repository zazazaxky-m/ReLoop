/** Applied only when TLS terminates in front of the app (production). */

export const HSTS_HEADER = {

  key: "Strict-Transport-Security",

  value: "max-age=63072000; includeSubDomains; preload",

} as const;



function buildCsp(nonce: string, options?: { allowUnsafeEval?: boolean }): string {

  const scriptSrc = options?.allowUnsafeEval

    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`

    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [

    "default-src 'self'",

    "base-uri 'self'",

    "form-action 'self'",

    "frame-ancestors 'none'",

    "object-src 'none'",

    scriptSrc,

    `style-src 'self' 'nonce-${nonce}'`,

    "img-src 'self' data: blob: https:",

    "font-src 'self' data:",

    "connect-src 'self' ws: wss: https:",

    "media-src 'self' blob:",

  ].join("; ");

}



export function buildSecurityHeaders(options?: {

  hsts?: boolean;

  allowUnsafeEval?: boolean;

  nonce?: string;

}) {

  const nonce = options?.nonce ?? "";

  const headers: Array<{ key: string; value: string }> = [

    { key: "X-Frame-Options", value: "DENY" },

    { key: "X-Content-Type-Options", value: "nosniff" },

    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

    { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },

  ];



  if (nonce) {

    headers.push({

      key: "Content-Security-Policy",

      value: buildCsp(nonce, { allowUnsafeEval: options?.allowUnsafeEval }),

    });

  }



  if (options?.hsts) headers.push(HSTS_HEADER);

  return headers;

}



export const NONCE_HEADER = "x-nonce";
