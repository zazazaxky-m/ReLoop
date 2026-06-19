import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.REALTIME_PORT || 3001);
const host = process.env.REALTIME_HOST || "0.0.0.0";
const internalSecret =
  process.env.REALTIME_INTERNAL_SECRET ||
  (process.env.NODE_ENV === "production" ? "" : "reloop-dev-realtime-secret");
const clients = new Set();

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
  const packet = frame(JSON.stringify({ type: "event", data }));
  for (const socket of clients) {
    if (!socket.destroyed && socket.writable) socket.write(packet);
  }
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
        broadcast(data);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ delivered: clients.size }));
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

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
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
  clients.add(socket);
  socket.write(frame(JSON.stringify({ type: "connected", clients: clients.size })));
  const remove = () => clients.delete(socket);
  socket.on("close", remove);
  socket.on("error", remove);
  socket.on("end", remove);
  socket.on("data", (buffer) => {
    if ((buffer[0] & 0x0f) === 0x08) socket.end();
  });
});

setInterval(() => {
  const packet = frame(JSON.stringify({ type: "ping", at: Date.now() }));
  for (const socket of clients) {
    if (!socket.destroyed && socket.writable) socket.write(packet);
  }
}, 25_000).unref();

server.listen(port, host, () => {
  console.log(`ReLoop realtime gateway listening on http://${host}:${port}`);
});
