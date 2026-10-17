from __future__ import annotations

import json
import random
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from .states import iso_now


# Outbox delivery states (column `delivery_status`, added by the protocol v2
# upgrade). Only `pending` rows are sent; `dead_letter` rows are kept for the
# operator and never deleted.
PENDING = "pending"
SENT = "sent"
DEAD_LETTER = "dead_letter"

RETRY_BACKOFF_CAP_SECONDS = 60
# Consecutive server-reported transient errors on one event before it is
# dead-lettered (kept for an operator retry) so its session can move on.
MAX_SERVER_FAILURES = 20


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
  dead_lettered_at REAL,
  server_failures INTEGER NOT NULL DEFAULT 0
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
  signature TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  machine_code TEXT,
  reservation_id TEXT,
  policy_version TEXT,
  ceiling_rupiah INTEGER,
  max_items INTEGER,
  policy_json TEXT
);
CREATE TABLE IF NOT EXISTS session_consumption (
  session_id TEXT PRIMARY KEY,
  consumed_rupiah INTEGER NOT NULL DEFAULT 0,
  consumed_items INTEGER NOT NULL DEFAULT 0,
  started_at REAL NOT NULL,
  closed_at REAL,
  watermark_event_id TEXT,
  updated_at REAL NOT NULL
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
    ("server_failures", "ALTER TABLE outbox ADD COLUMN server_failures INTEGER NOT NULL DEFAULT 0"),
)
OUTBOX_V2_INDEXES = (
    "CREATE INDEX IF NOT EXISTS outbox_delivery_idx ON outbox(delivery_status, next_attempt_at, id)",
    "CREATE INDEX IF NOT EXISTS outbox_session_idx ON outbox(session_id, delivery_status, id)",
)

# Additive upgrade of a lease table created before lease protocol v2 (B01b):
# the signed cap fields are stored next to the lease; existing rows keep
# version 1 and no bound. Same backup-before-DDL pattern as the outbox.
LEASE_V2_COLUMNS = (
    ("version", "ALTER TABLE leases ADD COLUMN version INTEGER NOT NULL DEFAULT 1"),
    ("machine_code", "ALTER TABLE leases ADD COLUMN machine_code TEXT"),
    ("reservation_id", "ALTER TABLE leases ADD COLUMN reservation_id TEXT"),
    ("policy_version", "ALTER TABLE leases ADD COLUMN policy_version TEXT"),
    ("ceiling_rupiah", "ALTER TABLE leases ADD COLUMN ceiling_rupiah INTEGER"),
    ("max_items", "ALTER TABLE leases ADD COLUMN max_items INTEGER"),
    ("policy_json", "ALTER TABLE leases ADD COLUMN policy_json TEXT"),
)

