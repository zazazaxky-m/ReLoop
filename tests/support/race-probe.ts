import type { PrismaClient } from "@prisma/client";

/**
 * Deterministic race helpers for real-database tests. Services under test
 * accept ServiceHooks from the test process (dependency injection); nothing
 * here adds an endpoint or backdoor to production code.
 *
 * Pattern: let transaction 1 take the lock and signal a barrier, start
 * transaction 2, prove it is blocked (waitForLockWait + isStillPending), then
 * release transaction 1. Never wait for transaction 2 to reach a point after
 * the conflicting lock before releasing transaction 1: that deadlocks.
 */
export interface ServiceHooks {
  /** Runs inside the transaction right after the service acquired its locks. */
  afterLock?: () => Promise<void>;
  /** Runs after COMMIT and before the response is produced (lost-response injection). */
  afterCommit?: () => Promise<void>;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Bounded probe: true when `promise` has not settled within `ms`. */
export async function isStillPending(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const pending = Symbol("pending");
  const outcome = await Promise.race([
    promise.then(() => "settled", () => "settled"),
    new Promise((resolve) => setTimeout(() => resolve(pending), ms)),
  ]);
  return outcome === pending;
}

/**
 * Proves from pg_locks (via a third, independent connection) that backend
 * `waiterPid` is blocked by `holderPid`. Rejects after `timeoutMs`.
 */
export async function waitForLockWait(
  observer: PrismaClient,
  { waiterPid, holderPid, timeoutMs = 5_000 }: { waiterPid: number; holderPid: number; timeoutMs?: number },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await observer.$queryRaw<{ blockers: number[] }[]>`
      SELECT pg_blocking_pids(${waiterPid}::int) AS blockers`;
    if (row.blockers.includes(holderPid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${waiterPid} was not blocked by ${holderPid} within ${timeoutMs}ms`);
}

export class InjectedFault extends Error {
  constructor(message = "INJECTED_LOST_RESPONSE") {
    super(message);
    this.name = "InjectedFault";
  }
}

/** afterCommit hook simulating a response lost after the database committed. */
export function failAfterCommit(): NonNullable<ServiceHooks["afterCommit"]> {
  return async () => {
    throw new InjectedFault();
  };
}
