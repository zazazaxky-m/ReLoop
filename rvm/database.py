from __future__ import annotations

import json
import random
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable


# Outbox delivery states (column `delivery_status`, added by the protocol v2
# upgrade). Only `pending` rows are sent; `dead_letter` rows are kept for the
# operator and never deleted.
PENDING = "pending"
SENT = "sent"
DEAD_LETTER = "dead_letter"

RETRY_BACKOFF_CAP_SECONDS = 60


def retry_delay(attempts: int, rand: Callable[[], float] = random.random) -> float:
    """Seconds until the next delivery attempt after `attempts` failures:
    2**attempts capped at RETRY_BACKOFF_CAP_SECONDS, with equal jitter (half
    to all of the capped value) so a fleet does not retry in lockstep. Never
    exceeds the cap."""
    capped = min(float(RETRY_BACKOFF_CAP_SECONDS), 2.0 ** min(max(attempts, 1), 16))
    return capped / 2 + capped / 2 * min(max(rand(), 0.0), 1.0)


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
  sent_at REAL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','sent','dead_letter')),
  dead_lettered_at REAL
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
CREATE TABLE IF NOT EXISTS capture_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_capture_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  session_id TEXT,
  image_path TEXT NOT NULL,
  face_paths_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at REAL NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at REAL
);
CREATE INDEX IF NOT EXISTS capture_outbox_pending_idx
ON capture_outbox(sent_at, next_attempt_at, id);
"""


# Additive upgrade of an outbox created before protocol v2. Existing columns
# (attempts, next_attempt_at, last_error, sent_at) and every row are kept;
# already-sent rows are backfilled to `sent`, everything else stays `pending`.
OUTBOX_V2_COLUMNS = (
    ("delivery_status",
     "ALTER TABLE outbox ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending' "
     "CHECK (delivery_status IN ('pending','sent','dead_letter'))"),
    ("dead_lettered_at", "ALTER TABLE outbox ADD COLUMN dead_lettered_at REAL"),
)
OUTBOX_V2_INDEXES = (
    "CREATE INDEX IF NOT EXISTS outbox_delivery_idx ON outbox(delivery_status, next_attempt_at, id)",
    "CREATE INDEX IF NOT EXISTS outbox_session_idx ON outbox(session_id, delivery_status, id)",
)


class EdgeDatabase:
    def __init__(self, path: str):
        db_path = Path(path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.path = str(db_path)
        self.backup_path: str | None = None
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
        self._conn.row_factory = sqlite3.Row
        legacy = self._outbox_columns()
        if legacy and "delivery_status" not in legacy:
            # Copy the untouched pre-v2 database aside before any schema change.
            self.backup_path = self._backup("pre-outbox-v2")
        self._conn.executescript(SCHEMA)
        self._upgrade_outbox()

    def _outbox_columns(self) -> set[str]:
        return {row["name"] for row in self._conn.execute("PRAGMA table_info(outbox)")}

    def _backup(self, label: str) -> str:
        """Consistent copy (WAL included) via the SQLite backup API, verified
        before it is trusted. Raises instead of migrating without a backup."""
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        target = Path(f"{self.path}.{label}-{stamp}.bak")
        suffix = 1
        while target.exists():
            target = Path(f"{self.path}.{label}-{stamp}-{suffix}.bak")
            suffix += 1
        copy = sqlite3.connect(str(target))
        try:
            self._conn.backup(copy)
            integrity = copy.execute("PRAGMA integrity_check").fetchone()[0]
            copied = copy.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
        finally:
            copy.close()
        original = self._conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
        if integrity != "ok" or copied != original:
            raise RuntimeError(
                f"Backup outbox {target} tidak valid; upgrade database dibatalkan"
            )
        return str(target)

    def _upgrade_outbox(self) -> None:
        columns = self._outbox_columns()
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                for name, ddl in OUTBOX_V2_COLUMNS:
                    if name not in columns:
                        self._conn.execute(ddl)
                if "delivery_status" not in columns:
                    self._conn.execute(
                        "UPDATE outbox SET delivery_status='sent' WHERE sent_at IS NOT NULL"
                    )
                for ddl in OUTBOX_V2_INDEXES:
                    self._conn.execute(ddl)
                self._conn.execute("COMMIT")
            except BaseException:
                if self._conn.in_transaction:
                    self._conn.execute("ROLLBACK")
                raise

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
        """Due pending events in enqueue order. An event of a deposit session
        is held while an earlier pending event of the same session is still
        backing off: the backend resolves an item event against the session's
        history, so it must arrive in order. Other sessions and session-less
        events are not held, and dead-lettered events hold nothing."""
        now = time.time()
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM outbox o WHERE o.delivery_status='pending' AND o.next_attempt_at<=? "
                "AND (o.session_id IS NULL OR NOT EXISTS ("
                "  SELECT 1 FROM outbox e WHERE e.session_id=o.session_id "
                "  AND e.delivery_status='pending' AND e.id<o.id AND e.next_attempt_at>?)) "
                "ORDER BY o.id LIMIT ?",
                (now, now, limit),
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
        """Durable ACK: only for events the server reported accepted/duplicate."""
        if not db_ids:
            return
        marks = ",".join("?" for _ in db_ids)
        with self._lock, self._conn:
            self._conn.execute(
                f"UPDATE outbox SET sent_at=?,last_error=NULL,delivery_status='{SENT}' "
                f"WHERE id IN ({marks}) AND delivery_status='{PENDING}'",
                (time.time(), *db_ids),
            )

    def mark_failed(self, db_ids: list[int], error: str) -> None:
        """Transient failure: stays pending, retried with the same
        localEventId after retry_delay(attempts)."""
        if not db_ids:
            return
        with self._lock, self._conn:
            for db_id in db_ids:
                row = self._conn.execute(
                    f"SELECT attempts FROM outbox WHERE id=? AND delivery_status='{PENDING}'",
                    (db_id,),
                ).fetchone()
                if not row:
                    continue
                attempts = int(row["attempts"]) + 1
                self._conn.execute(
                    "UPDATE outbox SET attempts=?,next_attempt_at=?,last_error=? WHERE id=?",
                    (attempts, time.time() + retry_delay(attempts), error[:500], db_id),
                )

    def mark_dead_letter(self, ids: list[int], reason: str) -> None:
        """Permanent rejection: the record is kept (payload untouched) for the
        operator and is no longer sent until an authorized retry."""
        if not ids:
            return
        marks = ",".join("?" for _ in ids)
        with self._lock, self._conn:
            self._conn.execute(
                f"UPDATE outbox SET delivery_status='{DEAD_LETTER}',dead_lettered_at=?,"
                f"last_error=?,attempts=attempts+1 WHERE id IN ({marks}) AND delivery_status='{PENDING}'",
                (time.time(), reason[:500], *ids),
            )

    def retry_dead_letters(self, ids: list[int] | None = None) -> list[int]:
        """Requeues dead-lettered events (all, or the given ids) for immediate
        delivery with the same localEventId and payload. Attempts and the last
        error stay as history. Returns the requeued ids."""
        query = f"SELECT id FROM outbox WHERE delivery_status='{DEAD_LETTER}'"
        params: tuple[Any, ...] = ()
        if ids is not None:
            if not ids:
                return []
            query += f" AND id IN ({','.join('?' for _ in ids)})"
            params = tuple(ids)
        with self._lock, self._conn:
            requeued = [int(row["id"]) for row in self._conn.execute(query + " ORDER BY id", params)]
            if requeued:
                marks = ",".join("?" for _ in requeued)
                self._conn.execute(
                    f"UPDATE outbox SET delivery_status='{PENDING}',next_attempt_at=0 "
                    f"WHERE id IN ({marks}) AND delivery_status='{DEAD_LETTER}'",
                    requeued,
                )
        return requeued

    def queue_depth(self) -> int:
        """Events still to deliver (dead letters are counted separately)."""
        return self._count(PENDING)

    def dead_letter_depth(self) -> int:
        return self._count(DEAD_LETTER)

    def _count(self, status: str) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS count FROM outbox WHERE delivery_status=?", (status,)
            ).fetchone()
        return int(row["count"])

    def dead_letters(self, limit: int = 20) -> list[dict[str, Any]]:
        """Operator view of dead-lettered events (metadata only, no payload)."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT id,local_event_id,event_type,occurred_at,attempts,last_error,dead_lettered_at "
                f"FROM outbox WHERE delivery_status='{DEAD_LETTER}' ORDER BY id LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "localEventId": row["local_event_id"],
                "eventType": row["event_type"],
                "occurredAt": row["occurred_at"],
                "attempts": row["attempts"],
                "reason": row["last_error"],
                "deadLetteredAt": row["dead_lettered_at"],
            }
            for row in rows
        ]

    def audit(self, action: str, data: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO audit(action,data_json,created_at) VALUES(?,?,?)",
                (action, json.dumps(data, separators=(",", ":")), time.time()),
            )

    def enqueue_capture(self, capture: dict[str, Any]) -> None:
        metadata = {
            key: value
            for key, value in capture.items()
            if key not in {"id", "kind", "reason", "sessionId", "imagePath", "facePaths", "occurredAt"}
        }
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO capture_outbox"
                "(local_capture_id,kind,reason,session_id,image_path,face_paths_json,metadata_json,occurred_at)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (
                    capture["id"],
                    capture["kind"],
                    capture["reason"],
                    capture.get("sessionId"),
                    capture["imagePath"],
                    json.dumps(capture.get("facePaths", []), separators=(",", ":")),
                    json.dumps(metadata, separators=(",", ":")),
                    capture["occurredAt"],
                ),
            )

    def pending_captures(self, limit: int = 3) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM capture_outbox WHERE sent_at IS NULL AND next_attempt_at<=? "
                "ORDER BY id LIMIT ?",
                (time.time(), limit),
            ).fetchall()
        return [
            {
                "db_id": row["id"],
                "localCaptureId": row["local_capture_id"],
                "kind": row["kind"],
                "reason": row["reason"],
                "sessionId": row["session_id"],
                "imagePath": row["image_path"],
                "facePaths": json.loads(row["face_paths_json"]),
                "metadata": json.loads(row["metadata_json"]),
                "occurredAt": row["occurred_at"],
                "attempts": row["attempts"],
            }
            for row in rows
        ]

    def mark_capture_sent(self, db_id: int) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE capture_outbox SET sent_at=?,last_error=NULL WHERE id=?",
                (time.time(), db_id),
            )

    def mark_capture_failed(self, db_id: int, attempts: int, error: str) -> None:
        attempts += 1
        delay = min(300, 2 ** min(attempts, 8))
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE capture_outbox SET attempts=?,next_attempt_at=?,last_error=? WHERE id=?",
                (attempts, time.time() + delay, error[:500], db_id),
            )

    def capture_queue_depth(self) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS count FROM capture_outbox WHERE sent_at IS NULL"
            ).fetchone()
        return int(row["count"])

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
