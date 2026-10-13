import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getWalletBalance } from "@/lib/ledger";
import { signMachinePayload } from "@/lib/machine-auth";
import { f } from "../support/audit-fixture";
import { machineEventsResponseV2 } from "../support/contracts";

/** R02 / LOG-06: per-event ACK against the real Next server and PostgreSQL. */

const REPO_ROOT = path.resolve(__dirname, "../..");

type EdgeEvent = {
  localEventId: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  sessionId: string | null;
  depositItemId: string | null;
  occurredAt: string;
};

async function ingestSecret(): Promise<string> {
  const machine = await f.db.machine.findUniqueOrThrow({ where: { id: f.ids.machineA } });
  if (!machine.ingestSecret) throw new Error("fixture machine has no ingest secret");
  return machine.ingestSecret;
}

/** Signs and sends a batch exactly like rvm/sync.py does. */
async function postBatch(events: EdgeEvent[]) {
  const raw = JSON.stringify({ machineCode: f.ids.machineCode, events });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replaceAll("-", "");
  const response = await fetch(new URL("/api/machine-events", process.env.AUDIT_BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-reloop-machine": f.ids.machineCode,
      "x-reloop-timestamp": timestamp,
      "x-reloop-nonce": nonce,
      "x-reloop-signature": signMachinePayload(await ingestSecret(), timestamp, nonce, raw),
    },
    body: raw,
  });
  return { status: response.status, body: await response.json() };
}

/** One bottle deposited in an ACTIVE session: detected, weighed, accepted (paid). */
async function depositFlow() {
  const session = await f.db.depositSession.create({
    data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" },
  });
  const link = await f.db.machineWasteType.findFirstOrThrow({ where: { machineId: f.ids.machineA, active: true } });
  const event = (eventType: string, payload: Record<string, unknown>, second: number): EdgeEvent => ({
    localEventId: randomUUID(),
    eventType,
    payload,
    sessionId: session.id,
    depositItemId: null,
    occurredAt: new Date(Date.UTC(2026, 9, 13, 8, 0, second)).toISOString(),
  });
  return {
    session,
    events: [
      event("ITEM_DETECTED", { wasteTypeId: link.wasteTypeId, quantity: 1 }, 1),
      event("WEIGHT_MEASURED", { weightGrams: 25 }, 2),
      event("ITEM_ACCEPTED_POINT", {}, 3),
    ],
  };
}

const earnings = (sessionId: string) =>
  f.db.rewardLedger.findMany({ where: { sessionId, entryType: "EARN" } });

async function warmRoute() {
  // The first request compiles the route in `next dev`; keep that out of the
  // worker's 5 s request timeout.
  expect((await postBatch([])).status).toBe(200);
}

