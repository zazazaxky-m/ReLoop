import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { SignJWT } from "jose";
import { signSession, verifySessionToken } from "@/lib/auth";
import { signMfaChallenge } from "@/lib/mfa";

const children: ChildProcess[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(children.splice(0).map(async child => { child.kill(); await once(child, "exit"); }));
});
async function gateway(verifier = "") {
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ["realtime/server.mjs"], { env: { ...process.env,
    NODE_ENV: "test", REALTIME_PORT: String(port), REALTIME_HOST: "127.0.0.1",
    REALTIME_INTERNAL_SECRET: "test-internal", REALTIME_WS_SESSION_URL: verifier,
  }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child); await once(child.stdout!, "data");
  return port;
}
async function openSocket(port: number, token: string) {
  const socket = connect(port, "127.0.0.1"); sockets.push(socket); await once(socket, "connect");
  const ready = once(socket, "data");
  socket.write(`GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: reloop_session=${token}\r\n\r\n`);
  const [data] = await ready; expect(data.toString()).toContain("101 Switching Protocols");
}
async function publish(port: number, topic: string) {
  const response = await fetch(`http://127.0.0.1:${port}/publish`, { method: "POST",
    headers: { authorization: "Bearer test-internal" }, body: JSON.stringify({ topic }) });
  return (await response.json()).delivered;
}
const admin = { sub: "admin-1", email: "admin@example.com", name: "Admin", role: "ADMIN" as const, organizationId: null, tokenVersion: 0 };

describe("realtime token boundary", () => {
  it.each(["", "http://127.0.0.1:1/unavailable"])("keeps public topics but denies private role when live verifier is absent/unavailable (%s)", async url => {
    const port = await gateway(url);
    await openSocket(port, await signSession(admin));
    expect(await publish(port, "machine-state")).toBe(1);
    expect(await publish(port, "security-alert")).toBe(0);
  });
  it("uses live verification and denies MFA/legacy cookies while admitting a current session", async () => {
    const verifier = createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const payload = await verifySessionToken(JSON.parse(raw).token);
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ role: payload?.role ?? null }));
    });
    verifier.listen(0, "127.0.0.1"); await once(verifier, "listening");
    try {
      const port = await gateway(`http://127.0.0.1:${(verifier.address() as { port: number }).port}`);
      const legacy = await new SignJWT(admin).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h")
        .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET || "dev-insecure-secret-change-me"));
      await openSocket(port, legacy);
      await openSocket(port, await signMfaChallenge("admin-1", 0));
      expect(await publish(port, "security-alert")).toBe(0);
      await openSocket(port, await signSession(admin));
      expect(await publish(port, "security-alert")).toBe(1);
      expect(await publish(port, "machine-state")).toBe(3);
    } finally { await new Promise<void>(resolve => verifier.close(() => resolve())); }
  });
});
