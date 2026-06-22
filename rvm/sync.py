from __future__ import annotations

import base64
import hashlib
import hmac
import json
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

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
        self._last_media_sync = 0.0

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
            self.flush_captures()
            if time.time() - self._last_media_sync >= self.config.media_sync_seconds:
                self.sync_media()
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
                self.online = True
                self.last_error = None
                return payload.get("command")
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            self.online = False
            self.last_error = str(exc)
            return None

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
        except (urllib.error.URLError, TimeoutError, OSError):
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
            "queueDepth": self.db.queue_depth(),
            "captureQueueDepth": self.db.capture_queue_depth(),
        }
