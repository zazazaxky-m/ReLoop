import tempfile, unittest
from pathlib import Path
from rvm.config import RvmConfig
from rvm.database import EdgeDatabase
from rvm.sync import SyncWorker

class SyncContractTest(unittest.TestCase):
    def test_http_200_error_does_not_ack_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = EdgeDatabase(str(Path(tmp)/"edge.db"))
            try:
                db.enqueue("HEARTBEAT", {"status":"ONLINE"}, "2026-10-13T00:00:00Z")
                row = db.pending(1)[0]
                worker = SyncWorker(RvmConfig(machine_secret="test-secret"),db)
                payload = {"protocolVersion":2,"received":1,"results":[{
                    "localEventId":row["localEventId"],"status":"error",
                    "error":"TEMPORARY_FAILURE","retryable":True}]}
                worker.apply_event_results([row],payload)
                self.assertEqual(db.queue_depth(),1)
            finally:
                db.close()


# --------------------------------------------------------------------------- #
# R02 / LOG-06: per-event ACK, durable retry, dead-letter and outbox upgrade.
# --------------------------------------------------------------------------- #
import glob  # noqa: E402
import http.client  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import sqlite3  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
import urllib.error  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402
from unittest import mock  # noqa: E402

from rvm import database as database_module  # noqa: E402
from rvm.api import LocalApiServer  # noqa: E402
from rvm.controller import RvmController  # noqa: E402

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "contracts" / "machine-events.v2.json"
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
EVENTS = {event["localEventId"]: event for event in FIXTURE["request"]["events"]}
E1, E2, E3, E4 = list(EVENTS)

