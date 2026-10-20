"""B01b: the close watermark. Once the server ended a session, and every
event of that session has been durably ACKed (R02 outbox), the RVM enqueues
one SESSION_CLOSE_WATERMARK event; the server releases the residual reward
hold only after it. A lost connection, a pending or dead-lettered event, or a
session conflict never produces a watermark."""
from __future__ import annotations

import glob
import json
import sqlite3
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from rvm.config import RvmConfig
from rvm.controller import RvmController, MachineState
from rvm.database import EdgeDatabase
from rvm.lease import policy_version, sign_lease_v2

SECRET = "watermark-test-secret"
MACHINE = "WM-001"
POLICY = {"version": 1, "mode": "MONEY_REWARD", "multiplierBps": 10000,
          "wasteTypes": [{"id": "wt-item", "unit": "ITEM", "rewardPerUnit": 100, "maxRewardRupiah": 100}]}


def make_controller(tmp: str, **overrides) -> RvmController:
    config = dict(
        machine_code=MACHINE, machine_secret=SECRET, database_path=str(Path(tmp) / "rvm.db"),
        server_url="http://127.0.0.1:1", hardware_driver="mock",
        camera_capture_session_start=False, camera_capture_security_events=False, compactor_enabled=False,
    )
    config.update(overrides)
    controller = RvmController(RvmConfig(**config))
    if controller.state == MachineState.BOOTING:
        controller.set_state(MachineState.IDLE, "test-setup")
    return controller


def lease_for(session_id: str, ceiling: int | None = 1000) -> dict:
    now = int(time.time())
    signed = sign_lease_v2(SECRET, {
        "id": f"lease-{session_id}", "machineCode": MACHINE, "sessionId": session_id, "userRef": "user-1",
        "issuedAt": now, "expiresAt": now + 120, "reservationId": "res-1",
        "policyVersion": policy_version(POLICY), "ceilingRupiah": ceiling, "maxItems": None,
    })
    signed["policy"] = POLICY
    return signed


class Resp:
    def __init__(self, status, data=b""):
        self.status, self._data = status, data

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


class FakeServer:
    """urlopen double answering POST /api/machine-events with v2 ACKs (or a
    per-event responder) and recording every batch it saw."""

    def __init__(self, responder=None):
        self.batches: list[list[dict]] = []
        self.responder = responder

    def __call__(self, request, timeout=None):
        body = json.loads(request.data)
        self.batches.append(body["events"])
        results = []
        for event in body["events"]:
            custom = self.responder(event) if self.responder else None
            results.append(custom or {"localEventId": event["localEventId"], "status": "accepted", "eventId": "srv"})
        return Resp(200, json.dumps({"protocolVersion": 2, "received": len(results), "results": results}).encode())

    def events(self, event_type: str) -> list[dict]:
        return [e for batch in self.batches for e in batch if e["eventType"] == event_type]


def poll_with(controller: RvmController, payload: dict | None) -> None:
    with mock.patch.object(controller.sync, "fetch_machine_session", return_value=payload):
        with mock.patch.object(controller.sync, "fetch_display", return_value=None):
            controller._poll_server_session()


