// TEST-ONLY bootstrap (never part of the realtime image or any production
// start command). Runs the real gateway factory from realtime/server.mjs with
// an injectable clock that the parent test process advances over the Node IPC
// channel; there is no HTTP route that can change time.
import { createGateway } from "../../realtime/server.mjs";

if (typeof process.send !== "function") {
  console.error("realtime-gateway-child is a test-only bootstrap and must be forked with an IPC channel");
  process.exit(1);
}

let offsetMs = 0;
const now = () => Date.now() + offsetMs;
const gateway = createGateway({
  internalSecret: process.env.REALTIME_INTERNAL_SECRET ?? "",
  wsSessionUrl: process.env.REALTIME_WS_SESSION_URL ?? "",
  now,
});

gateway.server.listen(0, "127.0.0.1", () => {
  process.send({ type: "listening", port: gateway.server.address().port });
});

process.on("message", (message) => {
  if (message?.type === "advance-clock" && Number.isFinite(message.ms)) {
    offsetMs += message.ms;
    process.send({ type: "clock", id: message.id, now: now() });
  }
});

process.on("disconnect", () => {
  gateway.close().finally(() => process.exit(0));
});
