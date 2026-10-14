import { createHash, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const SESSION_COOKIE = "reloop_session";
const ADMIN_ROLES = new Set(["ADMIN", "SUPERADMIN"]);
const APP_ROLES = new Set(["SUPERADMIN", "ADMIN", "PENGEPUL", "USER"]);

/** A privileged identity older than this is revalidated before it may receive a restricted topic. */
export const REVALIDATE_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const VERIFY_TIMEOUT_MS = 3_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Application close codes sent before the gateway drops a socket. */
export const CLOSE_SESSION_EXPIRED = 4401;
export const CLOSE_SESSION_REVOKED = 4403;

// Public topics fan out to every socket, including the anonymous kiosk
// display, so their payload is whitelisted to non-private machine state:
// no organization, owner, user, PII, money/refund or raw machine payload.
const PUBLIC_TOPICS = new Set(["machine-event", "machine-state"]);
const PUBLIC_FIELDS = ["topic", "machineCode", "eventType", "occurredAt"];
// Restricted topics reach only verified ADMIN (own organization) and
// SUPERADMIN sockets, and still carry nothing beyond these fields.
const RESTRICTED_TOPICS = new Set(["security-alert"]);
const RESTRICTED_FIELDS = ["topic", "organizationId", "machineCode", "eventType", "eventId", "occurredAt"];

const EVENT_TYPE = /^[A-Z][A-Z0-9_]{0,63}$/;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

function frame(text, opcode = 0x1) {
  const payload = Buffer.isBuffer(text) ? text : Buffer.from(text);
  const first = 0x80 | opcode;
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([first, payload.length]), payload]);
  }
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = first;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = first;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function closeFrame(code, reason) {
  const reasonBytes = Buffer.from(reason);
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return frame(payload, 0x8);
}

const boundedString = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max;

/**
 * Validates a /publish body and reduces it to the topic's whitelist. Unknown
 * topics and a restricted topic without an organization are rejected, never
 * delivered as a global or public event.
 */
export function parsePublishedEvent(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "invalid_event" };
  const restricted = RESTRICTED_TOPICS.has(data.topic);
  if (!restricted && !PUBLIC_TOPICS.has(data.topic)) return { error: "unknown_topic" };
  if (restricted && !boundedString(data.organizationId, 128)) return { error: "organization_required" };
  if (!boundedString(data.machineCode, 128)) return { error: "invalid_machine_code" };
  if (typeof data.eventType !== "string" || !EVENT_TYPE.test(data.eventType)) return { error: "invalid_event_type" };
  if (data.eventId !== undefined && !boundedString(data.eventId, 128)) return { error: "invalid_event_id" };
  if (
    data.occurredAt !== undefined &&
    !(boundedString(data.occurredAt, 64) && Number.isFinite(Date.parse(data.occurredAt)))
  ) {
    return { error: "invalid_occurred_at" };
  }
  const event = {};
  for (const field of restricted ? RESTRICTED_FIELDS : PUBLIC_FIELDS) {
    if (data[field] !== undefined) event[field] = data[field];
  }
  return { event, restricted };
}

/** Accepts only the full verifier identity; anything partial grants nothing. */
function parseIdentity(data) {
  if (!data || typeof data !== "object") return null;
  const { userId, role, organizationId, tokenVersion, expiresAt } = data;
  if (!boundedString(userId, 256) || !APP_ROLES.has(role)) return null;
  if (organizationId !== null && !boundedString(organizationId, 256)) return null;
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  return { userId, role, organizationId, tokenVersion, expiresAt };
}