describe("POST /api/machine-events protocol v2 (real PostgreSQL)", () => {
  it("reports accepted only after the event and its reward commit; a retry after a lost response is a duplicate without a second reward", async () => {
    await warmRoute();
    const { session, events } = await depositFlow();
    const before = (await getWalletBalance(f.ids.userA)).available;

    const first = await postBatch(events);
    expect(first.status).toBe(200);
    const accepted = machineEventsResponseV2.parse(first.body);
    expect(accepted.results.map((r) => [r.localEventId, r.status])).toEqual(events.map((e) => [e.localEventId, "accepted"]));

    // "accepted" was only sent after commit: an independent connection sees
    // every event and the reward the moment the response arrives.
    const observer = await f.connection();
    expect(await observer.machineEvent.count({
      where: { machineId: f.ids.machineA, localEventId: { in: events.map((e) => e.localEventId) } },
    })).toBe(3);
    const credited = await observer.rewardLedger.findMany({ where: { sessionId: session.id, entryType: "EARN" } });
    expect(credited).toHaveLength(1);
    expect(credited[0]).toMatchObject({ userId: f.ids.userA, status: "AVAILABLE" });
    expect(credited[0].amount).toBeGreaterThan(0);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(before + credited[0].amount);

    // The machine never saw that response and resends the same localEventIds.
    const retry = await postBatch(events);
    expect(retry.status).toBe(200);
    expect(machineEventsResponseV2.parse(retry.body).results)
      .toEqual(accepted.results.map((r) => ({ ...r, status: "duplicate" })));
    expect(await earnings(session.id)).toHaveLength(1);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(before + credited[0].amount);
    expect(await f.db.depositItem.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it("answers concurrent deliveries of the same events with one accepted each and duplicates otherwise, crediting once", async () => {
    await warmRoute();
    const { session, events } = await depositFlow();

    const responses = await Promise.all(Array.from({ length: 6 }, () => postBatch(events)));
    const bodies = responses.map((r) => {
      expect(r.status).toBe(200);
      return machineEventsResponseV2.parse(r.body);
    });
    for (const [index, sent] of events.entries()) {
      const results = bodies.map((body) => body.results[index]);
      for (const result of results) expect(result.localEventId).toBe(sent.localEventId);
      // A unique-insert collision is re-read and answered as duplicate, never
      // as an error the machine would have to retry or dead-letter.
      expect(results.map((r) => r.status).sort()).toEqual(["accepted", "duplicate", "duplicate", "duplicate", "duplicate", "duplicate"]);
      expect(new Set(results.map((r) => ("eventId" in r ? r.eventId : null))).size).toBe(1);
    }
    expect(await f.db.machineEvent.count({ where: { localEventId: { in: events.map((e) => e.localEventId) } } })).toBe(3);
    expect(await f.db.depositItem.count({ where: { sessionId: session.id } })).toBe(1);
    expect(await earnings(session.id)).toHaveLength(1);
  });

  it("keeps a valid batch at HTTP 200 and rejects only the invalid event, permanently", async () => {
    await warmRoute();
    const heartbeat: EdgeEvent = {
      localEventId: randomUUID(), eventType: "HEARTBEAT", payload: { status: "ONLINE", fillLevelPercent: 10 },
      sessionId: null, depositItemId: null, occurredAt: new Date().toISOString(),
    };
    const unknown: EdgeEvent = { ...heartbeat, localEventId: randomUUID(), eventType: "NOT_A_MACHINE_EVENT" };
    const res = await postBatch([unknown, heartbeat]);
    expect(res.status).toBe(200);
    expect(machineEventsResponseV2.parse(res.body).results).toEqual([
      { localEventId: unknown.localEventId, status: "error", error: "INVALID_EVENT", retryable: false },
      { localEventId: heartbeat.localEventId, status: "accepted", eventId: expect.any(String) },
    ]);
    expect(await f.db.machineEvent.count({ where: { localEventId: unknown.localEventId } })).toBe(0);
  });

  it("drives the real RVM worker: a response lost after commit stays pending, the retry is ACKed as duplicate and pays once", async () => {
    await warmRoute();
    const { session, events } = await depositFlow();
    const workdir = mkdtempSync(path.join(tmpdir(), "reloop-r02-"));
    try {
      const run = spawnSync(process.env.RVM_PYTHON ?? "python3", ["-c", WORKER_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 90_000,
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH ?? "",
          PYTHONDONTWRITEBYTECODE: "1",
          R02_BASE_URL: process.env.AUDIT_BASE_URL ?? "",
          R02_MACHINE: f.ids.machineCode,
          R02_SECRET: await ingestSecret(),
          R02_DB: path.join(workdir, "edge.db"),
          R02_EVENTS: JSON.stringify(events),
        },
      });
      expect(run.status, run.stderr).toBe(0);
      const report = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}");
      const ids = events.map((e) => e.localEventId);
      expect(report).toEqual({
        first: { flushed: false, queueDepth: 3, attempts: [1, 1, 1], serverStatuses: ["accepted", "accepted", "accepted"] },
        second: { flushed: true, queueDepth: 0, deadLetterDepth: 0, serverStatuses: ["duplicate", "duplicate", "duplicate"] },
        sent: [ids, ids],
      });
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
    expect(await earnings(session.id)).toHaveLength(1);
    expect(await f.db.machineEvent.count({ where: { localEventId: { in: events.map((e) => e.localEventId) } } })).toBe(3);
  });
});

/** Real SyncWorker + EdgeDatabase against the real Next server. The first
 * response is read (so the server has committed) and then dropped. */
const WORKER_SCRIPT = String.raw`
import json, os, urllib.request
from rvm.config import RvmConfig
from rvm.database import EdgeDatabase
from rvm.sync import SyncWorker

events = json.loads(os.environ["R02_EVENTS"])
db = EdgeDatabase(os.environ["R02_DB"])
for e in events:
    db.enqueue(e["eventType"], e["payload"], e["occurredAt"], e["sessionId"], e["depositItemId"], e["localEventId"])
worker = SyncWorker(RvmConfig(machine_code=os.environ["R02_MACHINE"], machine_secret=os.environ["R02_SECRET"],
                              server_url=os.environ["R02_BASE_URL"]), db)
real_urlopen = urllib.request.urlopen
sent, seen = [], []

class Replay:
    def __init__(self, status, body):
        self.status, self._body = status, body
    def read(self):
        return self._body
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False

def lose_response(request, timeout=None):
    sent.append([e["localEventId"] for e in json.loads(request.data)["events"]])
    with real_urlopen(request, timeout=timeout) as response:
        seen.append(json.loads(response.read()))
    raise TimeoutError("response lost after commit")

def record(request, timeout=None):
    sent.append([e["localEventId"] for e in json.loads(request.data)["events"]])
    with real_urlopen(request, timeout=timeout) as response:
        body = response.read()
        status = response.status
    seen.append(json.loads(body))
    return Replay(status, body)

statuses = lambda i: [r["status"] for r in seen[i]["results"]]
urllib.request.urlopen = lose_response
first = worker.flush_once()
first_state = {"flushed": first, "queueDepth": db.queue_depth(),
               "attempts": [r["attempts"] for r in db._conn.execute("SELECT attempts FROM outbox ORDER BY id")],
               "serverStatuses": statuses(0)}
with db._conn:
    db._conn.execute("UPDATE outbox SET next_attempt_at=0")
urllib.request.urlopen = record
second = worker.flush_once()
print(json.dumps({"first": first_state,
                  "second": {"flushed": second, "queueDepth": db.queue_depth(),
                             "deadLetterDepth": db.dead_letter_depth(), "serverStatuses": statuses(1)},
                  "sent": sent}))
db.close()
`;
