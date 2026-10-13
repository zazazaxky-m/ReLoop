import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect as connectTcp, type Socket } from "node:net";
import path from "node:path";
import { sessionMaxAgeSeconds } from "@/lib/auth";
import type { AppRole } from "@/lib/roles";
import type { ActorKey, FixtureActor } from "./fixture-core";

export interface RealtimeHarness {
  connect(actor:ActorKey,options?:{ttlSeconds:number}):Promise<{receivedCount():Promise<number>}>;
  advanceClock(ms:number):Promise<void>;
  publish(event:{topic:"security-alert";organizationId:string;machineCode:string;eventType:string}):Promise<void>;
  close():Promise<void>;
}

/** Shape the fake live verifier returns; superset of today's `{ role }` (R04 extends the real one). */
interface VerifiedIdentity {
  userId: string;
  role: AppRole;
  organizationId: string | null;
  tokenVersion: number;
  expiresAt: number;
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

/** Minimal RFC 6455 client: the gateway only sends unmasked text/close frames. */
class GatewaySocket {
  private buffer = Buffer.alloc(0);
  private upgraded = false;
  private lastDataAt = Date.now();
  readonly messages: Array<{ type: string }> = [];

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", () => {});
  }

  static async open(port: number, cookie: string | null): Promise<GatewaySocket> {
    const socket = connectTcp(port, "127.0.0.1");
    await once(socket, "connect");
    const client = new GatewaySocket(socket);
    socket.write([
      "GET /ws HTTP/1.1", `Host: 127.0.0.1:${port}`, "Upgrade: websocket", "Connection: Upgrade",
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`, "Sec-WebSocket-Version: 13",
      ...(cookie ? [`Cookie: reloop_session=${cookie}`] : []), "", "",
    ].join("\r\n"));
    const deadline = Date.now() + 5_000;
    while (!client.messages.some((m) => m.type === "connected")) {
      if (Date.now() > deadline || socket.destroyed) throw new Error("realtime gateway did not complete the WebSocket handshake");
      await sleep(10);
    }
    return client;
  }

  private onData(chunk: Buffer) {
    this.lastDataAt = Date.now();
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.upgraded) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      if (!this.buffer.subarray(0, end).toString().startsWith("HTTP/1.1 101")) {
        this.socket.destroy();
        return;
      }
      this.upgraded = true;
      this.buffer = this.buffer.subarray(end + 4);
    }
    while (this.buffer.length >= 2) {
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      const opcode = this.buffer[0] & 0x0f;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x1) this.messages.push(JSON.parse(payload.toString("utf8")));
    }
  }

  /** Waits for the line to go quiet so in-flight frames are counted (bounded). */
  async eventCount(): Promise<number> {
    const deadline = Date.now() + 1_000;
    await sleep(50);
    while (Date.now() - this.lastDataAt < 75 && Date.now() < deadline) await sleep(25);
    return this.messages.filter((m) => m.type === "event").length;
  }

  close() {
    this.socket.destroy();
  }
}

/**
 * Starts an isolated gateway child (real realtime/server.mjs factory, test
 * clock over IPC) and a fake internal live verifier that validates the
 * internal bearer secret and maps fixture session cookies to identities.
 */
export async function startRealtimeHarness({ internalSecret, issueSession }: HarnessOptions): Promise<RealtimeHarness> {
  if (!internalSecret) throw new Error("REALTIME_INTERNAL_SECRET missing; run through scripts/run-audit-tests.mjs");
  let offsetMs = 0;
  const now = () => Date.now() + offsetMs;
  const identities = new Map<string, VerifiedIdentity>();
  const sockets: GatewaySocket[] = [];

  const verifier: Server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.method !== "POST" || req.headers.authorization !== `Bearer ${internalSecret}`) {
      res.writeHead(401).end();
      return;
    }
    let identity: VerifiedIdentity | undefined;
    try {
      identity = identities.get(String(JSON.parse(raw).token ?? ""));
    } catch {
      identity = undefined;
    }
    const valid = identity && identity.expiresAt * 1000 > now();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(valid ? identity : { role: null }));
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

  let clockRequest = 0;
  return {
    async connect(actor, options) {
      let cookie: string | null = null;
      if (actor !== "guest") {
        let issued = await issueSession(actor);
        // signSession has 1s resolution; never let two registrations share a token.
        while (identities.has(issued.token)) {
          await sleep(1_050 - (Date.now() % 1_000));
          issued = await issueSession(actor);
        }
        const role = issued.user.role as AppRole;
        identities.set(issued.token, {
          userId: issued.user.id,
          role,
          organizationId: issued.user.organizationId,
          tokenVersion: issued.user.tokenVersion,
          expiresAt: Math.floor(now() / 1000) + (options?.ttlSeconds ?? sessionMaxAgeSeconds(role)),
        });
        cookie = issued.token;
      }
      const socket = await GatewaySocket.open(port, cookie);
      sockets.push(socket);
      return { receivedCount: () => socket.eventCount() };
    },
    async advanceClock(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`advanceClock expects a non-negative number, got ${ms}`);
      const id = ++clockRequest;
      const ack = new Promise<{ now: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("gateway child did not acknowledge the clock change")), 5_000);
        const onMessage = (message: { type?: string; id?: number; now?: number }) => {
          if (message?.type === "clock" && message.id === id) {
            clearTimeout(timer);
            child.off("message", onMessage);
            resolve({ now: message.now ?? 0 });
          }
        };
        child.on("message", onMessage);
      });
      offsetMs += ms;
      child.send({ type: "advance-clock", ms, id });
      const { now: childNow } = await ack;
      if (Math.abs(childNow - now()) > 1_000) throw new Error("gateway child clock diverged from the harness clock");
    },
    async publish(event) {
      const response = await fetch(`http://127.0.0.1:${port}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${internalSecret}` },
        body: JSON.stringify(event),
      });
      if (response.status !== 202) throw new Error(`gateway /publish returned ${response.status}`);
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
