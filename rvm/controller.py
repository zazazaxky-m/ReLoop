from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from .camera import CameraWorker
from .config import RvmConfig
from .database import EdgeDatabase
from .hardware import GpioHardware, HardwareAdapter, MockHardware, SensorSnapshot
from .sync import SyncWorker


class MachineState(StrEnum):
    BOOTING = "BOOTING"
    IDLE = "IDLE"
    SESSION_ACTIVE = "SESSION_ACTIVE"
    PROCESSING = "PROCESSING"
    SYNC_PENDING = "SYNC_PENDING"
    FULL = "FULL"
    MAINTENANCE = "MAINTENANCE"
    SAFE_STATE = "SAFE_STATE"
    ERROR = "ERROR"


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class RvmController:
    def __init__(self, config: RvmConfig):
        self.config = config
        self.db = EdgeDatabase(config.database_path)
        self.hardware: HardwareAdapter = (
            MockHardware()
            if config.hardware_driver == "mock"
            else GpioHardware(config)
        )
        self.sync = SyncWorker(config, self.db)
        self.state = MachineState(self.db.get_json("machine_state", MachineState.BOOTING))
        self.running = False
        self._lock = threading.RLock()
        self._loop: threading.Thread | None = None
        self._lease_thread: threading.Thread | None = None
        self._last = SensorSnapshot()
        self._last_heartbeat = 0.0
        self._last_lease_poll = 0.0
        self._last_display_poll = 0.0
        self._processing_started_at: float | None = None
        self._weight_reported = False
        self._maintenance_tokens: dict[str, float] = {}
        self._simulation_thread: threading.Thread | None = None
        self._simulation_name: str | None = None
        self._simulation_error: str | None = None
        self.camera = CameraWorker(
            config.camera_enabled,
            config.camera_index,
            config.camera_evidence_dir,
            config.camera_occlusion_brightness,
            config.camera_blur_threshold,
            config.camera_classifier_model,
            config.camera_classifier_labels,
            config.camera_classifier_input_size,
            self._camera_alert,
        )

    def start(self) -> None:
        self.running = True
        self.set_state(MachineState.IDLE, "startup")
        self.hardware.all_stop()
        self.sync.start()
        self.camera.start()
        self._loop = threading.Thread(target=self._run, daemon=True, name="rvm-control")
        self._loop.start()
        self._lease_thread = threading.Thread(
            target=self._lease_loop, daemon=True, name="rvm-session-bridge"
        )
        self._lease_thread.start()
        self.emit("HEARTBEAT", self.heartbeat_payload())

    def stop(self) -> None:
        self.running = False
        self.hardware.all_stop()
        self.camera.stop()
        self.sync.stop()
        if self._loop:
            self._loop.join(timeout=3)
        if self._lease_thread:
            self._lease_thread.join(timeout=4)
        self.db.close()

    def _run(self) -> None:
        while self.running:
            try:
                snapshot = self.hardware.read()
                self._process_sensors(snapshot)
                self._last = snapshot
                self._expire_lease()
                if (
                    self.state == MachineState.PROCESSING
                    and self._processing_started_at
                    and time.time() - self._processing_started_at
                    > self.config.chamber_timeout_seconds
                ):
                    self.report_fraud("CHAMBER_PROCESS_TIMEOUT", {})
                    self.set_state(MachineState.SESSION_ACTIVE, "item-timeout")
                    self.hardware.set_conveyor("STOPPED")
                if time.time() - self._last_heartbeat >= self.config.heartbeat_seconds:
                    self.emit("HEARTBEAT", self.heartbeat_payload(snapshot))
                    self._last_heartbeat = time.time()
            except Exception as exc:
                self.enter_safe_state("CONTROL_LOOP_ERROR", {"error": str(exc)})
            time.sleep(0.05)

    def _lease_loop(self) -> None:
        while self.running:
            if self.state == MachineState.IDLE:
                self._last_lease_poll = time.time()
                lease = self.sync.fetch_active_lease()
                if lease:
                    self.activate_lease(lease)
                elif time.time() - self._last_display_poll >= 10:
                    self._last_display_poll = time.time()
                    display = self.sync.fetch_display()
                    if display:
                        self.db.set_json(
                            "display",
                            {
                                "qrDataUrl": display.get("qrDataUrl"),
                                "expiresAt": display.get("expiresAt"),
                                "status": display.get("status"),
                                "updatedAt": time.time(),
                            },
                        )
            time.sleep(3)

    def _process_sensors(self, current: SensorSnapshot) -> None:
        if current.chamber_open and not self._last.chamber_open:
            if self.state != MachineState.SESSION_ACTIVE:
                self.report_fraud("CHAMBER_OPEN_WITHOUT_SESSION", {})
            else:
                self.emit("CHAMBER_OPENED", {"doorSensor": "OPEN"}, self.session_id())
        if current.service_panel_open and not self._last.service_panel_open:
            self.enter_safe_state("SERVICE_PANEL_FORCED_OPEN", {})
        if current.collection_door_open and not self._last.collection_door_open:
            self.enter_safe_state("COLLECTION_DOOR_FORCED_OPEN", {})
        if current.vibration_g >= self.config.vibration_threshold_g:
            self.enter_safe_state("HIGH_IMPACT_DETECTED", {"vibrationG": current.vibration_g})
        if current.camera_occluded and not self._last.camera_occluded:
            self.enter_safe_state("CAMERA_OCCLUDED", {})
        if self._last.camera_online and not current.camera_online:
            self.enter_safe_state("CAMERA_OFFLINE", {})
        if current.camera_blurry and not self._last.camera_blurry:
            self.emit("ERROR", {"reason": "CAMERA_BLURRY"})
        if current.reverse_motion and not self._last.reverse_motion:
            self.report_fraud("REVERSE_MOTION", {"retrievalAttempt": True})
        if current.fill_percent >= self.config.max_fill_percent and self.state != MachineState.FULL:
            self.set_state(MachineState.FULL, "capacity")
            self.hardware.all_stop()
            self.emit("STATUS_CHANGED", {"status": "FULL"})
        if current.item_present and not self._last.item_present:
            if self.state != MachineState.SESSION_ACTIVE:
                self.report_fraud("ITEM_WITHOUT_ACTIVE_SESSION", {})
            else:
                self.set_state(MachineState.PROCESSING, "item-present")
                self._processing_started_at = time.time()
                self._weight_reported = False
                self.hardware.set_input_gate(False)
                self.emit("ITEM_DETECTED", {"inputBeam": True}, self.session_id())
                self.emit("IMAGE_CLASSIFIED", self.camera.classify(), self.session_id())
        if (
            self.state == MachineState.PROCESSING
            and current.weight_stable
            and current.weight_grams > 0
            and not self._weight_reported
        ):
            if not (
                self.config.min_item_weight_grams
                <= current.weight_grams
                <= self.config.max_item_weight_grams
            ):
                self.report_fraud(
                    "ABNORMAL_ITEM_WEIGHT",
                    {
                        "weightGrams": current.weight_grams,
                        "min": self.config.min_item_weight_grams,
                        "max": self.config.max_item_weight_grams,
                    },
                )
            self.emit(
                "WEIGHT_MEASURED",
                {"weightGrams": current.weight_grams, "stable": True},
                self.session_id(),
            )
            self._weight_reported = True
        if current.acceptance_triggered and not self._last.acceptance_triggered:
            if self.state != MachineState.PROCESSING:
                self.report_fraud("IMPOSSIBLE_ACCEPTANCE_SEQUENCE", {})
            else:
                self.hardware.set_conveyor("FORWARD")
                self.emit("ITEM_ACCEPTED_POINT", {"acceptanceBeam": True}, self.session_id())
                self.hardware.set_conveyor("STOPPED")
                self.hardware.set_compactor(True)
                time.sleep(0.15)
                self.hardware.set_compactor(False)
                self._processing_started_at = None
                self.set_state(MachineState.SESSION_ACTIVE, "item-accepted")

    def heartbeat_payload(self, snapshot: SensorSnapshot | None = None) -> dict:
        sensor = snapshot or self.hardware.read()
        server_status = "ERROR" if self.state in {MachineState.ERROR, MachineState.SAFE_STATE} else (
            "FULL" if self.state == MachineState.FULL else "ONLINE"
        )
        return {
            "status": server_status,
            "runtimeState": self.state,
            "fillLevelPercent": sensor.fill_percent,
            "temperatureC": sensor.temperature_c,
            "cameraOnline": self.camera.status.online if self.config.camera_enabled else sensor.camera_online,
            "queueDepth": self.db.queue_depth(),
        }

    def emit(
        self,
        event_type: str,
        payload: dict[str, Any],
        session_id: str | None = None,
        deposit_item_id: str | None = None,
    ) -> str:
        event_id = self.db.enqueue(event_type, payload, iso_now(), session_id, deposit_item_id)
        self.db.audit("EVENT_QUEUED", {"id": event_id, "type": event_type})
        return event_id

    def set_state(self, state: MachineState, reason: str) -> None:
        with self._lock:
            previous = self.state
            self.state = state
            self.db.set_json("machine_state", state)
            self.db.audit("STATE_CHANGED", {"from": previous, "to": state, "reason": reason})

    def enter_safe_state(self, reason: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self.hardware.all_stop()
            if self.state == MachineState.SAFE_STATE and reason == self.db.get_json("safe_reason"):
                return
            self.set_state(MachineState.SAFE_STATE, reason)
            self.db.set_json("safe_reason", reason)
            self.emit("VANDALISM_DETECTED", {"reason": reason, **payload}, self.session_id())
            self.emit(
                "SAFE_STATE_ENTERED",
                {"reason": reason, "outputsDisabled": ["input_gate", "conveyor", "compactor"]},
                self.session_id(),
            )

    def report_fraud(self, reason: str, payload: dict[str, Any]) -> None:
        self.hardware.all_stop()
        self.emit("FRAUD_DETECTED", {"reason": reason, **payload}, self.session_id())

    def _camera_alert(self, reason: str, payload: dict[str, Any]) -> None:
        if reason in {"CAMERA_OCCLUDED", "CAMERA_OFFLINE"}:
            self.enter_safe_state(reason, payload)
        else:
            self.emit("ERROR", {"reason": reason, **payload})

    def verify_lease(self, lease: dict[str, Any]) -> bool:
        required = {"id", "sessionId", "issuedAt", "expiresAt", "signature"}
        if not required.issubset(lease):
            return False
        canonical = ".".join(
            str(lease[key]) for key in ("id", "sessionId", "issuedAt", "expiresAt")
        )
        expected = hmac.new(
            self.config.machine_secret.encode(), canonical.encode(), hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, str(lease["signature"]))

    def activate_lease(self, lease: dict[str, Any]) -> bool:
        if not self.verify_lease(lease) or float(lease["expiresAt"]) <= time.time():
            return False
        lease = {**lease, "status": "ACTIVE"}
        self.db.save_lease(lease)
        self.set_state(MachineState.SESSION_ACTIVE, "lease-activated")
        self.hardware.set_input_gate(True)
        self.emit("CHAMBER_OPENED", {"leaseActivated": True}, lease["sessionId"])
        return True

    def _expire_lease(self) -> None:
        if self.state not in {MachineState.SESSION_ACTIVE, MachineState.PROCESSING}:
            return
        if not self.db.active_lease():
            self.hardware.all_stop()
            self.set_state(MachineState.SYNC_PENDING, "lease-expired")

    def session_id(self) -> str | None:
        lease = self.db.active_lease()
        return str(lease["session_id"]) if lease else None

    def maintenance_login(self, pin: str) -> str | None:
        if not self.config.verify_pin(pin):
            self.db.audit("MAINTENANCE_LOGIN_FAILED", {})
            return None
        token = secrets.token_urlsafe(32)
        self._maintenance_tokens[token] = time.time() + self.config.maintenance_token_ttl_seconds
        self.db.audit("MAINTENANCE_LOGIN", {})
        return token

    def maintenance_authorized(self, token: str | None) -> bool:
        if not token:
            return False
        expires = self._maintenance_tokens.get(token, 0)
        if expires <= time.time():
            self._maintenance_tokens.pop(token, None)
            return False
        return True

    def maintenance_command(self, command: str, data: dict[str, Any]) -> dict:
        hardware = self.hardware
        if command == "reset-safe-state":
            self._reset_mock_state()
        elif command == "gate":
            hardware.set_input_gate(bool(data.get("open")))
        elif command == "conveyor":
            hardware.set_conveyor(str(data.get("direction", "STOPPED")))
        elif command == "compactor":
            hardware.set_compactor(bool(data.get("active")))
        elif command == "flush":
            self.sync.flush_once()
        elif command == "mock-sensors" and isinstance(hardware, MockHardware):
            hardware.patch(**dict(data.get("values", {})))
        elif command == "simulate":
            self.start_simulation(str(data.get("scenario", "")))
        else:
            raise ValueError("Command maintenance tidak dikenal")
        self.db.audit("MAINTENANCE_COMMAND", {"command": command, "data": data})
        return self.public_state()

    def _reset_mock_state(self) -> None:
        self.db.set_json("safe_reason", None)
        self.db.deactivate_leases()
        self.hardware.all_stop()
        if isinstance(self.hardware, MockHardware):
            self.hardware.patch(
                chamber_open=False,
                item_present=False,
                acceptance_triggered=False,
                reverse_motion=False,
                weight_grams=0,
                weight_stable=False,
                fill_percent=20,
                service_panel_open=False,
                collection_door_open=False,
                vibration_g=0.02,
                camera_online=True,
                camera_occluded=False,
                camera_blurry=False,
            )
            self._last = self.hardware.read()
        self._processing_started_at = None
        self.set_state(MachineState.IDLE, "maintenance-reset")
        self.emit("STATUS_CHANGED", {"status": "ONLINE", "source": "maintenance"})

    def _simulation_lease(self, seconds: int = 180) -> None:
        now = time.time()
        lease = {
            "id": str(uuid.uuid4()),
            "sessionId": f"interactive-{uuid.uuid4()}",
            "userRef": "interactive-simulator",
            "issuedAt": now,
            "expiresAt": now + seconds,
        }
        canonical = ".".join(
            str(lease[key]) for key in ("id", "sessionId", "issuedAt", "expiresAt")
        )
        lease["signature"] = hmac.new(
            self.config.machine_secret.encode(),
            canonical.encode(),
            hashlib.sha256,
        ).hexdigest()
        if not self.activate_lease(lease):
            raise RuntimeError("Gagal membuat sesi simulasi")

    def _simulation_patch(self, pause: float = 0.18, **values: Any) -> None:
        hardware = self.hardware
        if not isinstance(hardware, MockHardware):
            raise ValueError("Simulator hanya tersedia untuk hardware mock")
        hardware.patch(**values)
        time.sleep(pause)

    def _simulation_pulse(self, sensor: str, duration: float = 0.22) -> None:
        self._simulation_patch(**{sensor: True})
        self._simulation_patch(duration, **{sensor: False})

    def start_simulation(self, scenario: str) -> None:
        if not isinstance(self.hardware, MockHardware):
            raise ValueError("Simulator interaktif hanya tersedia pada hardware_driver mock")
        allowed = {
            "normal-bottle",
            "normal-can",
            "string-pull",
            "acceptance-without-item",
            "abnormal-weight",
            "item-without-session",
            "vandalism-impact",
            "panel-forced",
            "door-forced",
            "camera-covered",
            "camera-offline",
            "machine-full",
        }
        if scenario not in allowed:
            raise ValueError("Skenario simulator tidak dikenal")
        if self._simulation_thread and self._simulation_thread.is_alive():
            raise ValueError("Skenario lain masih berjalan")
        self._simulation_name = scenario
        self._simulation_error = None
        self._simulation_thread = threading.Thread(
            target=self._run_simulation,
            args=(scenario,),
            daemon=True,
            name="rvm-interactive-simulator",
        )
        self._simulation_thread.start()

    def _run_simulation(self, scenario: str) -> None:
        try:
            self._reset_mock_state()
            if scenario in {"normal-bottle", "normal-can", "string-pull", "abnormal-weight"}:
                self._simulation_lease()
                self._simulation_patch(chamber_open=True)
                self._simulation_pulse("item_present")
                weight = {
                    "normal-bottle": 22.4,
                    "normal-can": 15.1,
                    "string-pull": 23.0,
                    "abnormal-weight": 900.0,
                }[scenario]
                self._simulation_patch(weight_grams=weight, weight_stable=True)
                if scenario != "abnormal-weight":
                    self._simulation_pulse("acceptance_triggered")
                if scenario == "string-pull":
                    self._simulation_pulse("reverse_motion")
                self._simulation_patch(
                    chamber_open=False,
                    weight_grams=0,
                    weight_stable=False,
                    fill_percent=21,
                )
            elif scenario == "acceptance-without-item":
                self._simulation_lease()
                self._simulation_pulse("acceptance_triggered")
            elif scenario == "item-without-session":
                self._simulation_pulse("item_present")
            elif scenario == "vandalism-impact":
                self._simulation_patch(vibration_g=4.8)
            elif scenario == "panel-forced":
                self._simulation_patch(service_panel_open=True)
            elif scenario == "door-forced":
                self._simulation_patch(collection_door_open=True)
            elif scenario == "camera-covered":
                self._simulation_patch(camera_online=True, camera_occluded=True)
            elif scenario == "camera-offline":
                self._simulation_patch(camera_online=False)
            elif scenario == "machine-full":
                self._simulation_patch(fill_percent=98)
        except Exception as exc:
            self._simulation_error = str(exc)
        finally:
            self._simulation_name = None

    def public_state(self) -> dict[str, Any]:
        sensor = self.hardware.read()
        display = self.db.get_json("display", {})
        display_valid = bool(
            self.sync.online
            and display.get("qrDataUrl")
            and display.get("expiresAt")
        )
        return {
            **self.config.public_dict(),
            "runtimeState": self.state,
            "serverStatus": self.sync.status(),
            "sensors": sensor.to_dict(),
            "camera": {
                "online": self.camera.status.online,
                "occluded": self.camera.status.occluded,
                "blurry": self.camera.status.blurry,
            },
            "activeSession": bool(self.db.active_lease()),
            "safeReason": self.db.get_json("safe_reason"),
            "simulation": {
                "running": bool(
                    self._simulation_thread and self._simulation_thread.is_alive()
                ),
                "scenario": self._simulation_name,
                "error": self._simulation_error,
                "available": isinstance(self.hardware, MockHardware),
            },
            "display": display if display_valid else None,
        }
