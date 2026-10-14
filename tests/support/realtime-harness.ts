import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { sessionMaxAgeSeconds } from "@/lib/auth";
import type { AppRole } from "@/lib/roles";
import { resolveWsSessionIdentity, type VerifiedSessionClaims } from "@/lib/ws-session";
import type { ActorKey, FixtureActor } from "./fixture-core";
import { GatewaySocket } from "./ws-client";

export type RealtimePublishEvent =
  | { topic: "security-alert"; organizationId: string; machineCode: string; eventType: string; eventId?: string; occurredAt?: string }
  | { topic: "machine-event" | "machine-state"; machineCode: string; eventType: string; [extra: string]: unknown };

/** One test WebSocket connected to the gateway child. */
export interface RealtimeClient {
  receivedCount(): Promise<number>;
  /** Harness extra: `data` of each event frame received. */
  events(): Promise<Array<Record<string, unknown>>>;
  /** Harness extra: sends a masked client text frame (as a browser would). */
  send(text: string): Promise<void>;
  /** Harness extra: true once the gateway closed this socket (waits up to `withinMs`). */
  closed(withinMs?: number): Promise<boolean>;
  /** Harness extra: close code the gateway sent, if any. */
  closeCode(): number | null;
  /** Harness extra: opens a NEW socket with the same session cookie. */
  reconnect(): Promise<RealtimeClient>;
  /** Harness extra: closes this socket from the client side. */
  disconnect(): void;
  /** Harness extra: session expiry (Unix seconds) the fake JWT carries; null for guests. */
  readonly expiresAt: number | null;
}

export interface RealtimeHarness {
  connect(actor:ActorKey,options?:{ttlSeconds:number}):Promise<RealtimeClient>;
  advanceClock(ms:number):Promise<void>;
  publish(event:RealtimePublishEvent):Promise<void>;
  close():Promise<void>;

  // Harness extras (test-only; nothing here exists in the production gateway):
  /** Harness clock (ms), the same clock the gateway child runs on. */
  now(): number;
  /** Raw POST /publish: status and `delivered` (null when rejected). */
  publishStatus(event: unknown): Promise<{ status: number; delivered: number | null }>;
  /** Makes the internal live verifier answer 503 (transient outage) or recover. */
  setVerifierAvailable(available: boolean): void;
  /** Number of authenticated requests the live verifier has received. */
  verifierCalls(): number;
  /** Timers the gateway currently has armed on the injected scheduler. */
  pendingTimers(): Promise<number>;
  /** Calls gateway.close() inside the child; reports timers left on the injected scheduler. */
  shutdown(): Promise<{ pendingTimers: number }>;
}

interface HarnessOptions {
  internalSecret: string;
  issueSession(actor: FixtureActor): Promise<{
    token: string;
    user: { id: string; role: string; organizationId: string | null; tokenVersion: number };
  }>;
}

const CHILD = path.resolve(__dirname, "realtime-gateway-child.mjs");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts an isolated gateway child (real realtime/server.mjs factory; clock
 * and timers driven over IPC) and an internal live verifier that checks the
 * bearer secret and answers with the PRODUCTION live DB guard
 * (`resolveWsSessionIdentity`) on the disposable database. Only the session
 * expiry is simulated: each fixture token is registered with `ttlSeconds`
 * judged on the harness clock, so tests can expire it with advanceClock.
 */