/**
 * Builds the gateway without binding a port. `now` and `timers` are internal
 * dependencies (production passes Date.now and the global timers); there is
 * deliberately no HTTP endpoint that can change time.
 *
 * Socket metadata: anonymous sockets carry no identity and only ever receive
 * public topics. A socket whose session cookie the internal live verifier
 * accepted stores { userId, role, organizationId, tokenVersion, expiresAt,
 * lastValidatedAt }. It is closed at the exact expiry. ADMIN/SUPERADMIN
 * sockets keep the raw cookie in memory only (never logged, sent only to the
 * verifier), are revalidated every 30 s and again before a restricted
 * broadcast once stale; a `null` answer (revoked, suspended, tokenVersion
 * changed, expired) closes the socket, a role/organization change updates its
 * capability, and a verifier outage withholds restricted topics until the
 * identity validates again while public topics keep flowing.
 *
 * @typedef {{ setTimeout(fn: () => unknown, ms: number): any, clearTimeout(handle: any): void }} GatewayTimers
 * @param {{ internalSecret?: string, wsSessionUrl?: string, now?: () => number, timers?: GatewayTimers }} [options]
 */
export function createGateway({
  internalSecret = "",
  wsSessionUrl = "",
  now = Date.now,
  timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout },
} = {}) {
  const clients = new Map();
  /** Every upgraded or upgrading socket, so shutdown can drop them all. */
  const sockets = new Set();
  const shutdownController = new AbortController();
  let shuttingDown = false;
  let closing = null;

  const setTimer = (fn, ms) => timers.setTimeout(fn, Math.min(Math.max(0, ms), MAX_TIMER_DELAY_MS));
  const clearTimer = (handle) => {
    if (handle) timers.clearTimeout(handle);
  };

  /**
   * Asks the internal live verifier about a session cookie:
   * valid -> { status: "valid", identity }; definitive no -> "revoked";
   * not configured -> "absent"; outage/timeout/unusable answer -> "unavailable".
   */
  async function verify(token) {
    if (!wsSessionUrl || !internalSecret) return { status: "absent" };
    try {
      const res = await fetch(wsSessionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalSecret}`,
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.any([AbortSignal.timeout(VERIFY_TIMEOUT_MS), shutdownController.signal]),
      });
      if (!res.ok) return { status: "unavailable" };
      const data = await res.json();
      // `null` is the verifier's definitive "not a current session"; the
      // pre-R04 `{ role: null }` answer means the same.
      if (data === null || (typeof data === "object" && data.role === null)) return { status: "revoked" };
      const identity = parseIdentity(data);
      if (!identity) return { status: "unavailable" };
      if (identity.expiresAt * 1000 <= now()) return { status: "revoked" };
      return { status: "valid", identity };
    } catch {
      return { status: "unavailable" };
    }
  }

  function clearSocketTimers(meta) {
    clearTimer(meta.expiryTimer);
    clearTimer(meta.revalidateTimer);
    meta.expiryTimer = null;
    meta.revalidateTimer = null;
  }

  function forget(socket) {
    const meta = clients.get(socket);
    if (meta) {
      meta.closed = true;
      meta.token = null;
      clearSocketTimers(meta);
      clients.delete(socket);
    }
    sockets.delete(socket);
  }

  function closeSocket(socket, code, reason) {
    forget(socket);
    if (socket.destroyed) return;
    // Tracked until the peer is gone ('close'); shutdown destroys leftovers.
    sockets.add(socket);
    socket.end(closeFrame(code, reason));
  }

  function scheduleExpiry(socket, meta) {
    clearTimer(meta.expiryTimer);
    meta.expiryTimer = null;
    if (shuttingDown || meta.closed || meta.expiresAt === null) return;
    const fire = () => {
      meta.expiryTimer = null;
      if (meta.closed) return;
      if (now() < meta.expiresAt * 1000) {
        // A timer may fire a little early; re-arm for the remainder.
        meta.expiryTimer = setTimer(fire, meta.expiresAt * 1000 - now());
        return;
      }
      closeSocket(socket, CLOSE_SESSION_EXPIRED, "Sesi berakhir");
    };
    meta.expiryTimer = setTimer(fire, meta.expiresAt * 1000 - now());
  }

  function scheduleRevalidation(socket, meta) {
    clearTimer(meta.revalidateTimer);
    meta.revalidateTimer = null;
    if (shuttingDown || meta.closed || !meta.token) return;
    meta.revalidateTimer = setTimer(() => {
      meta.revalidateTimer = null;
      return revalidate(socket, meta);
    }, REVALIDATE_INTERVAL_MS);
  }

  function applyIdentity(socket, meta, identity) {
    if (meta.userId !== null && meta.userId !== identity.userId) {
      closeSocket(socket, CLOSE_SESSION_REVOKED, "Sesi tidak berlaku");
      return;
    }
    meta.userId = identity.userId;
    meta.role = identity.role;
    meta.organizationId = identity.organizationId;
    meta.tokenVersion = identity.tokenVersion;
    meta.expiresAt = identity.expiresAt;
    meta.lastValidatedAt = now();
    meta.verified = true;
    // Only privileged sockets can ever receive a restricted topic, so only
    // they keep the cookie for revalidation; everyone is closed at expiry.
    if (!ADMIN_ROLES.has(identity.role)) meta.token = null;
    scheduleExpiry(socket, meta);
    scheduleRevalidation(socket, meta);
  }

  function revalidate(socket, meta) {
    if (meta.closed || shuttingDown || !meta.token) return Promise.resolve();
    if (meta.inflight) return meta.inflight;
    meta.inflight = (async () => {
      const result = await verify(meta.token);
      if (meta.closed || shuttingDown) return;
      if (result.status === "valid") {
        applyIdentity(socket, meta, result.identity);
      } else if (result.status === "revoked") {
        closeSocket(socket, CLOSE_SESSION_REVOKED, "Sesi tidak berlaku");
      } else {
        // Transient: withhold restricted topics, keep the socket, retry.
        meta.verified = false;
        scheduleRevalidation(socket, meta);
      }
    })().finally(() => {
      meta.inflight = null;
    });
    return meta.inflight;
  }

  const isStale = (meta) => now() - meta.lastValidatedAt >= REVALIDATE_INTERVAL_MS;

  function mayReceiveRestricted(meta, event) {
    if (meta.closed || !meta.verified || meta.userId === null) return false;
    if (!ADMIN_ROLES.has(meta.role)) return false;
    if (now() >= meta.expiresAt * 1000 || isStale(meta)) return false;
    return meta.role === "SUPERADMIN" || meta.organizationId === event.organizationId;
  }

  function write(socket, packet) {
    if (socket.destroyed || !socket.writable) return false;
    socket.write(packet);
    return true;
  }

  async function broadcast(event, restricted) {
    const packet = frame(JSON.stringify({ type: "event", data: event }));
    let delivered = 0;
    if (!restricted) {
      for (const socket of clients.keys()) if (write(socket, packet)) delivered += 1;
      return delivered;
    }
    // Never deliver a restricted topic on an identity older than the
    // revalidation interval: refresh stale ones first (deduplicated).
    const refresh = [];
    for (const [socket, meta] of clients) {
      if (meta.token && (!meta.verified || isStale(meta))) refresh.push(revalidate(socket, meta));
    }
    await Promise.allSettled(refresh);
    for (const [socket, meta] of clients) {
      if (mayReceiveRestricted(meta, event) && write(socket, packet)) delivered += 1;
    }
    return delivered;
  }

  function authorized(req) {
    if (!internalSecret) return false;
    const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const expected = Buffer.from(internalSecret);
    const actual = Buffer.from(supplied);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, clients: clients.size }));
      return;
    }

    if (req.method === "POST" && req.url === "/publish") {
      if (!authorized(req)) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 32_768) req.destroy();
      });
      req.on("end", async () => {
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          res.writeHead(400);
          res.end("Bad JSON");
          return;
        }
        const parsed = parsePublishedEvent(data);
        if (parsed.error) {
          // Code and topic only: never the payload.
          console.warn(`[realtime] publish rejected (${parsed.error}) topic=${String(data?.topic).slice(0, 32)}`);
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: parsed.error }));
          return;
        }
        try {
          const delivered = await broadcast(parsed.event, parsed.restricted);
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ delivered }));
        } catch {
          res.writeHead(500);
          res.end("Publish failed");
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  async function handleUpgrade(req, socket) {
    const { pathname } = new URL(req.url, "http://internal");
    if (pathname !== "/ws" || shuttingDown) {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on("close", () => forget(socket));
    socket.on("error", () => {
      forget(socket);
      socket.destroy();
    });
    socket.on("end", () => {
      // http.Server sockets allow half-open; finish our side too.
      forget(socket);
      socket.end();
    });

    // Fresh metadata for every socket: nothing is inherited from an earlier
    // connection, and client frames can never change it.
    const meta = {
      token: null,
      userId: null,
      role: null,
      organizationId: null,
      tokenVersion: null,
      expiresAt: null,
      lastValidatedAt: 0,
      verified: false,
      expiryTimer: null,
      revalidateTimer: null,
      inflight: null,
      closed: false,
    };
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const result = token ? await verify(token) : { status: "absent" };
    if (shuttingDown || socket.destroyed || !sockets.has(socket)) {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"),
    );
    clients.set(socket, meta);
    if (result.status === "valid") {
      meta.token = token;
      applyIdentity(socket, meta, result.identity);
    } else if (result.status === "unavailable") {
      // No private role now; retry with the same cookie on the normal cadence.
      meta.token = token;
      scheduleRevalidation(socket, meta);
    }
    if (meta.closed) return;
    socket.write(frame(JSON.stringify({ type: "connected", clients: clients.size })));
    socket.on("data", (buffer) => {
      // Client frames are ignored (they never authenticate or promote a
      // socket); only a close frame is honoured.
      if ((buffer[0] & 0x0f) === 0x08) socket.end();
    });
  }

  server.on("upgrade", (req, socket) => {
    handleUpgrade(req, socket).catch(() => {
      forget(socket);
      if (!socket.destroyed) socket.destroy();
    });
  });

  let heartbeat = null;
  function scheduleHeartbeat() {
    if (shuttingDown) return;
    heartbeat = setTimer(() => {
      const packet = frame(JSON.stringify({ type: "ping", at: now() }));
      for (const socket of clients.keys()) write(socket, packet);
      scheduleHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat?.unref?.();
  }
  scheduleHeartbeat();

  return {
    server,
    /** Clears every timer, forgets every cookie, drops every socket. Idempotent. */
    close() {
      if (closing) return closing;
      shuttingDown = true;
      shutdownController.abort();
      clearTimer(heartbeat);
      heartbeat = null;
      for (const socket of [...clients.keys(), ...sockets]) {
        forget(socket);
        socket.destroy();
      }
      clients.clear();
      sockets.clear();
      closing = new Promise((resolve) => server.close(() => resolve()));
      return closing;
    },
  };
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  const port = Number(process.env.REALTIME_PORT || 3001);
  const host = process.env.REALTIME_HOST || "0.0.0.0";
  const internalSecret =
    process.env.REALTIME_INTERNAL_SECRET ||
    (process.env.NODE_ENV === "production" ? "" : "reloop-dev-realtime-secret");
  if (!internalSecret && process.env.NODE_ENV === "production") {
    console.error(
      "[realtime] REALTIME_INTERNAL_SECRET is not set in production. Aborting startup.",
    );
    process.exit(1);
  }
  const gateway = createGateway({
    internalSecret,
    wsSessionUrl: process.env.REALTIME_WS_SESSION_URL?.trim() || "",
    now: Date.now,
  });
  gateway.server.listen(port, host, () => {
    console.log(`ReLoop realtime gateway listening on http://${host}:${port}`);
  });
}
