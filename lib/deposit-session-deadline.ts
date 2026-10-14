/**
 * Deposit session deadline and machine lease bounds (task R03). Pure: no
 * database or network access, shared by the session service, the machine
 * lease route and the machine-event side effects.
 *
 * Invariant: every lease the server issues for a session expires no later
 * than the session's deadline, and the deadline never moves earlier and is
 * never moved once it has passed. "Deadline passed" therefore means "every
 * lease issued for the session has expired", which is what lets the timeout
 * policy close the session without overwriting anything the machine still
 * runs.
 *
 * Clock assumption (M2): `expiresAt` is an absolute unix time that the RVM
 * checks against its own clock (rvm/controller.py `activate_lease`). The
 * invariant is exact for an RVM clock that agrees with the server; machine
 * requests are accepted with up to MACHINE_SIG_MAX_SKEW_SECONDS (300 s) of
 * skew, so an RVM whose clock runs behind can keep using a lease for up to
 * that long after the server deadline. Machines run NTP; what such a machine
 * does in that window stays attributed to its session, and an acceptance it
 * reports after the deadline is held for review (lib/machine-events/acceptance.ts).
 * A relative lease duration is part of the separate protocol upgrade
 * (rvm/README.md, "Lease sesi dan jendela replay").
 */

/** Upper bound of a machine lease (seconds), independent of the session deadline. */
export const MACHINE_LEASE_MAX_SECONDS = 300;

/**
 * The last moment a lease issued for `session` can be valid: `timeoutAt`, or
 * for a session without one (legacy rows, e.g. REVIEW sessions created before
 * R03) `startedAt` + the machine's idle timeout. `timeoutAt` is only extended
 * while the deadline has not passed (ITEM_DETECTED) and `startedAt` never
 * changes, so no late machine event can move a passed deadline or revive the
 * session.
 */
export function sessionDeadline(
  session: { timeoutAt: Date | null; startedAt: Date },
  idleTimeoutMinutes: number,
): Date {
  return session.timeoutAt ?? new Date(session.startedAt.getTime() + idleTimeoutMinutes * 60_000);
}

/**
 * When the session stopped accepting machine work: its deadline, or earlier
 * when it was ended (finish/cancel/timeout) before that.
 */
export function sessionEnd(
  session: { timeoutAt: Date | null; startedAt: Date; completedAt: Date | null },
  idleTimeoutMinutes: number,
): Date {
  const deadline = sessionDeadline(session, idleTimeoutMinutes);
  return session.completedAt && session.completedAt.getTime() < deadline.getTime() ? session.completedAt : deadline;
}

/**
 * Lease expiry (unix seconds): at most MACHINE_LEASE_MAX_SECONDS after issue
 * and never after the session deadline. Null when the deadline is already
 * reached (no lease).
 */
export function machineLeaseExpiry(deadline: Date, issuedAtSeconds: number): number | null {
  const expiresAt = Math.min(Math.floor(deadline.getTime() / 1000), issuedAtSeconds + MACHINE_LEASE_MAX_SECONDS);
  return expiresAt > issuedAtSeconds ? expiresAt : null;
}