export async function startRealtimeHarness({ internalSecret, issueSession }: HarnessOptions): Promise<RealtimeHarness> {
  if (!internalSecret) throw new Error("REALTIME_INTERNAL_SECRET missing; run through scripts/run-audit-tests.mjs");
  let offsetMs = 0;
  const now = () => Date.now() + offsetMs;
  const registrations = new Map<string, VerifiedSessionClaims>();
  const sockets: GatewaySocket[] = [];
  let verifierAvailable = true;
  let verifierCalls = 0;

  const verifier: Server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.method !== "POST" || req.headers.authorization !== `Bearer ${internalSecret}`) {
      res.writeHead(401).end();
      return;
    }
    verifierCalls += 1;
    if (!verifierAvailable) {
      res.writeHead(503).end();
      return;
    }
    try {
      let claims: VerifiedSessionClaims | undefined;
      try {
        claims = registrations.get(String(JSON.parse(raw).token ?? ""));
      } catch {
        claims = undefined;
      }
      const identity = claims ? await resolveWsSessionIdentity(claims, now()) : null;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(identity));
    } catch {
      res.writeHead(500).end();
    }
  });
  verifier.listen(0, "127.0.0.1");
  await once(verifier, "listening");
  const verifierPort = (verifier.address() as { port: number }).port;

  const child: ChildProcess = fork(CHILD, [], {
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      REALTIME_INTERNAL_SECRET: internalSecret,
      REALTIME_WS_SESSION_URL: `http://127.0.0.1:${verifierPort}/api/internal/ws-session`,
    },
  });
  let output = "";
  child.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-2_000); });
  child.stderr?.on("data", (chunk) => { output = (output + chunk).slice(-2_000); });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`realtime gateway child did not start: ${output}`)), 10_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`realtime gateway child exited (${code}) before listening: ${output}`));
    });
    child.on("message", (message: { type?: string; port?: number }) => {
      if (message?.type === "listening" && message.port) {
        clearTimeout(timer);
        resolve(message.port);
      }
    });
  });

  let requestId = 0;
  function request<T>(type: string, extra: Record<string, unknown> = {}): Promise<T & { now: number }> {
    const id = ++requestId;
    const reply = new Promise<T & { now: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.off("message", onMessage);
        reject(new Error(`gateway child did not answer ${type}`));
      }, 10_000);
      const onMessage = (message: { type?: string; id?: number } & T & { now: number }) => {
        if (message?.type === type && message.id === id) {
          clearTimeout(timer);
          child.off("message", onMessage);
          resolve(message);
        }
      };
      child.on("message", onMessage);
    });
    child.send({ type, id, ...extra });
    return reply;
  }

  function client(socket: GatewaySocket, cookie: string | null, expiresAt: number | null): RealtimeClient {
    sockets.push(socket);
    return {
      expiresAt,
      receivedCount: () => socket.eventCount(),
      events: () => socket.events(),
      send: (text) => socket.send(text),
      closed: (withinMs) => socket.closed(withinMs),
      closeCode: () => socket.closeCode,
      reconnect: async () => client(await GatewaySocket.open(port, cookie), cookie, expiresAt),
      disconnect: () => socket.close(),
    };
  }

  async function publishStatus(event: unknown) {
    const response = await fetch(`http://127.0.0.1:${port}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${internalSecret}` },
      body: JSON.stringify(event),
    });
    const body = await response.json().catch(() => null) as { delivered?: unknown } | null;
    return { status: response.status, delivered: typeof body?.delivered === "number" ? body.delivered : null };
  }

  return {
    async connect(actor, options) {
      let cookie: string | null = null;
      let expiresAt: number | null = null;
      if (actor !== "guest") {
        let issued = await issueSession(actor);
        // signSession has 1s resolution; never let two registrations share a token.
        while (registrations.has(issued.token)) {
          await sleep(1_050 - (Date.now() % 1_000));
          issued = await issueSession(actor);
        }
        const role = issued.user.role as AppRole;
        // Rounded up so a connection always starts with at least ttlSeconds left.
        expiresAt = Math.ceil(now() / 1000) + (options?.ttlSeconds ?? sessionMaxAgeSeconds(role));
        registrations.set(issued.token, { sub: issued.user.id, tokenVersion: issued.user.tokenVersion, expiresAt });
        cookie = issued.token;
      }
      return client(await GatewaySocket.open(port, cookie), cookie, expiresAt);
    },
    async advanceClock(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`advanceClock expects a non-negative number, got ${ms}`);
      offsetMs += ms;
      // The child moves its clock and runs (and awaits) every timer now due.
      const { now: childNow } = await request<object>("advance-clock", { ms });
      if (Math.abs(childNow - now()) > 1_000) throw new Error("gateway child clock diverged from the harness clock");
    },
    async publish(event) {
      const { status } = await publishStatus(event);
      if (status !== 202) throw new Error(`gateway /publish returned ${status}`);
    },
    now,
    publishStatus,
    setVerifierAvailable(available) {
      verifierAvailable = available;
    },
    verifierCalls: () => verifierCalls,
    async pendingTimers() {
      return (await request<{ pending: number }>("timers")).pending;
    },
    async shutdown() {
      return { pendingTimers: (await request<{ pending: number }>("shutdown")).pending };
    },
    async close() {
      for (const socket of sockets.splice(0)) socket.close();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await Promise.race([exited, sleep(5_000).then(() => child.kill("SIGKILL"))]);
      }
      await new Promise<void>((resolve) => verifier.close(() => resolve()));
    },
  };
}