# Outbox DDL exactly as shipped before R02 (protocol v1 worker).
LEGACY_SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  session_id TEXT,
  deposit_item_id TEXT,
  occurred_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at REAL NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at REAL
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx
ON outbox(sent_at, next_attempt_at, id);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at REAL NOT NULL
);
"""

HISTORICAL_COLUMNS = (
    "local_event_id", "event_type", "payload_json", "session_id",
    "deposit_item_id", "occurred_at",
)


class Resp:
    def __init__(self, status, data=b""):
        self.status = status
        self._data = data

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


def v2(*results):
    return {"protocolVersion": 2, "received": len(results), "results": list(results)}


def ok(local_id, status="accepted"):
    return {"localEventId": local_id, "status": status, "eventId": f"srv-{local_id[-4:]}"}


def failed(local_id, code="TEMPORARY_FAILURE", retryable=True):
    item = {"localEventId": local_id, "status": "error", "error": code}
    if retryable is not None:
        item["retryable"] = retryable
    return item


def http_error(status):
    return urllib.error.HTTPError(
        "http://server/api/machine-events", status, "rejected", {}, io.BytesIO(b"{}")
    )


class FakeEventsServer:
    """urlopen double for POST /api/machine-events. `responder(body)` returns a
    Resp, raises, or returns a dict that is served as an HTTP 200 JSON body."""

    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    def __call__(self, request, timeout=None):
        body = json.loads(request.data)
        self.calls.append({"url": request.full_url, "timeout": timeout, "body": body})
        result = self.responder(body)
        if isinstance(result, Resp):
            return result
        if isinstance(result, bytes):
            return Resp(200, result)
        return Resp(200, json.dumps(result).encode())

    def sent_ids(self, call=-1):
        return [event["localEventId"] for event in self.calls[call]["body"]["events"]]


class CommittingServer:
    """Backend double with the v2 contract: commits each new localEventId once
    (one reward per ITEM_ACCEPTED_POINT) and answers retries as duplicate. With
    `lose_next_response` the commit happens but the response never arrives."""

    def __init__(self):
        self.committed: dict[str, str] = {}
        self.rewards = 0
        self.lose_next_response = False
        self.responses: list[dict] = []

    def __call__(self, body):
        results = []
        for event in body["events"]:
            local_id = event["localEventId"]
            if local_id in self.committed:
                results.append({"localEventId": local_id, "status": "duplicate",
                                "eventId": self.committed[local_id]})
                continue
            self.committed[local_id] = f"evt-{len(self.committed) + 1}"
            if event["eventType"] == "ITEM_ACCEPTED_POINT":
                self.rewards += 1
            results.append({"localEventId": local_id, "status": "accepted",
                            "eventId": self.committed[local_id]})
        response = v2(*results)
        self.responses.append(response)
        if self.lose_next_response:
            self.lose_next_response = False
            raise TimeoutError("timed out")
        return response


def enqueue_fixture(db, ids=None):
    for local_id, event in EVENTS.items():
        if ids is None or local_id in ids:
            db.enqueue(event["eventType"], event["payload"], event["occurredAt"],
                       event["sessionId"], event["depositItemId"], local_id)


def outbox(db):
    rows = db._conn.execute("SELECT * FROM outbox ORDER BY id").fetchall()
    return {row["local_event_id"]: dict(row) for row in rows}


def outcome(db):
    rows = outbox(db)
    by = lambda status: sorted(k for k, r in rows.items() if r["delivery_status"] == status)  # noqa: E731
    return {"acked": by("sent"), "pending": by("pending"), "deadLetter": by("dead_letter")}


def make_due(db):
    with db._conn:
        db._conn.execute("UPDATE outbox SET next_attempt_at=0")


class WorkerCase(unittest.TestCase):
    batch_size = 20

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / "edge.db")
        self.db = EdgeDatabase(self.path)
        self.worker = SyncWorker(
            RvmConfig(machine_code="AUDIT-A-01", machine_secret="test-secret",
                      server_url="http://server", batch_size=self.batch_size),
            self.db,
        )

    def tearDown(self):
        try:
            self.db.close()
        except Exception:
            pass
        self.tmp.cleanup()

    def flush(self, server):
        with mock.patch("rvm.sync.urllib.request.urlopen", server):
            return self.worker.flush_once()


class HttpAckBehaviourTest(WorkerCase):
    def test_http_200_with_error_item_keeps_event_pending(self):
        enqueue_fixture(self.db, {E3})
        server = FakeEventsServer(lambda body: v2(failed(body["events"][0]["localEventId"])))
        self.assertFalse(self.flush(server))
        self.assertEqual(self.db.queue_depth(), 1)
        row = outbox(self.db)[E3]
        self.assertEqual(row["attempts"], 1)
        self.assertEqual(row["last_error"], "TEMPORARY_FAILURE")
        self.assertGreater(row["next_attempt_at"], time.time())

    def test_event_post_keeps_its_bounded_timeout(self):
        enqueue_fixture(self.db, {E1})
        server = FakeEventsServer(lambda body: v2(ok(E1)))
        self.assertTrue(self.flush(server))
        self.assertEqual([call["timeout"] for call in server.calls], [5])


class FixtureContractTest(WorkerCase):
    def test_worker_request_and_response_match_shared_fixture(self):
        enqueue_fixture(self.db)
        server = FakeEventsServer(lambda _body: FIXTURE["response"])
        self.assertFalse(self.flush(server))
        self.assertEqual(server.calls[0]["body"], FIXTURE["request"])
        self.assertEqual(outcome(self.db), {k: sorted(v) for k, v in FIXTURE["workerOutcome"].items()})
        self.assertEqual(outbox(self.db)[E4]["last_error"], "INVALID_EVENT")
        self.assertEqual(self.db.queue_depth(), 1)
        self.assertEqual(self.db.dead_letter_depth(), 1)

    def test_fixture_compatibility_cases(self):
        for name, case in FIXTURE["compatibility"].items():
            with self.subTest(name), tempfile.TemporaryDirectory() as tmp:
                db = EdgeDatabase(str(Path(tmp) / "edge.db"))
                try:
                    sent = set(case["workerOutcome"]["pending"]) | set(case["workerOutcome"]["acked"])
                    enqueue_fixture(db, sent)
                    worker = SyncWorker(RvmConfig(machine_secret="test-secret"), db)
                    self.assertFalse(worker.apply_event_results(db.pending(20), case["response"]))
                    self.assertEqual(outcome(db), {k: sorted(v) for k, v in case["workerOutcome"].items()})
                finally:
                    db.close()


class ApplyEventResultsTest(WorkerCase):
    def rows(self, ids):
        enqueue_fixture(self.db, set(ids))
        return self.db.pending(20)

    def test_accepted_duplicate_error_batch_acks_only_two(self):
        rows = self.rows([E1, E2, E3])
        self.assertEqual(self.db.queue_depth(), 3)
        done = self.worker.apply_event_results(rows, v2(ok(E1), ok(E2, "duplicate"), failed(E3)))
        self.assertFalse(done)
        self.assertEqual(self.db.queue_depth(), 1)
        self.assertEqual(outcome(self.db), {"acked": sorted([E1, E2]), "pending": [E3], "deadLetter": []})

    def test_full_batch_ack_reports_success(self):
        rows = self.rows([E1, E2])
        self.assertTrue(self.worker.apply_event_results(rows, v2(ok(E1), ok(E2, "duplicate"))))
        self.assertEqual(self.db.queue_depth(), 0)
        self.assertIsNotNone(self.worker.status()["lastSuccessAt"])

    def test_permanent_error_is_dead_lettered_and_retained(self):
        rows = self.rows([E4])
        self.assertFalse(self.worker.apply_event_results(rows, v2(failed(E4, "INVALID_EVENT", False))))
        row = outbox(self.db)[E4]
        self.assertEqual(row["delivery_status"], "dead_letter")
        self.assertEqual(row["last_error"], "INVALID_EVENT")
        self.assertIsNone(row["sent_at"])
        self.assertIsNotNone(row["dead_lettered_at"])
        self.assertEqual(self.db.queue_depth(), 0)
        self.assertEqual(self.db.dead_letter_depth(), 1)
        self.assertEqual(self.db.pending(20), [])

    def test_non_boolean_retryable_is_transient(self):
        rows = self.rows([E3])
        self.worker.apply_event_results(rows, v2(failed(E3, "EVENT_REJECTED", "false")))
        self.assertEqual(outcome(self.db)["pending"], [E3])

    def test_rejected_responses_keep_every_event_pending(self):
        cases = {
            "not an object": [ok(E1)],
            "legacy v1": {"received": 2, "results": [ok(E1), ok(E2)]},
            "unknown protocol": {"protocolVersion": 3, "received": 2, "results": [ok(E1), ok(E2)]},
            "results not a list": {"protocolVersion": 2, "received": 2, "results": {E1: "accepted"}},
            "received not a count": {"protocolVersion": 2, "received": "2", "results": [ok(E1), ok(E2)]},
            "foreign id": v2(ok(E1), ok(E2), ok("someone-elses-event")),
            "duplicate ack id": v2(ok(E1), ok(E1, "duplicate"), ok(E2)),
        }
        for name, payload in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as tmp:
                db = EdgeDatabase(str(Path(tmp) / "edge.db"))
                try:
                    enqueue_fixture(db, {E1, E2})
                    worker = SyncWorker(RvmConfig(machine_secret="test-secret"), db)
                    self.assertFalse(worker.apply_event_results(db.pending(20), payload))
                    rows = outbox(db)
                    self.assertEqual(db.queue_depth(), 2)
                    self.assertEqual({r["delivery_status"] for r in rows.values()}, {"pending"})
                    self.assertEqual({r["attempts"] for r in rows.values()}, {1})
                    self.assertIsNone(worker.status()["lastSuccessAt"])
                finally:
                    db.close()

    def test_missing_and_malformed_items_stay_pending(self):
        rows = self.rows([E1, E2, E3])
        payload = v2(ok(E1), {"localEventId": E2, "status": "ok"})
        self.assertFalse(self.worker.apply_event_results(rows, payload))
        self.assertEqual(outcome(self.db), {"acked": [E1], "pending": sorted([E2, E3]), "deadLetter": []})
        self.assertEqual(outbox(self.db)[E3]["attempts"], 1)

    def test_broken_json_keeps_data(self):
        enqueue_fixture(self.db, {E1, E2})
        server = FakeEventsServer(lambda _body: b"{not json")
        self.assertFalse(self.flush(server))
        self.assertEqual(self.db.queue_depth(), 2)
        self.assertTrue(self.worker.online)

    def test_http_error_status_keeps_data(self):
        enqueue_fixture(self.db, {E1})
        for status in (500, 503, 401):
            make_due(self.db)
            server = FakeEventsServer(lambda _body, s=status: (_ for _ in ()).throw(http_error(s)))
            self.assertFalse(self.flush(server))
            self.assertEqual(outcome(self.db)["pending"], [E1])
        make_due(self.db)
        self.assertFalse(self.flush(FakeEventsServer(lambda _body: Resp(500, b""))))
        self.assertEqual(outbox(self.db)[E1]["attempts"], 4)


class LostResponseTest(WorkerCase):
    def test_retry_after_lost_response_is_duplicate_without_second_reward(self):
        local_id = self.db.enqueue("ITEM_ACCEPTED_POINT", {"itemId": "item-1"}, "2026-10-13T08:00:00Z", "sess-1")
        backend = CommittingServer()
        backend.lose_next_response = True
        server = FakeEventsServer(backend)
        self.assertFalse(self.flush(server))
        self.assertEqual(self.db.queue_depth(), 1)
        self.assertEqual(backend.rewards, 1)
        make_due(self.db)
        self.assertTrue(self.flush(server))
        self.assertEqual(self.db.queue_depth(), 0)
        self.assertEqual(backend.rewards, 1)
        self.assertEqual([server.sent_ids(i) for i in (0, 1)], [[local_id], [local_id]])
        self.assertEqual(backend.responses[1]["results"][0]["status"], "duplicate")


class BackoffTest(WorkerCase):
    def test_backoff_is_exponential_capped_at_60s_with_jitter(self):
        self.assertEqual(database_module.RETRY_BACKOFF_CAP_SECONDS, 60)
        previous_high = 0.0
        for attempts in range(1, 40):
            cap = min(60.0, 2.0 ** attempts)
            low = database_module.retry_delay(attempts, rand=lambda: 0.0)
            high = database_module.retry_delay(attempts, rand=lambda: 1.0)
            self.assertAlmostEqual(low, cap / 2)
            self.assertAlmostEqual(high, cap)
            self.assertLessEqual(high, 60.0)
            self.assertGreaterEqual(high, previous_high)
            previous_high = high
        self.assertNotEqual(
            database_module.retry_delay(3, rand=lambda: 0.1),
            database_module.retry_delay(3, rand=lambda: 0.9),
        )

    def test_mark_failed_never_schedules_beyond_cap(self):
        enqueue_fixture(self.db, {E1})
        db_id = self.db.pending(1)[0]["db_id"]
        for _ in range(25):
            before = time.time()
            self.db.mark_failed([db_id], "TEMPORARY_FAILURE")
            row = outbox(self.db)[E1]
            self.assertLessEqual(row["next_attempt_at"] - before, 60.0 + 0.5)
        self.assertEqual(outbox(self.db)[E1]["attempts"], 25)
        self.assertGreaterEqual(outbox(self.db)[E1]["next_attempt_at"] - time.time(), 29.0)


class PoisonEventTest(WorkerCase):
    batch_size = 1

    def test_transient_poison_event_does_not_stall_queue(self):
        enqueue_fixture(self.db, {E1, E2, E3})
        server = FakeEventsServer(
            lambda body: v2(*(failed(e["localEventId"]) if e["localEventId"] == E1 else ok(e["localEventId"])
                              for e in body["events"]))
        )
        for _ in range(3):
            self.flush(server)
        self.assertEqual([server.sent_ids(i) for i in range(3)], [[E1], [E2], [E3]])
        self.assertEqual(outcome(self.db), {"acked": sorted([E2, E3]), "pending": [E1], "deadLetter": []})

    def test_permanent_poison_event_is_dead_lettered_and_not_resent(self):
        enqueue_fixture(self.db, {E1, E2, E3})
        server = FakeEventsServer(
            lambda body: v2(*(failed(e["localEventId"], "INVALID_EVENT", False)
                              if e["localEventId"] == E1 else ok(e["localEventId"])
                              for e in body["events"]))
        )
        for _ in range(4):
            make_due(self.db)
            self.flush(server)
        sent = [server.sent_ids(i) for i in range(len(server.calls))]
        self.assertEqual(sent, [[E1], [E2], [E3]])
        self.assertEqual(outcome(self.db), {"acked": sorted([E2, E3]), "pending": [], "deadLetter": [E1]})


class SessionOrderingTest(WorkerCase):
    """The backend resolves an item event against its session's history, so
    a session's events must reach it in order even across retries."""

    def accept_all(self):
        return FakeEventsServer(lambda body: v2(*(ok(e["localEventId"]) for e in body["events"])))

    def test_session_events_wait_behind_an_earlier_retrying_event(self):
        a1 = self.db.enqueue("ITEM_DETECTED", {}, "2026-10-13T08:00:01Z", "sess-a")
        a2 = self.db.enqueue("WEIGHT_MEASURED", {}, "2026-10-13T08:00:02Z", "sess-a")
        hb = self.db.enqueue("HEARTBEAT", {}, "2026-10-13T08:00:03Z")
        b1 = self.db.enqueue("ITEM_DETECTED", {}, "2026-10-13T08:00:04Z", "sess-b")
        # a1 fails transiently; the backend holds a2 behind it in the same batch.
        first = FakeEventsServer(lambda body: v2(*(
            failed(e["localEventId"]) if e["sessionId"] == "sess-a" else ok(e["localEventId"])
            for e in body["events"])))
        self.assertFalse(self.flush(first))
        self.assertEqual(outcome(self.db)["pending"], sorted([a1, a2]))

        a3 = self.db.enqueue("ITEM_ACCEPTED_POINT", {}, "2026-10-13T08:00:05Z", "sess-a")
        b2 = self.db.enqueue("ITEM_ACCEPTED_POINT", {}, "2026-10-13T08:00:06Z", "sess-b")
        hb2 = self.db.enqueue("HEARTBEAT", {}, "2026-10-13T08:00:07Z")
        server = self.accept_all()
        self.assertTrue(self.flush(server))
        # Other sessions and session-less events keep flowing; a3 waits.
        self.assertEqual(server.sent_ids(0), [b2, hb2])

        with self.db._conn:
            self.db._conn.execute("UPDATE outbox SET next_attempt_at=0 WHERE local_event_id=?", (a2,))
        self.assertTrue(self.flush(server))
        self.assertEqual(len(server.calls), 1, "a2 must not overtake a1, nor a3 overtake either")

        make_due(self.db)
        self.assertTrue(self.flush(server))
        self.assertEqual(server.sent_ids(1), [a1, a2, a3])
        self.assertEqual(outcome(self.db)["pending"], [])
        self.assertIn(hb, outcome(self.db)["acked"])
        self.assertIn(b1, outcome(self.db)["acked"])

    def test_dead_letter_does_not_hold_its_session(self):
        a1 = self.db.enqueue("ITEM_DETECTED", {}, "2026-10-13T08:00:01Z", "sess-a")
        a2 = self.db.enqueue("WEIGHT_MEASURED", {}, "2026-10-13T08:00:02Z", "sess-a")
        self.worker.apply_event_results(self.db.pending(1), v2(failed(a1, "INVALID_EVENT", False)))
        server = self.accept_all()
        self.assertTrue(self.flush(server))
        self.assertEqual(server.sent_ids(0), [a2])