# The close watermark event (B01b): "every event of session S up to
# localEventId N is synced" (lib/machine-events/watermark.ts).
SESSION_CLOSE_WATERMARK = "SESSION_CLOSE_WATERMARK"
SESSION_CONSUMPTION_RETENTION_SECONDS = 30 * 24 * 3600


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
        elif legacy and "server_failures" not in legacy:
            self.backup_path = self._backup("pre-outbox-retry-limit")
        leases = self._table_columns("leases")
        if leases and "version" not in leases:
            # Lease protocol v2 (B01b): the same backup-before-DDL rule.
            self.backup_path = self._backup("pre-lease-v2")
        self._conn.executescript(SCHEMA)
        self._upgrade_outbox()
        self._upgrade_leases()
        self.prune_session_consumption()

    def _table_columns(self, table: str) -> set[str]:
        return {row["name"] for row in self._conn.execute(f"PRAGMA table_info({table})")}

    def _outbox_columns(self) -> set[str]:
        return self._table_columns("outbox")

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

    def _upgrade_leases(self) -> None:
        columns = self._table_columns("leases")
        missing = [ddl for name, ddl in LEASE_V2_COLUMNS if name not in columns]
        if not missing:
            return
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                for ddl in missing:
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
        is held while an earlier event of the same session is still backing
        off, or was dead-lettered at the retry limit (RETRY_LIMIT:*): the
        backend resolves an item event against the session's history, so it
        must arrive in order, and an operator retry then resends the session
        in order. Other sessions and session-less events are not held, and a
        permanent rejection (retryable: false) holds nothing."""
        now = time.time()
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM outbox o WHERE o.delivery_status='pending' AND o.next_attempt_at<=? "
                "AND (o.session_id IS NULL OR NOT EXISTS ("
                "  SELECT 1 FROM outbox e WHERE e.session_id=o.session_id AND e.id<o.id AND ("
                "    (e.delivery_status='pending' AND e.next_attempt_at>?)"
                f"    OR (e.delivery_status='{DEAD_LETTER}' AND e.last_error LIKE 'RETRY_LIMIT:%')))) "
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

    def mark_failed(self, db_ids: list[int], error: str, *, server_failure: bool = False) -> list[int]:
        """Transient failure: stays pending, retried with the same
        localEventId after retry_delay(attempts). A `server_failure` (the
        server answered with an error for this very event) also counts toward
        MAX_SERVER_FAILURES; at the limit the event is dead-lettered with
        reason RETRY_LIMIT:<code>, kept for an operator retry, so it no longer
        holds its session. Network and protocol failures never count. Returns
        the dead-lettered ids."""
        if not db_ids:
            return []
        dead: list[int] = []
        now = time.time()
        with self._lock, self._conn:
            for db_id in db_ids:
                row = self._conn.execute(
                    f"SELECT attempts,server_failures FROM outbox WHERE id=? AND delivery_status='{PENDING}'",
                    (db_id,),
                ).fetchone()
                if not row:
                    continue
                attempts = int(row["attempts"]) + 1
                failures = int(row["server_failures"]) + (1 if server_failure else 0)
                if failures >= MAX_SERVER_FAILURES:
                    self._conn.execute(
                        f"UPDATE outbox SET delivery_status='{DEAD_LETTER}',dead_lettered_at=?,attempts=?,"
                        "server_failures=?,last_error=? WHERE id=?",
                        (now, attempts, failures, f"RETRY_LIMIT:{error}"[:500], db_id),
                    )
                    dead.append(db_id)
                    continue
                self._conn.execute(
                    "UPDATE outbox SET attempts=?,server_failures=?,next_attempt_at=?,last_error=? WHERE id=?",
                    (attempts, failures, now + retry_delay(attempts), error[:500], db_id),
                )
        return dead

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
        error stay as history; the server-failure count starts over. Returns
        the requeued ids."""
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
                    f"UPDATE outbox SET delivery_status='{PENDING}',next_attempt_at=0,server_failures=0 "
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
        """Stores the lease with its signed fields (B01b): a renewal of the
        same session replaces the row; the consumed counter lives in
        `session_consumption`, keyed by session, and is never reset here."""
        with self._lock, self._conn:
            self._write_lease_row(lease)

    def renew_lease(self, lease: dict[str, Any]) -> None:
        """Replaces the session's active lease row with its renewal in one
        transaction: readers never see the session without a lease, and the
        newest row wins even when both were issued in the same second."""
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE leases SET status='CANCELLED' WHERE status='ACTIVE' AND session_id=? AND id<>?",
                (lease["sessionId"], lease["id"]),
            )
            self._write_lease_row(lease)

    def _write_lease_row(self, lease: dict[str, Any]) -> None:
        """Caller holds self._lock inside a `with self._conn` transaction."""
        policy = lease.get("policy")
        self._conn.execute(
            "INSERT OR REPLACE INTO leases"
            "(id,session_id,user_ref,issued_at,expires_at,status,signature,"
            "version,machine_code,reservation_id,policy_version,ceiling_rupiah,max_items,policy_json)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                lease["id"],
                lease["sessionId"],
                lease.get("userRef"),
                lease["issuedAt"],
                lease["expiresAt"],
                lease["status"],
                lease["signature"],
                int(lease.get("version") or 1),
                lease.get("machineCode"),
                lease.get("reservationId"),
                lease.get("policyVersion"),
                lease.get("ceilingRupiah"),
                lease.get("maxItems"),
                json.dumps(policy, separators=(",", ":"), ensure_ascii=False) if policy is not None else None,
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

    # ------------------------------------------------------------------ #
    # session bound and close watermark (B01b)
    # ------------------------------------------------------------------ #
    def ensure_session(self, session_id: str) -> None:
        """The durable per-session counter row (created at the first lease of
        the session, kept across renewals and restarts). A session the server
        hands back while it was marked closed locally (never watermarked)
        runs again."""
        now = time.time()
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO session_consumption(session_id,started_at,updated_at) VALUES(?,?,?)",
                (session_id, now, now),
            )
            self._conn.execute(
                "UPDATE session_consumption SET closed_at=NULL,updated_at=? "
                "WHERE session_id=? AND closed_at IS NOT NULL AND watermark_event_id IS NULL",
                (now, session_id),
            )

    def session_consumption(self, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM session_consumption WHERE session_id=?", (session_id,)
            ).fetchone()
        return dict(row) if row else None

    def enqueue_with_consumption(
        self,
        event_type: str,
        payload: dict[str, Any],
        occurred_at: str,
        session_id: str,
        deposit_item_id: str | None,
        consumed_rupiah: int,
        consumed_items: int = 1,
    ) -> str:
        """Enqueues an acceptance event and advances the session's consumed
        counter in the same SQLite transaction, so a crash in between can never
        leave an accepted item uncounted."""
        event_id = str(uuid.uuid4())
        now = time.time()
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO outbox"
                "(local_event_id,event_type,payload_json,session_id,deposit_item_id,occurred_at)"
                " VALUES(?,?,?,?,?,?)",
                (event_id, event_type, json.dumps(payload, separators=(",", ":")), session_id, deposit_item_id, occurred_at),
            )
            self._conn.execute(
                "INSERT OR IGNORE INTO session_consumption(session_id,started_at,updated_at) VALUES(?,?,?)",
                (session_id, now, now),
            )
            self._conn.execute(
                "UPDATE session_consumption SET consumed_rupiah=consumed_rupiah+?,consumed_items=consumed_items+?,updated_at=? "
                "WHERE session_id=?",
                (int(consumed_rupiah), int(consumed_items), now, session_id),
            )
            self._conn.execute(
                "INSERT INTO audit(action,data_json,created_at) VALUES(?,?,?)",
                ("EVENT_QUEUED", json.dumps({"id": event_id, "type": event_type, "consumedRupiah": int(consumed_rupiah)},
                                            separators=(",", ":")), now),
            )
        return event_id

    def close_sessions_except(self, active_session_id: str | None) -> list[str]:
        """Marks every running session other than the server's current one as
        closed by the server (the watermark follows once its outbox is
        synced). Returns the session ids closed now."""
        now = time.time()
        with self._lock, self._conn:
            rows = self._conn.execute(
                "SELECT session_id FROM session_consumption WHERE closed_at IS NULL AND session_id IS NOT ?",
                (active_session_id,),
            ).fetchall()
            closed = [row["session_id"] for row in rows]
            if closed:
                marks = ",".join("?" for _ in closed)
                self._conn.execute(
                    f"UPDATE session_consumption SET closed_at=?,updated_at=? WHERE session_id IN ({marks})",
                    (now, now, *closed),
                )
        return closed

    def session_outbox_summary(self, session_id: str) -> dict[str, Any]:
        """Delivery state of a session's events (the watermark itself excluded)."""
        with self._lock:
            return self._session_outbox_summary_unlocked(session_id)

    def enqueue_close_watermarks(self) -> list[dict[str, Any]]:
        """For every session the server closed whose events are all durably
        ACKed (nothing pending, nothing dead-lettered), enqueues exactly one
        SESSION_CLOSE_WATERMARK event and records it on the session, in one
        transaction. Called before each flush; a session with a pending or
        dead-lettered event waits (the hold stays on the server)."""
        queued: list[dict[str, Any]] = []
        with self._lock, self._conn:
            rows = self._conn.execute(
                "SELECT * FROM session_consumption WHERE closed_at IS NOT NULL AND watermark_event_id IS NULL ORDER BY closed_at"
            ).fetchall()
            for row in rows:
                session_id = row["session_id"]
                summary = self._session_outbox_summary_unlocked(session_id)
                if summary["pending"] or summary["dead_letter"]:
                    continue
                event_id = str(uuid.uuid4())
                payload = {
                    "eventCount": summary["sent"],
                    "lastLocalEventId": summary["last_sent_local_event_id"],
                    "consumedRupiah": int(row["consumed_rupiah"]),
                    "consumedItems": int(row["consumed_items"]),
                }
                self._conn.execute(
                    "INSERT INTO outbox(local_event_id,event_type,payload_json,session_id,deposit_item_id,occurred_at)"
                    " VALUES(?,?,?,?,?,?)",
                    (event_id, SESSION_CLOSE_WATERMARK, json.dumps(payload, separators=(",", ":")), session_id, None, iso_now()),
                )
                now = time.time()
                self._conn.execute(
                    "UPDATE session_consumption SET watermark_event_id=?,updated_at=? WHERE session_id=?",
                    (event_id, now, session_id),
                )
                self._conn.execute(
                    "INSERT INTO audit(action,data_json,created_at) VALUES(?,?,?)",
                    ("SESSION_CLOSE_WATERMARK_QUEUED",
                     json.dumps({"sessionId": session_id, "localEventId": event_id, **payload}, separators=(",", ":")), now),
                )
                queued.append({"sessionId": session_id, "localEventId": event_id, **payload})
        return queued

    def _session_outbox_summary_unlocked(self, session_id: str) -> dict[str, Any]:
        rows = self._conn.execute(
            "SELECT delivery_status, COUNT(*) AS count FROM outbox "
            "WHERE session_id=? AND event_type<>? GROUP BY delivery_status",
            (session_id, SESSION_CLOSE_WATERMARK),
        ).fetchall()
        last = self._conn.execute(
            f"SELECT local_event_id FROM outbox WHERE session_id=? AND event_type<>? AND delivery_status='{SENT}' "
            "ORDER BY id DESC LIMIT 1",
            (session_id, SESSION_CLOSE_WATERMARK),
        ).fetchone()
        counts = {row["delivery_status"]: int(row["count"]) for row in rows}
        return {
            "pending": counts.get(PENDING, 0),
            "sent": counts.get(SENT, 0),
            "dead_letter": counts.get(DEAD_LETTER, 0),
            "last_sent_local_event_id": last["local_event_id"] if last else None,
        }

    def prune_session_consumption(self, retention_seconds: float = SESSION_CONSUMPTION_RETENTION_SECONDS) -> int:
        """Drops counter rows of sessions whose watermark was queued long ago
        (the outbox keeps the events themselves). Never a running or
        unconfirmed session."""
        cutoff = time.time() - retention_seconds
        with self._lock, self._conn:
            cursor = self._conn.execute(
                "DELETE FROM session_consumption WHERE watermark_event_id IS NOT NULL AND updated_at<?", (cutoff,)
            )
        return int(cursor.rowcount or 0)
