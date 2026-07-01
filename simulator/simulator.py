#!/usr/bin/env python3
"""
ReLoop machine/sensor simulator.

Architecture:
- Sensor events are queued locally and sent in compact HTTP batches.
- Requests use the existing per-machine HMAC signature.
- Heartbeats are sparse (default 60s) and immediate only on state changes.
- Fraud/vandalism are persisted as machine events; the web app publishes tiny
  WebSocket refresh notifications after the database commit.

Examples:
  python simulator.py -m RLP-001 --secret <SECRET> --daemon
  python simulator.py -m RLP-001 --secret <SECRET> --session <ID> --deposit organik
  python simulator.py -m RLP-001 --secret <SECRET> --session <ID> --fraud string-pull
  python simulator.py -m RLP-001 --secret <SECRET> --vandalism panel-open
  python simulator.py -m RLP-001 --secret <SECRET> --interactive
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import random
import signal
import sys
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    print("Install dependencies: pip install -r requirements.txt")
    sys.exit(1)

DEFAULT_BASE = os.environ.get("RELOOP_BASE_URL", "http://localhost:3000")
DEFAULT_SECRET = os.environ.get("MACHINE_INGEST_SECRET", "")

WASTE_TYPES = {
    "organik": {
        "name": "Organik",
        "weight_mean": 22.0,
        "weight_sigma": 2.5,
        "ai": "bottle_pet",
        "barcode": "8991002100012",
    },
    "anorganik": {
        "name": "Anorganik",
        "weight_mean": 15.0,
        "weight_sigma": 1.8,
        "ai": "can_aluminium",
        "barcode": "8991002200019",
    },
}

WASTE_TYPE_ALIASES = {
    "botol": "organik",
    "kaleng": "anorganik",
    "organik": "organik",
    "anorganik": "anorganik",
}


def canonical_waste_type(kind: str) -> str | None:
    return WASTE_TYPE_ALIASES.get(kind.strip().lower())


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def event(event_type: str, payload: dict[str, Any] | None = None,
          session_id: str | None = None,
          deposit_item_id: str | None = None) -> dict[str, Any]:
    return {
        "localEventId": str(uuid.uuid4()),
        "eventType": event_type,
        "payload": payload or {},
        "sessionId": session_id,
        "depositItemId": deposit_item_id,
        "occurredAt": iso_now(),
    }


@dataclass
class SensorState:
    status: str = "ONLINE"
    fill_level_percent: int = 20
    chamber_open: bool = False
    input_beam_blocked: bool = False
    acceptance_beam_blocked: bool = False
    conveyor_direction: str = "STOPPED"
    load_cell_grams: float = 0.0
    door_locked: bool = True
    service_panel_open: bool = False
    vibration_g: float = 0.02
    camera_online: bool = True
    ambient_temp_c: float = 29.0


class EventBuffer:
    def __init__(self, base_url: str, machine_code: str, secret: str,
                 queue_path: Path, batch_size: int = 20):
        self.base_url = base_url.rstrip("/")
        self.machine_code = machine_code
        self.secret = secret
        self.queue_path = queue_path
        self.batch_size = max(1, min(batch_size, 50))
        self.events: list[dict[str, Any]] = []
        self.upstream_online = False
        self.last_sync_at: str | None = None
        self.last_error: str | None = None
        self._load()

    def _load(self) -> None:
        if not self.queue_path.exists():
            return
        try:
            saved = json.loads(self.queue_path.read_text(encoding="utf-8"))
            if isinstance(saved, list):
                self.events = saved[:1000]
        except (OSError, json.JSONDecodeError):
            self.events = []

    def _persist(self) -> None:
        self.queue_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.queue_path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.events, separators=(",", ":")), encoding="utf-8")
        temp.replace(self.queue_path)

    def add(self, item: dict[str, Any], urgent: bool = False) -> None:
        self.events.append(item)
        self._persist()
        if urgent or len(self.events) >= self.batch_size:
            self.flush()

    def _headers(self, raw: str) -> dict[str, str]:
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex
        signature = hmac.new(
            self.secret.encode("utf-8"),
            f"{timestamp}.{nonce}.{raw}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return {
            "Content-Type": "application/json",
            "x-reloop-machine": self.machine_code,
            "x-reloop-timestamp": timestamp,
            "x-reloop-nonce": nonce,
            "x-reloop-signature": signature,
        }

    def flush(self) -> bool:
        if not self.events:
            return True
        batch = self.events[:self.batch_size]
        body = {"machineCode": self.machine_code, "events": batch}
        raw = json.dumps(body, separators=(",", ":"))
        try:
            response = requests.post(
                f"{self.base_url}/api/machine-events",
                data=raw,
                headers=self._headers(raw),
                timeout=(2, 4),
            )
            if response.ok:
                self.events = self.events[len(batch):]
                self._persist()
                data = response.json()
                self.upstream_online = True
                self.last_sync_at = iso_now()
                self.last_error = None
                print(
                    f"[batch] sent={data.get('accepted', len(batch))} "
                    f"duplicates={data.get('duplicates', 0)} queued={len(self.events)}"
                )
                return True
            self.upstream_online = False
            self.last_error = f"HTTP {response.status_code}"
            print(f"[batch] HTTP {response.status_code}: {response.text[:300]}")
        except requests.RequestException as exc:
            self.upstream_online = False
            self.last_error = str(exc)
            print(f"[batch] offline, retained locally: {exc}")
        return False


class MachineSimulator:
    def __init__(self, args: argparse.Namespace):
        queue = Path(args.queue_file or f".reloop-{args.machine}-queue.json")
        self.args = args
        self.state_path = Path(args.state_file or f".reloop-{args.machine}-state.json")
        self.state = self._load_state(args.fill)
        self.buffer = EventBuffer(
            args.base_url, args.machine, args.secret, queue, args.batch_size
        )
        self.running = True
        self.last_heartbeat = 0.0
        self.last_snapshot: dict[str, Any] | None = None
        self.last_local_event: dict[str, Any] | None = None
        self.local_server: ThreadingHTTPServer | None = None

    def _load_state(self, default_fill: int) -> SensorState:
        if self.state_path.exists():
            try:
                data = json.loads(self.state_path.read_text(encoding="utf-8"))
                allowed = SensorState.__dataclass_fields__.keys()
                return SensorState(**{key: data[key] for key in allowed if key in data})
            except (OSError, TypeError, ValueError, json.JSONDecodeError):
                pass
        return SensorState(fill_level_percent=default_fill)

    def persist_state(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.state_path.with_suffix(".tmp")
        temp.write_text(json.dumps(asdict(self.state), separators=(",", ":")), encoding="utf-8")
        temp.replace(self.state_path)

    def emit(self, event_type: str, payload: dict[str, Any] | None = None,
             session_id: str | None = None,
             deposit_item_id: str | None = None,
             urgent: bool = False) -> None:
        item = event(event_type, payload, session_id, deposit_item_id)
        self.last_local_event = item
        self.buffer.add(item, urgent=urgent)

    def local_state(self) -> dict[str, Any]:
        self.persist_state()
        return {
            "machineCode": self.args.machine,
            "sensors": asdict(self.state),
            "queueDepth": len(self.buffer.events),
            "upstreamOnline": self.buffer.upstream_online,
            "lastSyncAt": self.buffer.last_sync_at,
            "lastError": self.buffer.last_error,
            "lastEvent": self.last_local_event,
            "localTime": iso_now(),
            "mode": "OFFLINE_READY",
        }

    def local_command(self, data: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        command = str(data.get("command", "")).strip()
        session_id = str(data.get("sessionId", "")).strip() or None

        if command == "heartbeat":
            self.heartbeat(force=True)
        elif command == "flush":
            self.buffer.flush()
        elif command == "deposit":
            kind = canonical_waste_type(str(data.get("kind", "organik")))
            if kind is None:
                return 422, {"error": "Jenis material tidak dikenal"}
            if not session_id:
                # Local offline inspection mode: sensors still execute and all
                # hardware telemetry is queued, but reward settlement requires
                # a centrally issued session ID.
                self.emit("CHAMBER_OPENED", {"doorSensor": "OPEN", "offline": True})
                self.emit("ITEM_DETECTED", {
                    "wasteTypeKey": kind,
                    "quantity": 1,
                    "offline": True,
                    "rewardDeferred": True,
                })
                self.emit("SENSOR_SEQUENCE", {
                    "steps": [
                        "CHAMBER_OPEN",
                        "ITEM_PRESENT",
                        "WEIGHT_STABLE",
                        "IMAGE_CAPTURED",
                    ],
                    "offline": True,
                })
                self.buffer.flush()
            else:
                self.simulate_deposit(kind, session_id)
        elif command == "fraud":
            self.report_fraud(str(data.get("reason", "string-pull")), session_id)
        elif command == "vandalism":
            self.report_vandalism(str(data.get("reason", "impact")))
        elif command == "reset-safe-state":
            self.state.status = "ONLINE"
            self.state.service_panel_open = False
            self.state.vibration_g = 0.02
            self.emit("STATUS_CHANGED", {"status": "ONLINE", "source": "local-maintenance"}, urgent=True)
            self.heartbeat(force=True)
        else:
            return 422, {"error": "Command tidak dikenal"}

        return 200, {"ok": True, "state": self.local_state()}

    def start_local_kiosk(self) -> None:
        simulator = self
        html_path = Path(__file__).resolve().parent.parent / "kiosk" / "offline" / "index.html"
        if not html_path.exists():
            raise RuntimeError(f"Offline kiosk asset tidak ditemukan: {html_path}")

        class Handler(BaseHTTPRequestHandler):
            def _json(self, status: int, payload: dict[str, Any]) -> None:
                raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self) -> None:  # noqa: N802
                route = urlparse(self.path).path
                if route == "/api/state":
                    self._json(200, simulator.local_state())
                    return
                if route in {"/", "/index.html"}:
                    raw = html_path.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                self.send_error(404)

            def do_POST(self) -> None:  # noqa: N802
                if urlparse(self.path).path != "/api/command":
                    self.send_error(404)
                    return
                try:
                    size = min(int(self.headers.get("Content-Length", "0")), 16_384)
                    data = json.loads(self.rfile.read(size) or b"{}")
                    command = str(data.get("command", ""))
                    allowed = {
                        "heartbeat", "flush", "deposit", "fraud",
                        "vandalism", "reset-safe-state",
                    }
                    if command not in allowed:
                        self._json(422, {"error": "Command tidak dikenal"})
                        return
                    threading.Thread(
                        target=simulator.local_command,
                        args=(data,),
                        daemon=True,
                    ).start()
                    self._json(202, {"ok": True, "accepted": command})
                except (ValueError, json.JSONDecodeError):
                    self._json(400, {"error": "Body JSON tidak valid"})

            def log_message(self, fmt: str, *args: Any) -> None:
                if simulator.args.local_http_log:
                    super().log_message(fmt, *args)

        self.local_server = ThreadingHTTPServer(
            (self.args.local_host, self.args.local_port), Handler
        )
        thread = threading.Thread(
            target=self.local_server.serve_forever,
            name="reloop-local-kiosk",
            daemon=True,
        )
        thread.start()
        print(
            f"Local kiosk: http://{self.args.local_host}:{self.args.local_port} "
            f"(works without upstream internet)"
        )

    def heartbeat(self, force: bool = False) -> None:
        snapshot = {
            "status": self.state.status,
            "fillLevelPercent": self.state.fill_level_percent,
            "temperatureC": round(self.state.ambient_temp_c, 1),
            "cameraOnline": self.state.camera_online,
            "doorLocked": self.state.door_locked,
            "servicePanelOpen": self.state.service_panel_open,
        }
        changed = snapshot != self.last_snapshot
        due = time.time() - self.last_heartbeat >= self.args.heartbeat_interval
        if force or changed or due:
            self.emit("HEARTBEAT", snapshot, urgent=changed or force)
            self.last_snapshot = snapshot
            self.last_heartbeat = time.time()

    def simulate_deposit(self, kind: str, session_id: str,
                         fraud: str | None = None,
                         bad_weight: bool = False) -> None:
        kind = canonical_waste_type(kind) or "organik"
        material = WASTE_TYPES[kind]
        self.state.chamber_open = True
        self.emit("CHAMBER_OPENED", {"doorSensor": "OPEN"}, session_id)
        self.state.input_beam_blocked = True
        self.emit(
            "ITEM_DETECTED",
            {"wasteTypeKey": kind, "quantity": 1, "inputBeam": True},
            session_id,
        )
        self.buffer.flush()

        # The server returns item IDs per batch result only after flush. Subsequent
        # events can omit it; server resolves the latest pending item in the session.
        weight = (
            500.0
            if bad_weight
            else max(1.0, random.gauss(material["weight_mean"], material["weight_sigma"]))
        )
        self.state.load_cell_grams = weight
        self.emit("WEIGHT_MEASURED", {
            "weightGrams": round(weight, 2),
            "stable": True,
            "samples": 8,
        }, session_id)
        self.emit("IMAGE_CLASSIFIED", {
            "detectedType": material["ai"],
            "confidence": round(random.uniform(0.88, 0.98), 3),
            "cameraOnline": self.state.camera_online,
        }, session_id)
        self.emit("BARCODE_READ", {"barcode": material["barcode"]}, session_id)

        sequence = {
            "steps": [
                "CHAMBER_OPEN",
                "ITEM_PRESENT",
                "WEIGHT_STABLE",
                "IMAGE_CAPTURED",
                "CONVEYOR_FORWARD",
                "ACCEPTANCE_POINT",
            ],
            "reverseMotion": fraud == "string-pull",
            "retrievalAttempt": fraud == "string-pull",
            "impossibleSequence": fraud == "sensor-bypass",
        }
        self.emit("SENSOR_SEQUENCE", sequence, session_id)

        if fraud:
            self.report_fraud(fraud, session_id)
            self.state.chamber_open = False
            self.buffer.flush()
            return

        self.state.conveyor_direction = "FORWARD"
        self.emit("CONVEYOR_STARTED", {"direction": "FORWARD"}, session_id)
        self.state.acceptance_beam_blocked = True
        self.emit("ITEM_ACCEPTED_POINT", {
            "acceptanceBeam": True,
            "oneWayFlapClosed": True,
        }, session_id)
        self.emit("COMPACTION_STARTED", {"motorCurrentAmp": 2.1}, session_id)
        self.emit("COMPACTION_COMPLETED", {"durationMs": 1350}, session_id)
        self.state.fill_level_percent = min(100, self.state.fill_level_percent + 1)
        self.emit("FILL_LEVEL_UPDATED", {
            "fillLevelPercent": self.state.fill_level_percent
        })
        self.state.chamber_open = False
        self.state.input_beam_blocked = False
        self.state.acceptance_beam_blocked = False
        self.state.conveyor_direction = "STOPPED"
        self.state.load_cell_grams = 0.0
        self.persist_state()
        self.buffer.flush()

    def report_fraud(self, reason: str, session_id: str | None = None) -> None:
        payloads = {
            "string-pull": {
                "reason": "STRING_PULL_RETRIEVAL",
                "reverseMotion": True,
                "acceptanceBeamTriggeredTwice": True,
                "cameraConfidence": 0.96,
            },
            "sensor-bypass": {
                "reason": "IMPOSSIBLE_SENSOR_SEQUENCE",
                "inputBeam": False,
                "acceptanceBeam": True,
                "cameraConfidence": 0.91,
            },
            "duplicate-item": {
                "reason": "DUPLICATE_VISUAL_FINGERPRINT",
                "fingerprintMatch": 0.98,
            },
        }
        self.emit(
            "FRAUD_DETECTED",
            payloads.get(reason, {"reason": reason}),
            session_id,
            urgent=True,
        )

    def report_vandalism(self, reason: str) -> None:
        payloads = {
            "panel-open": {
                "reason": "SERVICE_PANEL_FORCED_OPEN",
                "panelOpen": True,
                "authorizedMaintenance": False,
            },
            "impact": {
                "reason": "HIGH_IMPACT_DETECTED",
                "vibrationG": round(random.uniform(2.5, 5.5), 2),
                "cameraConfidence": 0.94,
            },
            "camera-covered": {
                "reason": "EXTERNAL_CAMERA_OCCLUDED",
                "cameraOnline": True,
                "visibleAreaPercent": 4,
            },
            "door-forced": {
                "reason": "COLLECTION_DOOR_FORCED",
                "doorLocked": True,
                "doorContact": "OPEN",
            },
        }
        self.state.status = "ERROR"
        self.persist_state()
        self.emit(
            "VANDALISM_DETECTED",
            payloads.get(reason, {"reason": reason}),
            urgent=True,
        )
        self.emit("SAFE_STATE_ENTERED", {
            "reason": reason,
            "outputsDisabled": ["conveyor", "compactor", "input_gate"],
        }, urgent=True)
        self.heartbeat(force=True)

    def daemon(self) -> None:
        print(
            f"Daemon machine={self.args.machine} heartbeat={self.args.heartbeat_interval}s "
            f"batch={self.args.batch_size}"
        )
        if self.args.local_kiosk:
            self.start_local_kiosk()
        self.heartbeat(force=True)
        next_random = time.time() + self.args.random_event_interval
        while self.running:
            self.state.ambient_temp_c += random.uniform(-0.05, 0.05)
            self.persist_state()
            self.heartbeat()
            if self.args.random_events and time.time() >= next_random:
                roll = random.random()
                if roll < 0.08:
                    self.report_vandalism(random.choice(["impact", "camera-covered"]))
                elif roll < 0.18:
                    self.report_fraud(random.choice(["sensor-bypass", "duplicate-item"]))
                else:
                    self.state.fill_level_percent = min(
                        100, self.state.fill_level_percent + random.randint(0, 2)
                    )
                next_random = time.time() + self.args.random_event_interval
            self.buffer.flush()
            time.sleep(2)
        self.buffer.flush()
        if self.local_server:
            self.local_server.shutdown()

    def interactive(self) -> None:
        while True:
            print("\n1 Heartbeat  2 Organik  3 Anorganik  4 Fraud string-pull")
            print("5 Fraud sensor-bypass  6 Vandalisme panel  7 Impact  8 Flush  0 Keluar")
            choice = input("> ").strip()
            if choice == "0":
                self.buffer.flush()
                return
            if choice == "1":
                self.heartbeat(force=True)
            elif choice in {"2", "3"}:
                session = input("Session ID: ").strip()
                self.simulate_deposit("organik" if choice == "2" else "anorganik", session)
            elif choice == "4":
                session = input("Session ID (boleh kosong): ").strip() or None
                self.report_fraud("string-pull", session)
            elif choice == "5":
                session = input("Session ID (boleh kosong): ").strip() or None
                self.report_fraud("sensor-bypass", session)
            elif choice == "6":
                self.report_vandalism("panel-open")
            elif choice == "7":
                self.report_vandalism("impact")
            elif choice == "8":
                self.buffer.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ReLoop machine/sensor simulator")
    parser.add_argument("--machine", "-m", required=True)
    parser.add_argument("--base-url", default=DEFAULT_BASE)
    parser.add_argument("--secret", default=DEFAULT_SECRET)
    parser.add_argument("--session")
    parser.add_argument("--deposit", choices=sorted(WASTE_TYPES))
    parser.add_argument("--fraud", choices=["string-pull", "sensor-bypass", "duplicate-item"])
    parser.add_argument("--vandalism", choices=["panel-open", "impact", "camera-covered", "door-forced"])
    parser.add_argument("--bad-weight", action="store_true")
    parser.add_argument("--heartbeat", action="store_true")
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--interactive", "-i", action="store_true")
    parser.add_argument("--random-events", action="store_true")
    parser.add_argument("--random-event-interval", type=int, default=90)
    parser.add_argument("--heartbeat-interval", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--fill", type=int, default=20)
    parser.add_argument("--queue-file")
    parser.add_argument("--state-file")
    parser.add_argument("--local-kiosk", action="store_true",
                        help="Serve offline kiosk + local sensor API")
    parser.add_argument("--local-host", default="127.0.0.1")
    parser.add_argument("--local-port", type=int, default=8765)
    parser.add_argument("--local-http-log", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.secret:
        print("ERROR: --secret atau MACHINE_INGEST_SECRET wajib diisi.")
        sys.exit(1)

    simulator = MachineSimulator(args)

    def stop(*_: Any) -> None:
        simulator.running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    if args.daemon:
        simulator.daemon()
    elif args.interactive:
        simulator.interactive()
    elif args.vandalism:
        simulator.report_vandalism(args.vandalism)
        simulator.buffer.flush()
    elif args.fraud and not args.deposit:
        simulator.report_fraud(args.fraud, args.session)
        simulator.buffer.flush()
    elif args.deposit:
        if not args.session:
            print("ERROR: --session wajib untuk simulasi deposit.")
            sys.exit(1)
        simulator.simulate_deposit(
            args.deposit,
            args.session,
            fraud=args.fraud,
            bad_weight=args.bad_weight,
        )
    elif args.heartbeat:
        simulator.heartbeat(force=True)
        simulator.buffer.flush()
    else:
        simulator.heartbeat(force=True)
        simulator.buffer.flush()
        print(json.dumps(asdict(simulator.state), indent=2))


if __name__ == "__main__":
    main()
