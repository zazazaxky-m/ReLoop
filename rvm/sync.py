from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from .config import RvmConfig
from .database import MAX_SERVER_FAILURES, EdgeDatabase
from .lease import LEASE_PROTOCOL_HEADER, LEASE_PROTOCOL_VERSION

logger = logging.getLogger(__name__)

# POST /api/machine-events protocol v2 (tests/fixtures/contracts/machine-events.v2.json).
PROTOCOL_VERSION = 2
ACK_STATUSES = frozenset({"accepted", "duplicate"})
# Backend code for an event held behind an earlier failed event of its session.
SESSION_HELD = "SESSION_HELD"
# A whole-batch rejection that one bad event could cause. The batch is then
# sent one event at a time for a while so that event only holds back itself.
ENVELOPE_REJECTION_STATUSES = frozenset({400, 413, 422})
ISOLATION_SECONDS = 300.0
LAST_SUCCESS_KEY = "sync_last_success_at"
_ERROR_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,63}")


def _error_code(value: Any) -> str:
    """Server error codes are stored and shown as-is only when they look like
    a code; anything else (free text, stack) is replaced."""
    return value if isinstance(value, str) and _ERROR_CODE.fullmatch(value) else "SERVER_ERROR"


class SyncWorker:
    def __init__(self, config: RvmConfig, db: EdgeDatabase):
        self.config = config
        self.db = db
        self.running = False
        self.online = False
        self.last_sync_at: float | None = None
        self.last_error: str | None = None
        # Outbox delivery error only: the 2 s session/display polls reset
        # last_error, so the operator view would never see a stuck event.
        self.outbox_error: str | None = None
        self._thread: threading.Thread | None = None
        self._last_media_sync = 0.0
        self._isolate_until = 0.0

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
            self._guarded("events", self.flush_once)
            self._guarded("captures", self.flush_captures)
            if time.time() - self._last_media_sync >= self.config.media_sync_seconds:
                self._guarded("media", self.sync_media)
            time.sleep(self.config.sync_interval_seconds)

    def _guarded(self, step: str, action) -> None:
        """A failing step never ends the daemon thread: unsent rows stay
        pending and every step runs again on the next iteration."""
        try:
            action()
        except Exception as exc:  # noqa: BLE001 - the sync loop must survive anything
            self.last_error = f"SYNC_LOOP_ERROR({step}): {type(exc).__name__}"
            logger.exception(
                "rvm-sync %s step failed (%s); retrying next iteration", step, type(exc).__name__
            )

    def flush_once(self) -> bool:
        """Sends one batch (one HTTP request, bounded by its 5 s timeout) and
        applies the per-event results. True only when every sent event was
        durably acknowledged (or nothing was due)."""
        # B01b: a session the server closed whose events are all ACKed gets its
        # close watermark queued now (pure SQLite, no network), so it leaves
        # with this batch, after everything it vouches for.
        for mark in self.db.enqueue_close_watermarks():
            logger.info("close watermark queued for session %s (%d events)", mark["sessionId"], mark["eventCount"])
        isolating = time.time() < self._isolate_until
        rows = self.db.pending(1 if isolating else self.config.batch_size)
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
                status = response.status
                answer = response.read() if 200 <= status < 300 else b""
        except urllib.error.HTTPError as exc:
            status, answer = exc.code, b""
            exc.close()
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as exc:
            # Includes a response lost or truncated (IncompleteRead) after the
            # server committed: the retry reuses the localEventId and is
            # answered as duplicate.
            self.online = False
            self.last_error = self.outbox_error = str(exc)
            self.db.mark_failed(ids, self.last_error)
            return False
        if not 200 <= status < 300:
            return self._reject_batch(rows, status)
        self.online = True
        try:
            payload = json.loads(answer)
        except ValueError:
            return self._keep_pending(ids, "MALFORMED_RESPONSE")
        return self.apply_event_results(rows, payload)

    def _reject_batch(self, rows: list[dict], status: int) -> bool:
        """HTTP-level failure: every event stays pending with backoff. Never
        dead-lettered here, because the server (not the event) may be at fault."""
        if status in ENVELOPE_REJECTION_STATUSES and len(rows) > 1:
            self._isolate_until = time.time() + ISOLATION_SECONDS
        self.online = False
        self.last_error = self.outbox_error = f"HTTP_{status}"
        self.db.mark_failed([row["db_id"] for row in rows], self.last_error)
        return False

    def _keep_pending(self, ids: list[int], reason: str) -> bool:
        self.last_error = self.outbox_error = reason
        self.db.mark_failed(ids, reason)
        return False

    @staticmethod
    def _protocol_results(payload: Any, sent: dict[str, int]) -> list[dict] | None:
        """The v2 results, or None when the response as a whole cannot be
        trusted (not v2, wrong shape, a foreign or repeated localEventId).
        Items without a string localEventId are skipped (their events count as
        unanswered); items whose status is not a string are kept as malformed
        (status None). Both stay pending."""
        if not isinstance(payload, dict):
            return None
        version, received, results = (
            payload.get("protocolVersion"), payload.get("received"), payload.get("results"),
        )
        if type(version) is not int or version != PROTOCOL_VERSION:
            return None
        if type(received) is not int or received < 0 or not isinstance(results, list):
            return None
        seen: set[str] = set()
        valid = []
        for item in results:
            if not isinstance(item, dict) or not isinstance(item.get("localEventId"), str):
                continue
            local_id = item["localEventId"]
            if local_id not in sent or local_id in seen:
                return None
            seen.add(local_id)
            valid.append(item if isinstance(item.get("status"), str) else {"localEventId": local_id, "status": None})
        return valid

    def apply_event_results(self, rows: list[dict], payload: dict) -> bool:
        """Applies a protocol v2 response to the rows that were sent. Only
        matched accepted/duplicate results are ACKed (removed from pending);
        an error with `retryable: false` is dead-lettered (kept, not sent
        again); every other error, a missing or malformed item, or a response
        that is not v2 keeps the event pending with backoff. Returns True only
        when the whole batch was durably acknowledged."""
        sent = {row["localEventId"]: row["db_id"] for row in rows}
        results = self._protocol_results(payload, sent)
        if results is None:
            return self._keep_pending(list(sent.values()), "PROTOCOL_MISMATCH")

        acked = {r["localEventId"] for r in results if r.get("status") in ACK_STATUSES}
        ids = [r["db_id"] for r in rows if r["localEventId"] in acked]
        self.db.mark_sent(ids)

        dead: dict[str, list[int]] = {}
        retry: dict[str, list[int]] = {}
        # Transient errors the server reported for the event itself count
        # toward MAX_SERVER_FAILURES; SESSION_HELD only means "waiting behind
        # an earlier event of the session" and never does.
        server_retry: dict[str, list[int]] = {}
        for result in results:
            local_id = result["localEventId"]
            if local_id in acked:
                continue
            if result.get("status") == "error":
                code = _error_code(result.get("error"))
                # Only an explicit `retryable: false` is permanent; a missing
                # or non-boolean flag is transient (compatibility phase).
                if result.get("retryable") is False:
                    target = dead
                elif code == SESSION_HELD:
                    target = retry
                else:
                    target = server_retry
                target.setdefault(code, []).append(sent[local_id])
            else:
                retry.setdefault("MALFORMED_RESULT", []).append(sent[local_id])
        answered = {r["localEventId"] for r in results}
        missing = [db_id for local_id, db_id in sent.items() if local_id not in answered]
        if missing:
            retry.setdefault("MISSING_RESULT", []).extend(missing)
        for code, dead_ids in dead.items():
            self.db.mark_dead_letter(dead_ids, code)
        for code, retry_ids in retry.items():
            self.db.mark_failed(retry_ids, code)
        for code, retry_ids in server_retry.items():
            limited = self.db.mark_failed(retry_ids, code, server_failure=True)
            if limited:
                logger.warning("dead-lettered %d event(s) after %d server failures (%s)",
                               len(limited), MAX_SERVER_FAILURES, code)

        self.online = True
        if ids:
            now = time.time()
            self.last_sync_at = now
            self.db.set_json(LAST_SUCCESS_KEY, now)
        complete = len(ids) == len(rows)
        failures = sorted(set(dead) | set(retry) | set(server_retry))
        self.last_error = self.outbox_error = None if complete else ",".join(failures)
        return complete

    def flush_captures(self) -> bool:
        rows = self.db.pending_captures(2)
        all_sent = True
        for row in rows:
            try:
                scene_path = Path(row["imagePath"])
                face_paths = [Path(value) for value in row["facePaths"]]
                if not scene_path.is_file():
                    raise FileNotFoundError(f"Bukti kamera tidak ditemukan: {scene_path}")
                payload = {
                    "machineCode": self.config.machine_code,
                    "localCaptureId": row["localCaptureId"],
                    "kind": row["kind"],
                    "reason": row["reason"],
                    "sessionId": row["sessionId"],
                    "occurredAt": row["occurredAt"],
                    "metadata": row["metadata"],
                    "sceneBase64": base64.b64encode(scene_path.read_bytes()).decode("ascii"),
                    "facesBase64": [
                        base64.b64encode(path.read_bytes()).decode("ascii")
                        for path in face_paths
                        if path.is_file()
                    ],
                }
                raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                timestamp = str(int(time.time()))
                nonce = uuid.uuid4().hex
                signature = hmac.new(
                    self.config.machine_secret.encode("utf-8"),
                    f"{timestamp}.{nonce}.{raw.decode('utf-8')}".encode("utf-8"),
                    hashlib.sha256,
                ).hexdigest()
                request = urllib.request.Request(
                    f"{self.config.server_url.rstrip('/')}/api/machine-captures",
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
                with urllib.request.urlopen(request, timeout=20) as response:
                    if not 200 <= response.status < 300:
                        raise RuntimeError(f"HTTP {response.status}")
                self.db.mark_capture_sent(row["db_id"])
                self.online = True
                self.last_sync_at = time.time()
                self.last_error = None
            except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as exc:
                all_sent = False
                self.online = False
                self.last_error = str(exc)
                self.db.mark_capture_failed(
                    row["db_id"], row["attempts"], self.last_error
                )
        return all_sent

    def fetch_machine_session(self) -> dict | None:
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
                # B01b: this worker verifies signed reward caps; the server
                # answers with a lease v2 (and refuses money sessions to
                # workers that do not announce it, once funding is enforced).
                LEASE_PROTOCOL_HEADER: str(LEASE_PROTOCOL_VERSION),
            },
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

    def fetch_remote_command(self) -> dict | None:
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex
        signature = hmac.new(
            self.config.machine_secret.encode("utf-8"),
            f"{timestamp}.{nonce}.".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        request = urllib.request.Request(
            f"{self.config.server_url.rstrip('/')}/api/machine-commands/{self.config.machine_code}",
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
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError, ValueError) as exc:
            # ValueError covers truncated/invalid JSON and undecodable bytes.
            self.online = False
            self.last_error = str(exc)
            return None
        self.online = True
        self.last_error = None
        command = payload.get("command") if isinstance(payload, dict) else None
        return command if isinstance(command, dict) else None

    def report_remote_command(
        self,
        command_id: str,
        success: bool,
        result: dict | None = None,
        error: str | None = None,
    ) -> bool:
        body = {"success": success, "result": result or {}}
        if error:
            body["error"] = error
        raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex
        signature = hmac.new(
            self.config.machine_secret.encode("utf-8"),
            f"{timestamp}.{nonce}.{raw.decode('utf-8')}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        request = urllib.request.Request(
            f"{self.config.server_url.rstrip('/')}/api/machine-commands/{self.config.machine_code}/{command_id}/result",
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
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return 200 <= response.status < 300
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError):
            return False

    def _signed_get(self, route: str, timeout: int = 10) -> bytes:
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex
        signature = hmac.new(
            self.config.machine_secret.encode("utf-8"),
            f"{timestamp}.{nonce}.".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        request = urllib.request.Request(
            f"{self.config.server_url.rstrip('/')}{route}",
            method="GET",
            headers={
                "x-reloop-machine": self.config.machine_code,
                "x-reloop-timestamp": timestamp,
                "x-reloop-nonce": nonce,
                "x-reloop-signature": signature,
            },
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError(f"HTTP {response.status}")
            return response.read()

    def sync_media(self) -> bool:
        self._last_media_sync = time.time()
        cache_dir = Path(self.config.media_cache_dir).resolve()
        cache_dir.mkdir(parents=True, exist_ok=True)
        try:
            raw = self._signed_get(
                f"/api/machine-media/manifest/{self.config.machine_code}", timeout=8
            )
            manifest = json.loads(raw or b"{}")
            assets = manifest.get("assets")
            if assets is None:
                assets = manifest.get("items") or []
            items = manifest.get("items") or []

            total_size = sum(int(asset.get("fileSize") or 0) for asset in assets)
            if total_size > self.config.media_max_cache_mb * 1024 * 1024:
                raise RuntimeError("Playlist media melebihi batas cache lokal")
            
            extensions = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm"}
            expected_names = set()
            
            for asset in assets:
                extension = extensions.get(str(asset.get("mimeType")), "")
                if not extension:
                    continue
                filename = f"{asset['id']}{extension}"
                expected_names.add(filename)
                target = cache_dir / filename
                valid_existing = False
                if target.is_file() and target.stat().st_size == int(asset.get("fileSize") or 0):
                    valid_existing = hashlib.sha256(target.read_bytes()).hexdigest() == asset.get("sha256")
                if not valid_existing:
                    data = self._signed_get(str(asset["downloadPath"]), timeout=60)
                    if len(data) != int(asset.get("fileSize") or 0):
                        raise RuntimeError(f"Ukuran media {filename} tidak sesuai")
                    if hashlib.sha256(data).hexdigest() != asset.get("sha256"):
                        raise RuntimeError(f"Checksum media {filename} tidak sesuai")
                    temporary = target.with_suffix(target.suffix + ".tmp")
                    temporary.write_bytes(data)
                    temporary.replace(target)
            
            local_items = []
            for item in items:
                extension = extensions.get(str(item.get("mimeType")), "")
                if extension:
                    filename = f"{item['id']}{extension}"
                    local_items.append({"id": item["id"], "title": item.get("title"), "mediaType": item["mediaType"], "mimeType": item["mimeType"], "durationSeconds": int(item.get("durationSeconds") or 8), "url": f"/media/{filename}"})

            for stale in cache_dir.iterdir():
                if stale.is_file() and stale.name not in expected_names and stale.name != ".gitkeep":
                    stale.unlink(missing_ok=True)
            
            self.db.set_json("media_playlist", {"enabled": bool(manifest.get("enabled")), "version": manifest.get("version", ""), "items": local_items})
            self.online = True
            self.last_sync_at = time.time()
            self.last_error = None
            return True
        except (urllib.error.URLError, TimeoutError, OSError, RuntimeError, json.JSONDecodeError, KeyError, ValueError) as exc:
            self.last_error = f"Sinkronisasi media: {exc}"
            return False

    def fetch_active_lease(self) -> dict | None:
        payload = self.fetch_machine_session()
        return payload.get("lease") if payload else None

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
            "outboxError": self.outbox_error,
            "queueDepth": self.db.queue_depth(),
            "captureQueueDepth": self.db.capture_queue_depth(),
            # Operator view (kiosk maintenance panel, remote REFRESH_STATE).
            "deadLetterDepth": self.db.dead_letter_depth(),
            "lastSuccessAt": self.db.get_json(LAST_SUCCESS_KEY),
            "deadLetters": self.db.dead_letters(20),
        }
