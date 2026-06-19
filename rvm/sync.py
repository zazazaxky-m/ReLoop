from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
import urllib.error
import urllib.request
import uuid

from .config import RvmConfig
from .database import EdgeDatabase


class SyncWorker:
    def __init__(self, config: RvmConfig, db: EdgeDatabase):
        self.config = config
        self.db = db
        self.running = False
        self.online = False
        self.last_sync_at: float | None = None
        self.last_error: str | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self.running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="rvm-sync")
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        while self.running:
            self.flush_once()
            time.sleep(self.config.sync_interval_seconds)

    def flush_once(self) -> bool:
        rows = self.db.pending(self.config.batch_size)
        if not rows:
            return True
        events = [{key: value for key, value in row.items() if key not in {"db_id", "attempts"}} for row in rows]
        body = {"machineCode": self.config.machine_code, "events": events}
        raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex
        signature = hmac.new(
            self.config.machine_secret.encode("utf-8"),
            f"{timestamp}.{nonce}.{raw.decode('utf-8')}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        request = urllib.request.Request(
            f"{self.config.server_url.rstrip('/')}/api/machine-events",
            data=raw,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-reloop-machine": self.config.machine_code,
                "x-reloop-timestamp": timestamp,
                "x-reloop-nonce": nonce,
                "x-reloop-signature": signature,
            },
        )
        ids = [row["db_id"] for row in rows]
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                if 200 <= response.status < 300:
                    self.db.mark_sent(ids)
                    self.online = True
                    self.last_sync_at = time.time()
                    self.last_error = None
                    return True
                raise RuntimeError(f"HTTP {response.status}")
        except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as exc:
            self.online = False
            self.last_error = str(exc)
            self.db.mark_failed(ids, self.last_error)
            return False

    def fetch_active_lease(self) -> dict | None:
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex
        signature = hmac.new(
            self.config.machine_secret.encode("utf-8"),
            f"{timestamp}.{nonce}.".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        request = urllib.request.Request(
            f"{self.config.server_url.rstrip('/')}/api/machine-session/{self.config.machine_code}",
            method="GET",
            headers={
                "x-reloop-machine": self.config.machine_code,
                "x-reloop-timestamp": timestamp,
                "x-reloop-nonce": nonce,
                "x-reloop-signature": signature,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read() or b"{}")
                self.online = True
                self.last_error = None
                return payload.get("lease")
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            self.online = False
            self.last_error = str(exc)
            return None

    def fetch_display(self) -> dict | None:
        request = urllib.request.Request(
            f"{self.config.server_url.rstrip('/')}/api/display/{self.config.machine_code}",
            method="GET",
            headers={"Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read() or b"{}")
                self.online = True
                self.last_error = None
                return payload
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            self.online = False
            self.last_error = str(exc)
            return None

    def status(self) -> dict:
        return {
            "online": self.online,
            "lastSyncAt": self.last_sync_at,
            "lastError": self.last_error,
            "queueDepth": self.db.queue_depth(),
        }
