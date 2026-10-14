// TEST-ONLY bootstrap (never part of the realtime image or any production
// start command). Runs the real gateway factory from realtime/server.mjs with
// an injectable clock and timer scheduler that the parent test process drives
// over the Node IPC channel; there is no HTTP route that can change time.
import { createGateway } from "../../realtime/server.mjs";

if (typeof process.send !== "function") {
  console.error("realtime-gateway-child is a test-only bootstrap and must be forked with an IPC channel");
  process.exit(1);
}

let offsetMs = 0;
const now = () => Date.now() + offsetMs;

// Virtual-clock scheduler: a timer is due at now() + delay. It fires when real
// time gets there (backstop timer) or when the parent advances the clock past
// it, whichever comes first, exactly once. A callback's returned promise is
// awaited before the clock change is acknowledged, so asynchronous work a
// timer starts (live revalidation) has finished when advanceClock resolves.
const pending = new Map();
function fire(handle) {
  const entry = pending.get(handle);
  if (!entry) return undefined;
  pending.delete(handle);
  clearTimeout(entry.backstop);
  return entry.fn();
}
const timers = {
  setTimeout(fn, delay) {
    const ms = Math.max(0, Number(delay) || 0);
    const handle = {
      unref() {
        entry.backstop.unref();
        return handle;
      },
    };
    const entry = { dueAt: now() + ms, fn, backstop: setTimeout(() => fire(handle), ms) };
    pending.set(handle, entry);
    return handle;
  },
  clearTimeout(handle) {
    const entry = pending.get(handle);
    if (!entry) return;
    clearTimeout(entry.backstop);
    pending.delete(handle);
  },
};

async function runDueTimers() {
  for (let round = 0; round < 1_000; round += 1) {
    const due = [...pending.entries()]
      .filter(([, entry]) => entry.dueAt <= now())
      .sort(([, a], [, b]) => a.dueAt - b.dueAt)
      .map(([handle]) => handle);
    if (due.length === 0) return;
    await Promise.allSettled(due.map((handle) => Promise.resolve().then(() => fire(handle))));
  }
  throw new Error("timers kept re-arming at the current instant");
}

const gateway = createGateway({
  internalSecret: process.env.REALTIME_INTERNAL_SECRET ?? "",
  wsSessionUrl: process.env.REALTIME_WS_SESSION_URL ?? "",
  now,
  timers,
});

gateway.server.listen(0, "127.0.0.1", () => {
  process.send({ type: "listening", port: gateway.server.address().port });
});

process.on("message", async (message) => {
  if (message?.type === "advance-clock" && Number.isFinite(message.ms)) {
    offsetMs += message.ms;
    await runDueTimers();
    process.send({ type: "advance-clock", id: message.id, now: now() });
  } else if (message?.type === "timers") {
    process.send({ type: "timers", id: message.id, now: now(), pending: pending.size });
  } else if (message?.type === "shutdown") {
    await gateway.close();
    process.send({ type: "shutdown", id: message.id, now: now(), pending: pending.size });
  }
});

process.on("disconnect", () => {
  Promise.resolve(gateway.close()).finally(() => process.exit(0));
});