class EnvelopeRejectionTest(WorkerCase):
    def test_batch_level_rejection_isolates_the_poison_event(self):
        enqueue_fixture(self.db, {E1, E2, E3})

        def respond(body):
            ids = [e["localEventId"] for e in body["events"]]
            if E1 in ids:
                raise http_error(422)
            return v2(*(ok(i) for i in ids))

        server = FakeEventsServer(respond)
        self.assertFalse(self.flush(server))
        self.assertEqual(server.sent_ids(0), [E1, E2, E3])
        make_due(self.db)
        for _ in range(3):
            self.flush(server)
        self.assertEqual([server.sent_ids(i) for i in range(1, 4)], [[E1], [E2], [E3]])
        self.assertEqual(len(server.calls), 4)
        # Never dead-lettered on an HTTP-level rejection: the batch may be fine
        # and the server wrong, so the event stays pending with backoff.
        self.assertEqual(outcome(self.db), {"acked": sorted([E2, E3]), "pending": [E1], "deadLetter": []})
        self.assertEqual(outbox(self.db)[E1]["attempts"], 2)


class RestartPersistenceTest(WorkerCase):
    def test_restart_keeps_retry_state_and_dead_letters(self):
        enqueue_fixture(self.db, {E3, E4})
        self.worker.apply_event_results(
            self.db.pending(20), v2(failed(E3), failed(E4, "INVALID_EVENT", False))
        )
        before = outbox(self.db)
        self.db.close()

        reopened = EdgeDatabase(self.path)
        try:
            after = outbox(reopened)
            self.assertEqual(after, before)
            self.assertEqual(after[E3]["delivery_status"], "pending")
            self.assertEqual(after[E3]["attempts"], 1)
            self.assertGreater(after[E3]["next_attempt_at"], time.time())
            self.assertEqual(after[E4]["delivery_status"], "dead_letter")
            self.assertEqual(after[E4]["last_error"], "INVALID_EVENT")
            self.assertEqual(reopened.queue_depth(), 1)
            self.assertEqual(reopened.dead_letter_depth(), 1)
            self.assertEqual(reopened.pending(20), [])
            self.assertEqual(glob.glob(self.path + ".*.bak"), [])
        finally:
            reopened.close()


