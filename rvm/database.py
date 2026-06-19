from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA foreign_keys=ON;
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
CREATE TABLE IF NOT EXISTS leases (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_ref TEXT,
  issued_at REAL NOT NULL,
  expires_at REAL NOT NULL,
  status TEXT NOT NULL,
  signature TEXT NOT NULL
);
"""


class EdgeDatabase:
    def __init__(self, path: str):
        db_path = Path(path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.path = str(db_path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def set_json(self, key: str, value: Any) -> None:
        raw = json.dumps(value, separators=(",", ":"))
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                (key, raw, time.time()),
            )

    def get_json(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        if not row:
            return default
        try:
            return json.loads(row["value"])
        except json.JSONDecodeError:
            return default

    def enqueue(
        self,
        event_type: str,
        payload: dict[str, Any],
        occurred_at: str,
        session_id: str | None = None,
        deposit_item_id: str | None = None,
        local_event_id: str | None = None,
    ) -> str:
        event_id = local_event_id or str(uuid.uuid4())
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO outbox"
                "(local_event_id,event_type,payload_json,session_id,deposit_item_id,occurred_at)"
                " VALUES(?,?,?,?,?,?)",
                (
                    event_id,
                    event_type,
                    json.dumps(payload, separators=(",", ":")),
                    session_id,
                    deposit_item_id,
                    occurred_at,
                ),
            )
        return event_id

    def pending(self, limit: int) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM outbox WHERE sent_at IS NULL AND next_attempt_at<=? "
                "ORDER BY id LIMIT ?",
                (time.time(), limit),
            ).fetchall()
        return [
            {
                "db_id": row["id"],
                "localEventId": row["local_event_id"],
                "eventType": row["event_type"],
                "payload": json.loads(row["payload_json"]),
                "sessionId": row["session_id"],
                "depositItemId": row["deposit_item_id"],
                "occurredAt": row["occurred_at"],
                "attempts": row["attempts"],
            }
            for row in rows
        ]

    def mark_sent(self, db_ids: list[int]) -> None:
        if not db_ids:
            return
        marks = ",".join("?" for _ in db_ids)
        with self._lock, self._conn:
            self._conn.execute(
                f"UPDATE outbox SET sent_at=?,last_error=NULL WHERE id IN ({marks})",
                (time.time(), *db_ids),
            )

    def mark_failed(self, db_ids: list[int], error: str) -> None:
        if not db_ids:
            return
        with self._lock, self._conn:
            for db_id in db_ids:
                row = self._conn.execute(
                    "SELECT attempts FROM outbox WHERE id=?", (db_id,)
                ).fetchone()
                attempts = int(row["attempts"] if row else 0) + 1
                delay = min(300, 2 ** min(attempts, 8))
                self._conn.execute(
                    "UPDATE outbox SET attempts=?,next_attempt_at=?,last_error=? WHERE id=?",
                    (attempts, time.time() + delay, error[:500], db_id),
                )

    def queue_depth(self) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS count FROM outbox WHERE sent_at IS NULL"
            ).fetchone()
        return int(row["count"])

    def audit(self, action: str, data: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO audit(action,data_json,created_at) VALUES(?,?,?)",
                (action, json.dumps(data, separators=(",", ":")), time.time()),
            )

    def save_lease(self, lease: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO leases"
                "(id,session_id,user_ref,issued_at,expires_at,status,signature)"
                " VALUES(?,?,?,?,?,?,?)",
                (
                    lease["id"],
                    lease["sessionId"],
                    lease.get("userRef"),
                    lease["issuedAt"],
                    lease["expiresAt"],
                    lease["status"],
                    lease["signature"],
                ),
            )

    def active_lease(self) -> dict[str, Any] | None:
        now = time.time()
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM leases WHERE status='ACTIVE' AND expires_at>? "
                "ORDER BY issued_at DESC LIMIT 1",
                (now,),
            ).fetchone()
        return dict(row) if row else None

    def deactivate_leases(self) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE leases SET status='CANCELLED' WHERE status='ACTIVE'"
            )
