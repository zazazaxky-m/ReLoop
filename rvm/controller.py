from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
from typing import Any

from .camera import CameraWorker
from .config import RvmConfig
from .database import EdgeDatabase
from .fraud import RvmFraudMixin
from .hardware import GpioHardware, HardwareAdapter, MockHardware, SensorSnapshot
from .remote import RvmRemoteMixin
from .simulation import RvmSimulationMixin
from .states import (
    MAINTENANCE_LOCKOUT_SECONDS,
    MAINTENANCE_LOCKOUT_THRESHOLD,
    MachineState,
    SIMULATION_SCENARIOS,
    iso_now,
)
from .sync import SyncWorker


class RvmController(RvmFraudMixin, RvmRemoteMixin, RvmSimulationMixin):
    # States worth resuming as-is after an unclean shutdown (power loss) or
    # a planned service restart, instead of silently forcing IDLE and
    # discarding an in-progress session or unresolved safety condition.
    _RESUMABLE_STATES = frozenset({
        MachineState.SAFE_STATE,
        MachineState.MAINTENANCE,
        MachineState.SESSION_ACTIVE,
        MachineState.FULL,
        MachineState.ERROR,
    })

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
        self._remote_thread: threading.Thread | None = None
        self._last = SensorSnapshot()
        self._last_heartbeat = 0.0
        self._last_lease_poll = 0.0
        self._last_display_poll = 0.0
        self._processing_started_at: float | None = None
        self._weight_reported = False
        self._maintenance_tokens: dict[str, float] = {}
        self._maintenance_failed_attempts = 0
        self._maintenance_lockout_until = 0.0
        self._simulation_thread: threading.Thread | None = None
        self._simulation_name: str | None = None
        self._simulation_error: str | None = None
        self._simulation_result: dict[str, Any] | None = None
        self._simulation_waste_type_key: str | None = None
        self._selected_waste_type_id: str | None = None
        self._sensor_sequence: list[str] = []
        self._server_session: dict[str, Any] | None = None
        self._idle_timeout_minutes: int | None = None
        self._active_alert: dict[str, Any] | None = self.db.get_json("active_alert")
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
            face_detection_enabled=config.camera_face_detection_enabled,
            person_detection_enabled=config.camera_person_detection_enabled,
            jpeg_quality=config.camera_jpeg_quality,
            retention_days=config.camera_retention_days,
            max_local_captures=config.camera_max_local_captures,
            startup_grace_seconds=config.camera_startup_grace_seconds,
            anomaly_frames=config.camera_anomaly_frames,
        )

    def start(self) -> None:
        self.running = True
        self.hardware.all_stop()
        self.sync.start()
        self.camera.start()
        self._recover_state_after_restart()
        self._loop = threading.Thread(target=self._run, daemon=True, name="rvm-control")
        self._loop.start()
        self._lease_thread = threading.Thread(
            target=self._lease_loop, daemon=True, name="rvm-session-bridge"
        )
        self._lease_thread.start()
        self._remote_thread = threading.Thread(
            target=self._remote_loop, daemon=True, name="rvm-remote-control"
        )
        self._remote_thread.start()
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
        if self._remote_thread:
            self._remote_thread.join(timeout=4)
        self.db.close()

    def _recover_state_after_restart(self) -> None:
        """`self.state` was already loaded from the persisted `machine_state`
        kv row in __init__, so it reflects whatever was active the instant
        the process stopped (clean or not). PROCESSING is the one state that
        can never be safely resumed blind: the gate/conveyor/item position
        is unknown, so it is routed to a safe state for manual review rather
        than guessed at."""
        recovered = self.state
        if recovered == MachineState.PROCESSING:
            self.enter_safe_state(
                "POWER_LOSS_MID_ITEM", {}, category="SYSTEM", event_type="ERROR"
            )
        elif recovered in self._RESUMABLE_STATES:
            self.set_state(recovered, "startup-recovery")
        else:
            self.set_state(MachineState.IDLE, "startup")

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
                    self.emit("CHAMBER_TIMEOUT", {"timeoutSeconds": self.config.chamber_timeout_seconds}, self.session_id())
                    self.emit("ITEM_REJECTED", {"reason": "CHAMBER_PROCESS_TIMEOUT"}, self.session_id())
                    self._sensor_sequence = []
                    self._reset_waste_type_selection()
                    self.set_state(MachineState.SESSION_ACTIVE, "item-timeout")
                    self.hardware.set_conveyor("STOPPED")
                if time.time() - self._last_heartbeat >= self.config.heartbeat_seconds:
                    self.emit("HEARTBEAT", self.heartbeat_payload(snapshot))
                    self._last_heartbeat = time.time()
            except Exception as exc:
                self.enter_safe_state(
                    "CONTROL_LOOP_ERROR",
                    {"error": str(exc)},
                    category="SYSTEM",
                    event_type="ERROR",
                )
            time.sleep(0.05)

    def _lease_loop(self) -> None:
        while self.running:
            self._last_lease_poll = time.time()
            payload = self.sync.fetch_machine_session()
            if payload is not None:
                lease = payload.get("lease")
                self._server_session = payload.get("session")
                self._idle_timeout_minutes = payload.get("idleTimeoutMinutes")
                waste_types = payload.get("wasteTypes")
                if waste_types is not None:
                    self.db.set_json("waste_types", waste_types)
                local_lease = self.db.active_lease()

                if lease and not local_lease:
                    self.activate_lease(lease)
                elif lease and local_lease and str(local_lease["session_id"]) != str(lease["sessionId"]):
                    self.db.deactivate_leases()
                    self.activate_lease(lease)
                elif not lease and local_lease:
                    self.db.deactivate_leases()
                    self.hardware.all_stop()
                    self._processing_started_at = None
                    self._reset_waste_type_selection()
                    if self._active_alert and self._active_alert.get("category") == "FRAUD":
                        self._clear_alert()
                    self.set_state(MachineState.IDLE, "server-session-ended")

            if self.state == MachineState.IDLE and time.time() - self._last_display_poll >= 5:
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
            time.sleep(2)

    def _process_sensors(self, current: SensorSnapshot) -> None:
        if current.chamber_open and not self._last.chamber_open:
            if self.state != MachineState.SESSION_ACTIVE:
                self.report_fraud("CHAMBER_OPEN_WITHOUT_SESSION", {})
            else:
                self._sensor_sequence = ["CHAMBER_OPEN"]
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
            self._set_alert("SENSOR", "CAMERA_BLURRY", "WARNING", {})
            self.emit("ERROR", {"reason": "CAMERA_BLURRY"}, self.session_id())
        if current.temperature_c >= self.config.max_temperature_c:
            self.enter_safe_state(
                "HIGH_TEMPERATURE",
                {"temperatureC": current.temperature_c, "limitC": self.config.max_temperature_c},
                category="SAFETY",
                event_type="ERROR",
            )
        if current.reverse_motion and not self._last.reverse_motion:
            self.emit(
                "SENSOR_SEQUENCE",
                {
                    "steps": self._sensor_sequence,
                    "reverseMotion": True,
                    "retrievalAttempt": True,
                },
                self.session_id(),
            )
            self.report_fraud("REVERSE_MOTION", {"retrievalAttempt": True})
        if current.fill_percent != self._last.fill_percent:
            self.emit("FILL_LEVEL_UPDATED", {"fillLevelPercent": current.fill_percent})
        if current.fill_percent >= self.config.max_fill_percent and self.state != MachineState.FULL:
            self.set_state(MachineState.FULL, "capacity")
            self.hardware.all_stop()
            self.emit("STATUS_CHANGED", {"status": "FULL"})
        if current.item_present and not self._last.item_present:
            if self.state != MachineState.SESSION_ACTIVE:
                self.report_fraud("ITEM_WITHOUT_ACTIVE_SESSION", {})
            else:
                self.set_state(MachineState.PROCESSING, "item-present")
                if not self._sensor_sequence:
                    self._sensor_sequence = ["CHAMBER_OPEN"] if current.chamber_open else []
                self._sensor_sequence.append("ITEM_PRESENT")
                self._processing_started_at = time.time()
                self._weight_reported = False
                self.hardware.set_input_gate(False)
                item_payload: dict[str, Any] = {"inputBeam": True}
                if self._selected_waste_type_id:
                    item_payload["wasteTypeId"] = self._selected_waste_type_id
                elif self._simulation_waste_type_key:
                    item_payload["wasteTypeKey"] = self._simulation_waste_type_key
                self.emit("ITEM_DETECTED", item_payload, self.session_id())
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
            self._sensor_sequence.extend(["WEIGHT_STABLE", "IMAGE_CAPTURED"])
            if not (
                self.config.min_item_weight_grams
                <= current.weight_grams
                <= self.config.max_item_weight_grams
            ):
                self.emit(
                    "SENSOR_SEQUENCE",
                    {"steps": self._sensor_sequence},
                    self.session_id(),
                )
                self.emit(
                    "ITEM_REJECTED",
                    {"reason": "ABNORMAL_ITEM_WEIGHT", "weightGrams": current.weight_grams},
                    self.session_id(),
                )
                self._processing_started_at = None
                self._sensor_sequence = []
                self._reset_waste_type_selection()
                self.set_state(MachineState.SESSION_ACTIVE, "abnormal-weight-rejected")
                self.hardware.set_input_gate(True)
            self._weight_reported = True
        if current.acceptance_triggered and not self._last.acceptance_triggered:
            if self.state != MachineState.PROCESSING:
                self.report_fraud("IMPOSSIBLE_ACCEPTANCE_SEQUENCE", {})
            else:
                self._sensor_sequence.extend(["CONVEYOR_FORWARD", "ACCEPTANCE_POINT"])
                self.emit("SENSOR_SEQUENCE", {"steps": self._sensor_sequence}, self.session_id())
                self.hardware.set_conveyor("FORWARD")
                self.emit("CONVEYOR_STARTED", {"direction": "FORWARD"}, self.session_id())
                self.emit("ITEM_ACCEPTED_POINT", {"acceptanceBeam": True}, self.session_id())
                self.hardware.set_conveyor("STOPPED")
                if self.config.compactor_enabled:
                    self.emit("COMPACTION_STARTED", {}, self.session_id())
                    self.hardware.set_compactor(True)
                    time.sleep(0.15)
                    self.hardware.set_compactor(False)
                    self.emit("COMPACTION_COMPLETED", {}, self.session_id())
                self._processing_started_at = None
                self._sensor_sequence = []
                self._reset_waste_type_selection()
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

    def enter_safe_state(
        self,
        reason: str,
        payload: dict[str, Any],
        *,
        category: str = "VANDALISM",
        event_type: str = "VANDALISM_DETECTED",
    ) -> None:
        with self._lock:
            self.hardware.all_stop()
            if self.state == MachineState.SAFE_STATE and reason == self.db.get_json("safe_reason"):
                return
            self._set_alert(category, reason, "CRITICAL", payload)
            if self.config.camera_capture_security_events:
                self._capture_camera_evidence("SECURITY", reason, self.session_id())
            self.db.set_json("safe_reason", reason)
            self.set_state(MachineState.SAFE_STATE, reason)
            self.emit(event_type, {"reason": reason, **payload}, self.session_id())
            self.emit(
                "SAFE_STATE_ENTERED",
                {
                    "reason": reason,
                    "category": category,
                    "outputsDisabled": ["input_gate", "conveyor", "compactor"],
                },
                self.session_id(),
            )

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
            # Pre-scan lease (QR display data), save as display
            if lease.get("qrDataUrl"):
                self.db.set_json(
                    "display",
                    {
                        "qrDataUrl": lease["qrDataUrl"],
                        "expiresAt": lease.get("expiresAt"),
                        "status": "ONLINE",
                        "updatedAt": time.time(),
                    }
                )
            return False
        lease = {**lease, "status": "ACTIVE"}
        self.db.save_lease(lease)
        self.set_state(MachineState.SESSION_ACTIVE, "lease-activated")
        self.hardware.set_input_gate(True)
        self.emit("CHAMBER_OPENED", {"leaseActivated": True}, lease["sessionId"])
        if self.config.camera_capture_session_start:
            self._capture_camera_evidence("SESSION_START", "SESSION_ACTIVATED", lease["sessionId"])
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

    def select_waste_type(self, waste_type_id: str) -> bool:
        """Records the waste type the user picked on the kiosk before
        inserting an item. Only valid while a session is active and no item
        is currently being processed, so the selection always maps to the
        next physical item."""
        if not waste_type_id or self.state != MachineState.SESSION_ACTIVE:
            return False
        with self._lock:
            self._selected_waste_type_id = waste_type_id
            self.db.audit("WASTE_TYPE_SELECTED", {"wasteTypeId": waste_type_id})
        return True

    def _reset_waste_type_selection(self) -> None:
        self._selected_waste_type_id = None

    def maintenance_locked(self) -> bool:
        return time.time() < self._maintenance_lockout_until

    def maintenance_login(self, pin: str) -> str | None:
        now = time.time()
        if now < self._maintenance_lockout_until:
            self.db.audit(
                "MAINTENANCE_LOGIN_LOCKED",
                {"retryAfterSeconds": round(self._maintenance_lockout_until - now)},
            )
            return None
        if not self.config.verify_pin(pin):
            self._maintenance_failed_attempts += 1
            self.db.audit(
                "MAINTENANCE_LOGIN_FAILED",
                {"attempts": self._maintenance_failed_attempts},
            )
            if self._maintenance_failed_attempts >= MAINTENANCE_LOCKOUT_THRESHOLD:
                self._maintenance_lockout_until = now + MAINTENANCE_LOCKOUT_SECONDS
                self.db.audit(
                    "MAINTENANCE_LOGIN_LOCKED_OUT",
                    {"lockoutSeconds": MAINTENANCE_LOCKOUT_SECONDS},
                )
            return None
        self._maintenance_failed_attempts = 0
        token = secrets.token_urlsafe(32)
        self._maintenance_tokens[token] = now + self.config.maintenance_token_ttl_seconds
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
                "faceCount": self.camera.status.face_count,
                "personDetected": self.camera.status.person_detected,
                "captureQueueDepth": self.db.capture_queue_depth(),
            },
            "activeSession": bool(self.db.active_lease()),
            "session": self._server_session,
            "idleTimeoutMinutes": self._idle_timeout_minutes,
            "wasteTypes": self.db.get_json("waste_types", []),
            "selectedWasteTypeId": self._selected_waste_type_id,
            "safeReason": self.db.get_json("safe_reason"),
            "alert": self._active_alert,
            "simulation": {
                "running": bool(
                    self._simulation_thread and self._simulation_thread.is_alive()
                ),
                "scenario": self._simulation_name,
                "error": self._simulation_error,
                "lastResult": self._simulation_result,
                "available": isinstance(self.hardware, MockHardware),
            },
            "display": display if display_valid else None,
            "media": self.db.get_json("media_playlist", {"enabled": False, "version": "", "items": []}),
        }