class OutboxUpgradeTest(unittest.TestCase):
    def test_upgrade_from_legacy_schema_keeps_rows_and_backs_up_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "rvm.db")
            future = time.time() + 3600
            legacy = sqlite3.connect(path)
            legacy.executescript(LEGACY_SCHEMA)
            legacy.execute(
                "INSERT INTO outbox(local_event_id,event_type,payload_json,session_id,deposit_item_id,"
                "occurred_at,attempts,next_attempt_at,last_error,sent_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                ("legacy-pending", "ITEM_ACCEPTED_POINT", '{"itemId":"i-1"}', "s-1", None,
                 "2026-10-12T23:59:00Z", 3, future, "HTTP Error 500", None),
            )
            legacy.execute(
                "INSERT INTO outbox(local_event_id,event_type,payload_json,occurred_at,attempts,sent_at)"
                " VALUES(?,?,?,?,?,?)",
                ("legacy-sent", "HEARTBEAT", '{"status":"ONLINE"}', "2026-10-12T23:58:00Z", 1, 1760000000.0),
            )
            legacy.commit()
            legacy.close()

            db = EdgeDatabase(path)
            try:
                rows = outbox(db)
                self.assertEqual(rows["legacy-pending"]["delivery_status"], "pending")
                self.assertEqual(rows["legacy-pending"]["attempts"], 3)
                self.assertEqual(rows["legacy-pending"]["next_attempt_at"], future)
                self.assertEqual(rows["legacy-pending"]["last_error"], "HTTP Error 500")
                self.assertEqual(rows["legacy-pending"]["payload_json"], '{"itemId":"i-1"}')
                self.assertEqual(rows["legacy-sent"]["delivery_status"], "sent")
                self.assertEqual(db.queue_depth(), 1)
                self.assertEqual(db.pending(10), [])
                make_due(db)
                self.assertEqual([r["localEventId"] for r in db.pending(10)], ["legacy-pending"])

                backups = glob.glob(path + ".pre-outbox-v2-*.bak")
                self.assertEqual(len(backups), 1)
                snapshot = sqlite3.connect(backups[0])
                snapshot.row_factory = sqlite3.Row
                columns = {c["name"] for c in snapshot.execute("PRAGMA table_info(outbox)")}
                self.assertNotIn("delivery_status", columns)
                kept = {r["local_event_id"]: dict(r) for r in snapshot.execute("SELECT * FROM outbox")}
                snapshot.close()
                self.assertEqual(kept["legacy-pending"]["attempts"], 3)
                self.assertEqual(kept["legacy-pending"]["next_attempt_at"], future)
                self.assertEqual(set(kept), {"legacy-pending", "legacy-sent"})
            finally:
                db.close()

            again = EdgeDatabase(path)
            again.close()
            self.assertEqual(len(glob.glob(path + ".pre-outbox-v2-*.bak")), 1)

    def test_fresh_database_needs_no_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "fresh.db")
            db = EdgeDatabase(path)
            db.close()
            self.assertEqual(glob.glob(path + ".*.bak"), [])


