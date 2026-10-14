/**
 * Machine request replay window (SEC-09), shared by the signature check
 * (lib/machine-auth.ts) and the nonce store (lib/machine-nonce.ts).
 *
 * A signature is accepted while |server clock - x-reloop-timestamp| is at most
 * MACHINE_SIG_MAX_SKEW_SECONDS. One signed request is therefore valid for
 * 2 * skew seconds of server time: from `timestamp - skew` (machine clock up to
 * `skew` ahead) until `timestamp + skew` (machine clock behind). Its nonce is
 * consumed at the first use, which can be the very start of that window, so the
 * nonce must be remembered for the whole 2 * skew seconds, plus a 60 s margin
 * for clock drift between app instances and Redis expiry granularity.
 */
export const MACHINE_SIG_MAX_SKEW_SECONDS = 300;

/** Nonce lifetime from its first use: (2 * skew + 60) s = 660 000 ms. */
export const MACHINE_NONCE_TTL_MS = (2 * MACHINE_SIG_MAX_SKEW_SECONDS + 60) * 1000;