class CloseWatermarkTest(unittest.TestCase):
    def _run_session(self, controller: RvmController, session: str) -> list[str]:
        self.assertTrue(controller.activate_lease(lease_for(session)))
        controller.emit("ITEM_DETECTED", {"wasteTypeId": "wt-item"}, session)
        controller.emit("ITEM_ACCEPTED_POINT", {"acceptanceBeam": True}, session)
        return [r["localEventId"] for r in controller.db.pending(100) if r["sessionId"] == session]

    def test_watermark_follows_only_after_the_server_ended_the_session_and_every_event_was_acked(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                session = "session-wm"
                ids = self._run_session(controller, session)
                server = FakeServer()
                with mock.patch("urllib.request.urlopen", server):
                    self.assertTrue(controller.sync.flush_once())
                    # Session still running on the server: no watermark.
                    self.assertEqual(server.events("SESSION_CLOSE_WATERMARK"), [])
                    poll_with(controller, {"lease": lease_for(session), "session": {"id": session}})
                    self.assertTrue(controller.sync.flush_once())
                    self.assertEqual(server.events("SESSION_CLOSE_WATERMARK"), [])
                    self.assertIsNone(controller.db.session_consumption(session)["closed_at"])
                    # The server ended it: the next flush carries exactly one watermark.
                    poll_with(controller, {"lease": None, "session": None})
                    self.assertIsNotNone(controller.db.session_consumption(session)["closed_at"])
                    self.assertEqual(controller.state, MachineState.IDLE)
                    self.assertTrue(controller.sync.flush_once())
                    marks = server.events("SESSION_CLOSE_WATERMARK")
                    self.assertEqual(len(marks), 1)
                    mark = marks[0]
                    self.assertEqual(mark["sessionId"], session)
                    self.assertEqual(mark["payload"]["eventCount"], len(ids))
                    self.assertEqual(mark["payload"]["lastLocalEventId"], ids[-1])
                    self.assertIn("consumedRupiah", mark["payload"])
                    self.assertIn("consumedItems", mark["payload"])
                    # Idempotent: no second watermark, ever.
                    self.assertTrue(controller.sync.flush_once())
                    poll_with(controller, {"lease": None, "session": None})
                    self.assertTrue(controller.sync.flush_once())
                    self.assertEqual(len(server.events("SESSION_CLOSE_WATERMARK")), 1)
                    self.assertEqual(controller.db.queue_depth(), 0)
                row = controller.db.session_consumption(session)
                self.assertEqual(row["watermark_event_id"], mark["localEventId"])
            finally:
                controller.db.close()

    def test_no_watermark_while_an_event_is_pending_or_dead_lettered(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                session = "session-pending"
                ids = self._run_session(controller, session)
                refused = {ids[-1]}

                def responder(event):
                    if event["localEventId"] in refused:
                        return {"localEventId": event["localEventId"], "status": "error",
                                "error": "TEMPORARY_FAILURE", "retryable": True}
                    return None

                server = FakeServer(responder)
                with mock.patch("urllib.request.urlopen", server):
                    poll_with(controller, {"lease": None, "session": None})
                    self.assertFalse(controller.sync.flush_once())
                    self.assertEqual(server.events("SESSION_CLOSE_WATERMARK"), [])
                    # Dead-lettered: still no watermark (the operator sees it).
                    db_id = [r for r in controller.db._conn.execute("SELECT id FROM outbox WHERE local_event_id=?", (ids[-1],))][0][0]
                    controller.db.mark_dead_letter([db_id], "EVENT_REJECTED")
                    self.assertTrue(controller.sync.flush_once())
                    self.assertEqual(server.events("SESSION_CLOSE_WATERMARK"), [])
                    # Operator retry, then ACK: the watermark follows the last ACK.
                    refused.clear()
                    controller.db.retry_dead_letters()
                    self.assertTrue(controller.sync.flush_once())
                    self.assertEqual(server.events("SESSION_CLOSE_WATERMARK"), [])
                    self.assertTrue(controller.sync.flush_once())
                    marks = server.events("SESSION_CLOSE_WATERMARK")
                    self.assertEqual(len(marks), 1)
                    self.assertEqual(marks[0]["payload"]["eventCount"], len(ids))
                    self.assertEqual(marks[0]["payload"]["lastLocalEventId"], ids[-1])
            finally:
                controller.db.close()

    def test_lost_connection_retains_everything_and_a_restart_sends_the_watermark_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            session = "session-offline"
            try:
                ids = self._run_session(controller, session)
                poll_with(controller, {"lease": None, "session": None})
                offline = mock.Mock(side_effect=urllib.error.URLError("down"))
                with mock.patch("urllib.request.urlopen", offline):
                    self.assertFalse(controller.sync.flush_once())
                # Every event of the session (CHAMBER_OPENED, the two item events) stays pending; no watermark was queued.
                self.assertEqual(controller.db.queue_depth(), len(ids))
                self.assertEqual(controller.db.session_outbox_summary(session)["pending"], len(ids))
            finally:
                controller.db.close()
            # The events (and the closed session) survive a restart; once the
            # connection is back the ACKs flow and the watermark follows once.
            restarted = make_controller(tmp)
            try:
                self.assertIsNotNone(restarted.db.session_consumption(session)["closed_at"])
                self.assertIsNone(restarted.db.session_consumption(session)["watermark_event_id"])
                server = FakeServer()
                with mock.patch("urllib.request.urlopen", server):
                    with restarted.db._conn:
                        restarted.db._conn.execute("UPDATE outbox SET next_attempt_at=0")
                    self.assertTrue(restarted.sync.flush_once())
                    self.assertEqual(server.events("SESSION_CLOSE_WATERMARK"), [])
                    self.assertTrue(restarted.sync.flush_once())
                    marks = server.events("SESSION_CLOSE_WATERMARK")
                    self.assertEqual(len(marks), 1)
                    self.assertEqual(marks[0]["payload"]["lastLocalEventId"], ids[-1])
                    self.assertTrue(restarted.sync.flush_once())
                    self.assertEqual(len(server.events("SESSION_CLOSE_WATERMARK")), 1)
            finally:
                restarted.db.close()

    def test_session_conflict_or_renewal_never_closes_the_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                session = "session-conflict"
                self._run_session(controller, session)
                poll_with(controller, {"lease": None, "session": None, "sessionConflict": True})
                self.assertIsNone(controller.db.active_lease())
                self.assertIsNone(controller.db.session_consumption(session)["closed_at"])
                # The conflict resolved in this session's favour: it resumes.
                poll_with(controller, {"lease": lease_for(session), "session": {"id": session}})
                self.assertIsNotNone(controller.db.active_lease())
                self.assertIsNone(controller.db.session_consumption(session)["closed_at"])
                # Another session replaces it: the old one is closed, the new one runs.
                poll_with(controller, {"lease": lease_for("session-next"), "session": {"id": "session-next"}})
                self.assertIsNotNone(controller.db.session_consumption(session)["closed_at"])
                self.assertIsNone(controller.db.session_consumption("session-next")["closed_at"])
            finally:
                controller.db.close()

    def test_a_v1_backend_response_acks_nothing_so_no_watermark_is_sent(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                session = "session-v1"
                self._run_session(controller, session)
                poll_with(controller, {"lease": None, "session": None})
                legacy = mock.Mock(return_value=Resp(200, json.dumps({"received": 3, "results": []}).encode()))
                with mock.patch("urllib.request.urlopen", legacy):
                    self.assertFalse(controller.sync.flush_once())
                    with controller.db._conn:
                        controller.db._conn.execute("UPDATE outbox SET next_attempt_at=0")
                    self.assertFalse(controller.sync.flush_once())
                self.assertEqual(
                    [e for call in legacy.call_args_list for e in json.loads(call.args[0].data)["events"]
                     if e["eventType"] == "SESSION_CLOSE_WATERMARK"], [])
                self.assertIsNone(controller.db.session_consumption(session)["watermark_event_id"])
            finally:
                controller.db.close()


# Lease table DDL exactly as shipped before B01b (protocol v1 lease).
LEGACY_SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, local_event_id TEXT NOT NULL UNIQUE, event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL, session_id TEXT, deposit_item_id TEXT, occurred_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at REAL NOT NULL DEFAULT 0, last_error TEXT, sent_at REAL,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','dead_letter')),
  dead_lettered_at REAL
);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, data_json TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS leases (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_ref TEXT, issued_at REAL NOT NULL, expires_at REAL NOT NULL,
  status TEXT NOT NULL, signature TEXT NOT NULL
);
"""


class LeaseUpgradeTest(unittest.TestCase):
    def test_legacy_lease_table_is_backed_up_then_upgraded_in_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "edge.db"
            legacy = sqlite3.connect(str(path))
            legacy.executescript(LEGACY_SCHEMA)
            now = time.time()
            with legacy:
                legacy.execute(
                    "INSERT INTO leases(id,session_id,user_ref,issued_at,expires_at,status,signature) VALUES(?,?,?,?,?,?,?)",
                    ("lease-old", "session-old", "user-old", now, now + 1000, "ACTIVE", "sig"))
                legacy.execute(
                    "INSERT INTO outbox(local_event_id,event_type,payload_json,session_id,occurred_at,delivery_status,sent_at)"
                    " VALUES(?,?,?,?,?,?,?)", ("e1", "HEARTBEAT", "{}", None, "2026-10-15T00:00:00Z", "sent", now))
            legacy.close()

            db = EdgeDatabase(str(path))
            try:
                backups = glob.glob(str(path) + ".pre-lease-v2-*.bak")
                self.assertEqual(len(backups), 1)
                self.assertEqual(db.backup_path, backups[0])
                snapshot = sqlite3.connect(backups[0])
                try:
                    columns = {row[1] for row in snapshot.execute("PRAGMA table_info(leases)")}
                    self.assertNotIn("version", columns)
                    self.assertEqual(snapshot.execute("SELECT COUNT(*) FROM leases").fetchone()[0], 1)
                    self.assertEqual(snapshot.execute("SELECT COUNT(*) FROM outbox").fetchone()[0], 1)
                finally:
                    snapshot.close()
                columns = {row["name"] for row in db._conn.execute("PRAGMA table_info(leases)")}
                for column in ("version", "machine_code", "reservation_id", "policy_version",
                               "ceiling_rupiah", "max_items", "policy_json"):
                    self.assertIn(column, columns)
                row = db.active_lease()
                self.assertEqual(row["id"], "lease-old")
                self.assertEqual(row["version"], 1)
                self.assertIsNone(row["ceiling_rupiah"])
                self.assertEqual(db.queue_depth(), 0)
                tables = {r[0] for r in db._conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertIn("session_consumption", tables)
            finally:
                db.close()
            # Idempotent: a second open makes no second backup.
            again = EdgeDatabase(str(path))
            try:
                self.assertIsNone(again.backup_path)
                self.assertEqual(len(glob.glob(str(path) + ".pre-lease-v2-*.bak")), 1)
            finally:
                again.close()


if __name__ == "__main__":
    unittest.main()