def controller_in(tmp):
    return RvmController(RvmConfig(
        machine_code="AUDIT-A-01",
        machine_secret="test-secret",
        database_path=str(Path(tmp) / "rvm.db"),
        server_url="http://127.0.0.1:1",
        hardware_driver="mock",
        port=0,  # ephemeral: never collide with another suite's kiosk server
        maintenance_pin_hash=RvmConfig.hash_pin("2468"),
    ))


class OperatorViewTest(unittest.TestCase):
    def test_operator_sees_pending_dead_letter_and_last_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            try:
                enqueue_fixture(c.db, {E1, E3, E4})
                c.sync.apply_event_results(
                    c.db.pending(20), v2(ok(E1), failed(E3), failed(E4, "INVALID_EVENT", False))
                )
                status = c.public_state()["serverStatus"]
                self.assertEqual(status["queueDepth"], 1)
                self.assertEqual(status["deadLetterDepth"], 1)
                self.assertIsInstance(status["lastSuccessAt"], float)
                self.assertEqual(len(status["deadLetters"]), 1)
                dead = status["deadLetters"][0]
                self.assertEqual(dead["localEventId"], E4)
                self.assertEqual(dead["eventType"], "NOT_A_MACHINE_EVENT")
                self.assertEqual(dead["reason"], "INVALID_EVENT")
                self.assertEqual(dead["attempts"], 1)
                self.assertNotIn("payload", dead)
                heartbeat = c.heartbeat_payload()
                self.assertEqual(heartbeat["queueDepth"], 1)
                self.assertEqual(heartbeat["deadLetterDepth"], 1)
                self.assertRegex(heartbeat["lastSyncSuccessAt"], r"^\d{4}-\d{2}-\d{2}T.*Z$")
                last_success = status["lastSuccessAt"]
            finally:
                c.db.close()
            restarted = controller_in(tmp)
            try:
                status = restarted.public_state()["serverStatus"]
                self.assertEqual(status["lastSuccessAt"], last_success)
                self.assertEqual(status["deadLetterDepth"], 1)
            finally:
                restarted.db.close()


