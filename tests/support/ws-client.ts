import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { connect as connectTcp, type Socket } from "node:net";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type GatewayMessage = { type: string; data?: Record<string, unknown> } & Record<string, unknown>;

/**
 * Minimal RFC 6455 test client for realtime/server.mjs: reads the unmasked
 * text/close frames the gateway sends and can send masked client text frames.
 */
export class GatewaySocket {
  private buffer = Buffer.alloc(0);
  private upgraded = false;
  private lastDataAt = Date.now();
  private ended = false;
  readonly messages: GatewayMessage[] = [];
  /** Close code from the gateway's close frame (null until one arrives). */
  closeCode: number | null = null;

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", () => {});
    socket.on("close", () => { this.ended = true; });
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
      if (opcode === 0x8) this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
    }
  }

  /** Waits for the line to go quiet so in-flight frames are counted (bounded). */
  private async quiet() {
    const deadline = Date.now() + 1_000;
    await sleep(50);
    while (Date.now() - this.lastDataAt < 75 && Date.now() < deadline) await sleep(25);
  }

  async eventCount(): Promise<number> {
    return (await this.events()).length;
  }

  /** `data` of every `event` frame received so far. */
  async events(): Promise<Array<Record<string, unknown>>> {
    await this.quiet();
    return this.messages.filter((m) => m.type === "event").map((m) => m.data ?? {});
  }

  /** Sends one masked client text frame (what a browser would send). */
  async send(text: string) {
    const payload = Buffer.from(text);
    if (payload.length >= 65_536) throw new Error("test client only sends frames under 64 KiB");
    const header = payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    const mask = randomBytes(4);
    const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    this.socket.write(Buffer.concat([header, mask, masked]));
    await sleep(25);
  }

  /** True once the gateway closed the connection (waits up to `withinMs`). */
  async closed(withinMs = 1_000): Promise<boolean> {
    const deadline = Date.now() + withinMs;
    while (!this.ended && Date.now() < deadline) await sleep(20);
    return this.ended;
  }

  close() {
    this.socket.destroy();
  }
}
