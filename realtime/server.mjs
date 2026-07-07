import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

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
const SESSION_COOKIE = "reloop_session";
const wsSessionUrl = process.env.REALTIME_WS_SESSION_URL?.trim() || "";
const ADMIN_ROLES = new Set(["ADMIN", "SUPERADMIN"]);
// socket -> { role: string|null }. The public machine kiosk display connects
// anonymously (role null) and only needs non-sensitive refresh signals;
// dashboard clients carry the same session cookie as the Next.js app and can
// receive everything, including security-alert topics.
const clients = new Map();

function jwtSecretBytes() {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret === "dev-insecure-secret-change-me") {
    if (process.env.NODE_ENV === "production") return null;
    return new TextEncoder().encode("dev-insecure-secret-change-me");
  }
  return new TextEncoder().encode(secret);
}

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

/**
 * Minimal dependency-free HS256 JWT verification (this gateway intentionally
 * ships without node_modules, see Dockerfile.realtime). Mirrors the token
 * shape produced by lib/auth.ts's `signSession` (jose SignJWT, alg HS256).
 */
function verifyHs256Jwt(token, secretBytes) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const expectedSig = createHmac("sha256", secretBytes)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  let actualSig;
  try {
    actualSig = Buffer.from(signatureB64, "base64url");
  } catch {
    return null;
  }
  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && Date.now() / 1000 >= payload.exp) {
    return null;
  }
  return payload;
}

function resolveSocketRoleFromJwt(req) {
  const secretBytes = jwtSecretBytes();
  if (!secretBytes) return null;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const payload = verifyHs256Jwt(token, secretBytes);
  if (!payload) return null;
  return typeof payload.role === "string" ? payload.role : null;
}

/** Resolves socket role from live DB when configured; JWT-only fallback in dev. */
async function resolveSocketRole(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  if (wsSessionUrl && internalSecret) {
    try {
      const res = await fetch(wsSessionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalSecret}`,
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.role === "string" ? data.role : null;
    } catch {
      return null;
    }
  }

  return resolveSocketRoleFromJwt(req);
}

function frame(text) {
  const payload = Buffer.from(text);
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function broadcast(data) {
  // security-alert carries fraud/vandalism detail and must stay admin-only;
  // machine-event/machine-state are already visible on the public kiosk
  // screen itself, so they're safe to fan out to anonymous listeners too.
  const restricted = data && data.topic === "security-alert";
  const packet = frame(JSON.stringify({ type: "event", data }));
  let delivered = 0;
  for (const [socket, meta] of clients) {
    if (restricted && !ADMIN_ROLES.has(meta.role)) continue;
    if (!socket.destroyed && socket.writable) {
      socket.write(packet);
      delivered += 1;
    }
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
    req.on("end", () => {
      try {
        const data = JSON.parse(raw);
        const delivered = broadcast(data);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ delivered }));
      } catch {
        res.writeHead(400);
        res.end("Bad JSON");
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

async function handleUpgrade(req, socket) {
  const { pathname } = new URL(req.url, "http://internal");
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const role = await resolveSocketRole(req);
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
  clients.set(socket, { role });
  socket.write(frame(JSON.stringify({ type: "connected", clients: clients.size })));
  const remove = () => clients.delete(socket);
  socket.on("close", remove);
  socket.on("error", remove);
  socket.on("end", remove);
  socket.on("data", (buffer) => {
    if ((buffer[0] & 0x0f) === 0x08) socket.end();
  });
}

server.on("upgrade", (req, socket) => {
  handleUpgrade(req, socket).catch(() => {
    if (!socket.destroyed) socket.destroy();
  });
});

setInterval(() => {
  const packet = frame(JSON.stringify({ type: "ping", at: Date.now() }));
  for (const socket of clients.keys()) {
    if (!socket.destroyed && socket.writable) socket.write(packet);
  }
}, 25_000).unref();

server.listen(port, host, () => {
  console.log(`ReLoop realtime gateway listening on http://${host}:${port}`);
});