class KioskApiCase(unittest.TestCase):
    """Controller plus the real local kiosk API on an ephemeral port."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.c = controller_in(self.tmp.name)
        servers = []

        class Cap(ThreadingHTTPServer):
            def __init__(self, *a, **k):
                super().__init__(*a, **k)
                servers.append(self)

        assets = Path(__file__).resolve().parents[1] / "rvm" / "web"
        with mock.patch("rvm.api.ThreadingHTTPServer", Cap):
            self.api = LocalApiServer(self.c, assets)
            self.thread = threading.Thread(target=self.api.serve, daemon=True)
            self.thread.start()
            deadline = time.time() + 5
            while not servers and time.time() < deadline:
                time.sleep(0.02)
        self.server = servers[0]
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.api.stop()
        self.thread.join(timeout=3)
        self.server.server_close()
        self.c.db.close()
        self.tmp.cleanup()

    def post(self, path, payload, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("POST", path, json.dumps(payload).encode(),
                     {"Content-Type": "application/json", **(headers or {})})
        response = conn.getresponse()
        data = response.read()
        conn.close()
        return response.status, json.loads(data or b"{}")


class AuthorizedRetryTest(KioskApiCase):
    def historical(self):
        row = outbox(self.c.db)[E4]
        return {column: row[column] for column in HISTORICAL_COLUMNS}

    def test_retry_requires_maintenance_token_and_keeps_payload(self):
        enqueue_fixture(self.c.db, {E4})
        self.c.sync.apply_event_results(self.c.db.pending(20), v2(failed(E4, "INVALID_EVENT", False)))
        original = self.historical()

        for headers in ({}, {"Authorization": "Bearer not-a-token"}):
            status, _ = self.post("/api/maintenance/command", {"command": "retry-dead-letter"}, headers)
            self.assertEqual(status, 401)
            self.assertEqual(outbox(self.c.db)[E4]["delivery_status"], "dead_letter")

        status, body = self.post("/api/maintenance/login", {"pin": "2468"})
        self.assertEqual(status, 200)
        auth = {"Authorization": f"Bearer {body['token']}"}
        status, body = self.post("/api/maintenance/command", {"command": "retry-dead-letter"}, auth)
        self.assertEqual(status, 200)
        self.assertEqual(body["serverStatus"]["deadLetterDepth"], 0)
        self.assertEqual(body["serverStatus"]["queueDepth"], 1)

        row = outbox(self.c.db)[E4]
        self.assertEqual(row["delivery_status"], "pending")
        self.assertEqual(row["attempts"], 1)
        self.assertLessEqual(row["next_attempt_at"], time.time())
        self.assertEqual(self.historical(), original)
        audit = [json.loads(r["data_json"]) for r in self.c.db._conn.execute(
            "SELECT data_json FROM audit WHERE action='OUTBOX_DEAD_LETTER_RETRY'")]
        self.assertEqual(audit, [{"count": 1, "ids": [row["id"]]}])

        server = FakeEventsServer(lambda body: v2(*(ok(e["localEventId"]) for e in body["events"])))
        with mock.patch("rvm.sync.urllib.request.urlopen", server):
            self.assertTrue(self.c.sync.flush_once())
        self.assertEqual(server.calls[0]["body"]["events"], [EVENTS[E4]])
        self.assertEqual(outbox(self.c.db)[E4]["delivery_status"], "sent")



# --------------------------------------------------------------------------- #
# Fix round 1 (review I1/C1): the sync thread survives truncated or malformed
# responses, and dead-letter retry ids are validated.
# --------------------------------------------------------------------------- #
class TruncatedResp(Resp):
    """The connection drops mid-body: http.client raises IncompleteRead."""

    def read(self):
        raise http.client.IncompleteRead(b'{"protocolVersion":2,"rece', 120)


def wait_until(predicate, timeout=6.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


class ResilientFlushTest(WorkerCase):
    def test_truncated_body_keeps_rows_pending_and_next_flush_works(self):
        enqueue_fixture(self.db, {E1, E2})
        self.assertFalse(self.flush(FakeEventsServer(lambda _body: TruncatedResp(200))))
        rows = outbox(self.db)
        self.assertEqual({r["delivery_status"] for r in rows.values()}, {"pending"})
        self.assertEqual({r["attempts"] for r in rows.values()}, {1})
        self.assertFalse(self.worker.online)
        self.assertIsNotNone(self.worker.last_error)
        make_due(self.db)
        self.assertTrue(self.flush(FakeEventsServer(lambda body: v2(*(ok(e["localEventId"]) for e in body["events"])))))
        self.assertEqual(self.db.queue_depth(), 0)

    def test_non_string_status_or_id_is_malformed_not_fatal(self):
        enqueue_fixture(self.db, {E1, E2, E3, E4})
        payload = v2(
            {"localEventId": E1, "status": ["accepted"], "eventId": "srv-1"},
            {"localEventId": E2, "status": {"accepted": True}},
            {"localEventId": ["not", "a", "string"], "status": "accepted"},
            ok(E4),
        )
        self.assertFalse(self.worker.apply_event_results(self.db.pending(20), payload))
        rows = outbox(self.db)
        self.assertEqual(outcome(self.db), {"acked": [E4], "pending": sorted([E1, E2, E3]), "deadLetter": []})
        self.assertEqual(rows[E1]["last_error"], "MALFORMED_RESULT")
        self.assertEqual(rows[E2]["last_error"], "MALFORMED_RESULT")
        self.assertEqual(rows[E3]["last_error"], "MISSING_RESULT")
        # A non-string status never ACKs, even when it "contains" accepted.
        self.assertEqual({rows[i]["attempts"] for i in (E1, E2, E3)}, {1})


class SyncThreadSurvivalTest(WorkerCase):
    """Each case: the first answer is bad, later answers are good. The daemon
    thread must survive, keep the rows pending, and deliver them afterwards."""

    def run_loop(self, first_answer):
        enqueue_fixture(self.db, {E1, E2})
        self.worker.config.sync_interval_seconds = 0.02
        self.worker._last_media_sync = time.time() + 3600  # keep media sync out of the loop
        state = {"bad": True, "after_bad": None}

        def respond(body):
            if state["bad"]:
                state["bad"] = False
                return first_answer(body)
            if state["after_bad"] is None:
                # Outbox as the bad answer left it (read from the loop thread).
                state["after_bad"] = outbox(self.db)
            return v2(*(ok(e["localEventId"]) for e in body["events"]))

        server = FakeEventsServer(respond)
        with mock.patch("rvm.sync.urllib.request.urlopen", server):
            self.worker.start()
            try:
                self.assertTrue(wait_until(lambda: len(server.calls) >= 2),
                                "the loop stopped after the bad answer")
                self.assertTrue(self.worker._thread.is_alive(), "rvm-sync thread died")
                self.assertTrue(wait_until(lambda: self.db.queue_depth() == 0),
                                "the loop never delivered the pending rows")
                self.assertTrue(self.worker._thread.is_alive())
            finally:
                self.worker.stop()
        resent = {i for call in range(1, len(server.calls)) for i in server.sent_ids(call)}
        self.assertEqual(resent, {E1, E2})
        self.assertEqual(outcome(self.db)["acked"], sorted([E1, E2]))
        return state["after_bad"]

    def test_truncated_body(self):
        after_bad = self.run_loop(lambda _body: TruncatedResp(200))
        self.assertEqual({r["delivery_status"] for r in after_bad.values()}, {"pending"})
        self.assertEqual({r["attempts"] for r in after_bad.values()}, {1})

    def test_unhashable_status(self):
        after_bad = self.run_loop(lambda body: v2(*(
            {"localEventId": e["localEventId"], "status": ["accepted"]} for e in body["events"])))
        self.assertEqual({r["delivery_status"] for r in after_bad.values()}, {"pending"})
        self.assertEqual({r["last_error"] for r in after_bad.values()}, {"MALFORMED_RESULT"})

    def test_unexpected_exception_is_logged_and_the_loop_continues(self):
        with self.assertLogs("rvm.sync", level="ERROR") as logs:
            after_bad = self.run_loop(lambda _body: (_ for _ in ()).throw(ValueError("unexpected")))
        self.assertEqual({r["delivery_status"] for r in after_bad.values()}, {"pending"})
        self.assertTrue(any("ValueError" in line for line in logs.output))


class DeadLetterRetryValidationTest(KioskApiCase):
    def test_invalid_ids_get_an_indonesian_422_and_change_nothing(self):
        enqueue_fixture(self.c.db, {E3, E4})
        self.c.sync.apply_event_results(
            self.c.db.pending(20),
            v2(failed(E3, "INVALID_EVENT", False), failed(E4, "INVALID_EVENT", False)),
        )
        status, body = self.post("/api/maintenance/login", {"pin": "2468"})
        auth = {"Authorization": f"Bearer {body['token']}"}
        for ids in ([None], [{}], [[1]], [True], [1.5], ["1"], [0], [-3], "1", {"id": 1}, None):
            with self.subTest(ids=ids):
                status, body = self.post("/api/maintenance/command",
                                         {"command": "retry-dead-letter", "ids": ids}, auth)
                self.assertEqual(status, 422)
                self.assertEqual(body["error"], "ID event tidak valid: kirim daftar ID event berupa angka positif")
                self.assertEqual(self.c.db.dead_letter_depth(), 2)

        e3_id = outbox(self.c.db)[E3]["id"]
        status, body = self.post("/api/maintenance/command",
                                 {"command": "retry-dead-letter", "ids": [e3_id]}, auth)
        self.assertEqual(status, 200)
        self.assertEqual(outcome(self.c.db), {"acked": [], "pending": [E3], "deadLetter": [E4]})



class RetryLimitTest(WorkerCase):
    """One event the server keeps failing no longer retries silently forever:
    after MAX_SERVER_FAILURES server-reported transient errors it is
    dead-lettered as RETRY_LIMIT (kept, visible, operator retry) while the
    rest of its session waits behind it in order. Network failures, malformed
    responses and SESSION_HELD (an event only waiting behind an earlier one)
    never count."""

    def server_round(self, poison):
        make_due(self.db)
        rows = self.db.pending(20)
        self.worker.apply_event_results(rows, v2(*(
            failed(r["localEventId"]) if r["localEventId"] == poison else failed(r["localEventId"], "SESSION_HELD")
            for r in rows)))

    def session_pair(self):
        a1 = self.db.enqueue("ITEM_DETECTED", {}, "2026-10-13T08:00:01Z", "sess-a")
        a2 = self.db.enqueue("WEIGHT_MEASURED", {}, "2026-10-13T08:00:02Z", "sess-a")
        return a1, a2

    def test_poison_event_is_dead_lettered_at_the_limit_and_its_session_waits_in_order(self):
        limit = database_module.MAX_SERVER_FAILURES
        a1, a2 = self.session_pair()
        for _ in range(limit - 1):
            self.server_round(a1)
        self.assertEqual(outcome(self.db)["pending"], sorted([a1, a2]))

        self.server_round(a1)

        self.assertEqual(outcome(self.db), {"acked": [], "pending": [a2], "deadLetter": [a1]})
        self.assertEqual(self.db.dead_letters(5)[0]["reason"], "RETRY_LIMIT:TEMPORARY_FAILURE")
        # The backend resolves a2's item from a1: a2 waits behind the
        # retry-limited a1 instead of arriving out of order.
        make_due(self.db)
        self.assertEqual(self.db.pending(20), [])
        # The operator retry resends the session in order.
        self.db.retry_dead_letters()
        self.assertEqual([r["localEventId"] for r in self.db.pending(20)], [a1, a2])

    def test_network_and_malformed_failures_never_count_toward_the_limit(self):
        limit = database_module.MAX_SERVER_FAILURES
        a1, _ = self.session_pair()

        def down(*_a, **_k):
            raise urllib.error.URLError("network down")

        for _ in range(limit * 2):
            make_due(self.db)
            self.flush(down)
            make_due(self.db)
            self.worker.apply_event_results(self.db.pending(20), {"protocolVersion": 1})
        self.assertEqual(outcome(self.db)["deadLetter"], [])
        self.server_round(a1)
        self.assertEqual(outcome(self.db)["deadLetter"], [])

    def test_operator_retry_restarts_the_count(self):
        limit = database_module.MAX_SERVER_FAILURES
        a1, a2 = self.session_pair()
        for _ in range(limit):
            self.server_round(a1)
        self.assertEqual(self.db.retry_dead_letters(), [outbox(self.db)[a1]["id"]])
        for _ in range(limit - 1):
            self.server_round(a1)
        self.assertEqual(outcome(self.db)["pending"], sorted([a1, a2]))

    def test_outbox_error_is_not_wiped_by_a_successful_session_poll(self):
        a1, _ = self.session_pair()
        self.server_round(a1)
        with mock.patch("rvm.sync.urllib.request.urlopen", lambda *_a, **_k: Resp(200, b"{}")):
            self.worker.fetch_machine_session()
        status = self.worker.status()
        self.assertIsNone(status["lastError"])
        self.assertEqual(status["outboxError"], "TEMPORARY_FAILURE")
        self.assertEqual(status["outboxErrorLabel"], "Server sedang bermasalah; event akan dikirim ulang")

    def test_outbox_error_stays_while_the_event_is_stuck_and_clears_once_it_is_acked(self):
        a1, _ = self.session_pair()
        self.server_round(a1)
        # A later batch (a heartbeat) goes through completely.
        hb = self.db.enqueue("HEARTBEAT", {}, "2026-10-13T08:00:09Z")
        self.worker.apply_event_results([r for r in self.db.pending(20) if r["localEventId"] == hb], v2(ok(hb)))
        self.assertEqual(self.worker.status()["outboxError"], "TEMPORARY_FAILURE")
        make_due(self.db)
        rows = self.db.pending(20)
        self.worker.apply_event_results(rows, v2(*(ok(r["localEventId"]) for r in rows)))
        status = self.worker.status()
        self.assertIsNone(status["outboxError"])
        self.assertIsNone(status["outboxErrorLabel"])

    def test_outbox_error_label_is_indonesian_for_every_kind_of_failure(self):
        from rvm.sync import outbox_error_label
        cases = {
            "TEMPORARY_FAILURE": "Server sedang bermasalah; event akan dikirim ulang",
            "SESSION_HELD,TEMPORARY_FAILURE": "Menunggu event sebelumnya dari sesi yang sama",
            "INVALID_EVENT": "Format event tidak dikenali server",
            "EVENT_REJECTED": "Ditolak oleh aturan server",
            "PROTOCOL_MISMATCH": "Jawaban server tidak dikenali",
            "MALFORMED_RESPONSE": "Jawaban server rusak",
            "MISSING_RESULT": "Server tidak menjawab sebagian event",
            "HTTP_502": "Server menolak pengiriman (HTTP 502)",
            "SOME_NEW_CODE": "Server menolak event",
            "<urlopen error [Errno 111] Connection refused>": "Server tidak dapat dihubungi",
            "timed out": "Server tidak dapat dihubungi",
        }
        for raw, label in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(outbox_error_label(raw), label)
        self.assertIsNone(outbox_error_label(None))


class RetryLimitUpgradeTest(unittest.TestCase):
    def test_upgrade_adds_the_failure_counter_keeping_rows_after_a_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "rvm.db")
            db = EdgeDatabase(path)
            db.enqueue("ITEM_DETECTED", {}, "2026-10-13T08:00:01Z", "sess-a", None, "kept-pending")
            db.close()
            raw = sqlite3.connect(path)
            raw.execute("ALTER TABLE outbox DROP COLUMN server_failures")
            raw.commit()
            raw.close()

            upgraded = EdgeDatabase(path)
            try:
                self.assertIn("server_failures", upgraded._outbox_columns())
                self.assertIsNotNone(upgraded.backup_path)
                self.assertEqual(outcome(upgraded)["pending"], ["kept-pending"])
                self.assertEqual(outbox(upgraded)["kept-pending"]["server_failures"], 0)
            finally:
                upgraded.close()


if __name__ == "__main__":
    unittest.main()
