from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
from typing import Any, Callable

from .camera import CameraWorker
from .config import RvmConfig
from .database import EdgeDatabase
from .fraud import RvmFraudMixin
from .hardware import GpioHardware, HardwareAdapter, MockHardware, SensorSnapshot
from .remote import RvmRemoteMixin
from .simulation import RvmSimulationMixin
from .states import (
    LOCKED_STATE_BLOCK_REASONS,
    MAINTENANCE_LOCKOUT_SECONDS,
    MAINTENANCE_LOCKOUT_THRESHOLD,
    MachineState,
    SIMULATION_SCENARIOS,
    describe_interlocks,
    iso_now,
)
from .sync import SyncWorker

logger = logging.getLogger(__name__)


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
        self._output_fault: str | None = None
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
        self._safe_all_stop()
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
        self._safe_all_stop()
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

    @staticmethod
    def _retry_delay(errors: int, base: float, cap: float) -> float:
        """Normal loop cadence, or a capped exponential backoff while the
        loop keeps failing."""
        return min(cap, base * 2 ** min(errors, 16))

    def _run(self) -> None:
        errors = 0
        while self.running:
            try:
                self._tick()
                errors = 0
            except Exception as exc:
                errors += 1
                if errors == 1:
                    logger.error("control loop tick failed", exc_info=True)
                try:
                    if self._safety_latch_active():
                        # Already latched (e.g. a failed output close in this
                        # tick): keep the root-cause reason, stop everything.
                        self._safe_all_stop()
                    else:
                        self.enter_safe_state(
                            "CONTROL_LOOP_ERROR",
                            {"error": str(exc)},
                            category="SYSTEM",
                            event_type="ERROR",
                        )
                except Exception:
                    # The loop itself must keep running to retry the latch.
                    logger.exception("control loop could not latch SAFE_STATE")
            time.sleep(self._retry_delay(errors, base=0.05, cap=1.0))

    def _tick(self) -> None:
        """One control-loop pass. The whole pass holds the controller lock, so a
        guarded output write (check + write under the same lock) is never
        interleaved with sensor processing: the loop sees either the state
        before the write or the state after it."""
        with self._lock:
            snapshot = self.hardware.read()
            try:
                self._process_sensors(snapshot)
            finally:
                # Each sensor edge is processed at most once, even when the
                # pass aborts (e.g. a failed output close that latched).
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
                self._close_output(lambda: self.hardware.set_conveyor("STOPPED"))
            if time.time() - self._last_heartbeat >= self.config.heartbeat_seconds:
                self.emit("HEARTBEAT", self.heartbeat_payload(snapshot))
                self._last_heartbeat = time.time()

    def _lease_loop(self) -> None:
        errors = 0
        while self.running:
            try:
                self._poll_server_session()
                errors = 0
            except Exception:
                errors += 1
                logger.warning("server session poll failed (%d in a row)", errors, exc_info=True)
            time.sleep(self._retry_delay(errors, base=2.0, cap=30.0))

    def _poll_server_session(self) -> None:
        """One session-bridge poll. Network calls run outside the controller
        lock; only the local lease/state decision is taken under it."""
        self._last_lease_poll = time.time()
        payload = self.sync.fetch_machine_session()
        if payload is not None:
            lease = payload.get("lease")
            self._server_session = payload.get("session")
            self._idle_timeout_minutes = payload.get("idleTimeoutMinutes")
            waste_types = payload.get("wasteTypes")
            if waste_types is not None:
                self.db.set_json("waste_types", waste_types)
            with self._lock:
                local_lease = self.db.active_lease()
                if lease and not local_lease:
                    self.activate_lease(lease)
                elif lease and local_lease and str(local_lease["session_id"]) != str(lease["sessionId"]):
                    self.db.deactivate_leases()
                    self.activate_lease(lease)
                elif not lease and local_lease:
                    self.db.deactivate_leases()
                    self._processing_started_at = None
                    self._reset_waste_type_selection()
                    if self._active_alert and self._active_alert.get("category") == "FRAUD":
                        self._clear_alert()
                    # A safety latch, maintenance or full bin outlives the
                    # server session; only a validated operator reset ends it.
                    if self.state not in LOCKED_STATE_BLOCK_REASONS:
                        self.set_state(MachineState.IDLE, "server-session-ended")
                    # After the state change, so a failed stop's latch wins.
                    self._safe_all_stop()

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

    def _process_sensors(self, current: SensorSnapshot) -> None:
        if current.chamber_open and not self._last.chamber_open:
            if self.state != MachineState.SESSION_ACTIVE:
                self.report_fraud("CHAMBER_OPEN_WITHOUT_SESSION", {})
            else:
                self._sensor_sequence = ["CHAMBER_OPEN"]
                self.emit("CHAMBER_OPENED", {"doorSensor": "OPEN"}, self.session_id())
        self._latch_hazard(
            current.service_panel_open,
            self._last.service_panel_open,
            "SERVICE_PANEL_FORCED_OPEN",
            {},
        )
        self._latch_hazard(
            current.collection_door_open,
            self._last.collection_door_open,
            "COLLECTION_DOOR_FORCED_OPEN",
            {},
        )
        self._latch_hazard(
            current.vibration_g >= self.config.vibration_threshold_g,
            self._last.vibration_g >= self.config.vibration_threshold_g,
            "HIGH_IMPACT_DETECTED",
            {"vibrationG": current.vibration_g},
        )
        self._latch_hazard(
            current.camera_occluded,
            self._last.camera_occluded,
            "CAMERA_OCCLUDED",
            {},
        )
        if self._last.camera_online and not current.camera_online:
            self.enter_safe_state("CAMERA_OFFLINE", {})
        if current.camera_blurry and not self._last.camera_blurry:
            self._set_alert("SENSOR", "CAMERA_BLURRY", "WARNING", {})
            self.emit("ERROR", {"reason": "CAMERA_BLURRY"}, self.session_id())
        self._latch_hazard(
            current.temperature_c >= self.config.max_temperature_c,
            self._last.temperature_c >= self.config.max_temperature_c,
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
        if current.fill_percent >= self.config.max_fill_percent and self.state not in {
            MachineState.FULL,
            MachineState.SAFE_STATE,  # the safety latch outranks capacity state
        }:
            self.set_state(MachineState.FULL, "capacity")
            if self._safe_all_stop():  # a failed stop latched SAFE_STATE instead
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
                self._close_output(lambda: self.hardware.set_input_gate(False))
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
                self.try_open_input_gate("abnormal-weight-rejected")
            self._weight_reported = True
        if current.acceptance_triggered and not self._last.acceptance_triggered:
            if self.state != MachineState.PROCESSING:
                self.report_fraud("IMPOSSIBLE_ACCEPTANCE_SEQUENCE", {})
            else:
                blocked = self._guarded_output(lambda: self.hardware.set_conveyor("FORWARD"))
                if blocked:
                    # The server credits on ITEM_ACCEPTED_POINT: an item the
                    # conveyor never moved is rejected, never accepted.
                    self.emit(
                        "ITEM_REJECTED",
                        {"reason": "ACTUATION_BLOCKED", "blockedBy": blocked},
                        self.session_id(),
                    )
                else:
                    self._sensor_sequence.extend(["CONVEYOR_FORWARD", "ACCEPTANCE_POINT"])
                    self.emit("SENSOR_SEQUENCE", {"steps": self._sensor_sequence}, self.session_id())
                    self.emit("CONVEYOR_STARTED", {"direction": "FORWARD"}, self.session_id())
                    self.emit("ITEM_ACCEPTED_POINT", {"acceptanceBeam": True}, self.session_id())
                    self._close_output(lambda: self.hardware.set_conveyor("STOPPED"))
                    if (
                        self.config.compactor_enabled
                        and self._guarded_output(lambda: self.hardware.set_compactor(True)) is None
                    ):
                        self.emit("COMPACTION_STARTED", {}, self.session_id())
                        time.sleep(0.15)
                        self._close_output(lambda: self.hardware.set_compactor(False))
                        self.emit("COMPACTION_COMPLETED", {}, self.session_id())
                self._processing_started_at = None
                self._sensor_sequence = []
                self._reset_waste_type_selection()
                self.set_state(
                    MachineState.SESSION_ACTIVE,
                    "item-actuation-blocked" if blocked else "item-accepted",
                )
        # Level-triggered enforcement: while latched, or while any physical
        # hazard is present, every tick drives all outputs off again, whatever
        # wrote them in between.
        if self.state == MachineState.SAFE_STATE or self._physical_hazards(current):
            self._safe_all_stop()

    def _latch_hazard(
        self,
        active: bool,
        was_active: bool,
        reason: str,
        payload: dict[str, Any],
        **safe_state_options: str,
    ) -> None:
        """Latches SAFE_STATE whenever a hazard is present and the machine is
        not latched yet (not only on the rising edge), so a door that is
        already open when the latch is cleared re-latches on the next tick.
        A new rising edge while latched still records its own alert."""
        if active and (not was_active or self.state != MachineState.SAFE_STATE):
            self.enter_safe_state(reason, payload, **safe_state_options)

    def heartbeat_payload(self, snapshot: SensorSnapshot | None = None) -> dict:
        sensor = snapshot or self.hardware.read()
        # A latched safety fault is reported as ERROR in every runtime state
        # (e.g. MAINTENANCE entered while latched).
        latched = self._safety_latch_active()
        server_status = "ERROR" if latched or self.state == MachineState.ERROR else (
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
            if (
                previous == MachineState.SAFE_STATE
                and state not in {MachineState.SAFE_STATE, MachineState.MAINTENANCE}
                and self.db.get_json("safe_reason")
            ):
                # A latched SAFE_STATE is left only through the validated
                # operator reset, which clears safe_reason first; processing,
                # session and capacity transitions never mask it.
                self.db.audit(
                    "STATE_CHANGE_SUPPRESSED",
                    {"from": previous, "to": state, "reason": reason},
                )
                return
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
        # Outputs off immediately, without waiting for the controller lock,
        # and again under it so an in-flight guarded write cannot survive.
        # An output fault never prevents the latch below; it escalates the
        # latch to OUTPUT_STOP_FAILED and the control tick keeps retrying the
        # stop while latched.
        self._stop_outputs()
        with self._lock:
            stopped = self._stop_outputs()
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
                    "outputsDisabled": ["input_gate", "conveyor", "compactor"] if stopped else [],
                    "stopFailed": not stopped,
                },
                self.session_id(),
            )
            if not stopped and reason != "OUTPUT_STOP_FAILED":
                # The unresolved output fault outranks the original reason.
                self.enter_safe_state(
                    "OUTPUT_STOP_FAILED",
                    {"error": self._output_fault},
                    category="SYSTEM",
                    event_type="ERROR",
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

        def start_session() -> None:
            self.db.save_lease(lease)
            self.set_state(MachineState.SESSION_ACTIVE, "lease-activated")
            self.hardware.set_input_gate(True)

        # Local interlocks outrank a backend lease: on refusal nothing is
        # saved and the state/latch stay exactly as they were.
        if self._guarded_output(start_session) is not None:
            return False
        self.emit("CHAMBER_OPENED", {"leaseActivated": True}, lease["sessionId"])
        if self.config.camera_capture_session_start:
            self._capture_camera_evidence("SESSION_START", "SESSION_ACTIVATED", lease["sessionId"])
        return True

    def _physical_hazards(self, snapshot: SensorSnapshot) -> list[str]:
        """Conditions under which no actuator may move at all. An unresolved
        output-stop fault counts: until a stop has succeeded again nothing may
        be opened, every tick retries the stop and no reset is accepted."""
        reasons = []
        if self._output_fault is not None:
            reasons.append("OUTPUT_STOP_FAILED")
        if snapshot.service_panel_open:
            reasons.append("SERVICE_PANEL_OPEN")
        if snapshot.collection_door_open:
            reasons.append("COLLECTION_DOOR_OPEN")
        if snapshot.vibration_g >= self.config.vibration_threshold_g:
            reasons.append("HIGH_VIBRATION")
        if snapshot.temperature_c >= self.config.max_temperature_c:
            reasons.append("HIGH_TEMPERATURE")
        return reasons

    def _unsafe_conditions(self, snapshot: SensorSnapshot) -> list[str]:
        """Every safety condition that must be clear before outputs may be
        opened or a safety latch may be reset: physical hazards plus the
        camera requirement. The enabled camera worker must be online and
        unobstructed; only MockHardware simulates camera signals (the GPIO
        adapter has no camera inputs)."""
        reasons = self._physical_hazards(snapshot)
        camera_online = snapshot.camera_online if isinstance(self.hardware, MockHardware) else True
        camera_occluded = snapshot.camera_occluded
        if self.config.camera_enabled:
            camera_online = camera_online and self.camera.status.online
            camera_occluded = camera_occluded or self.camera.status.occluded
        if not camera_online:
            reasons.append("CAMERA_OFFLINE")
        if camera_occluded:
            reasons.append("CAMERA_OCCLUDED")
        return reasons

    def _safety_latch_active(self) -> bool:
        alert = self._active_alert
        return (
            self.state == MachineState.SAFE_STATE
            or bool(self.db.get_json("safe_reason"))
            or bool(alert and alert.get("severity") == "CRITICAL")
        )

    def actuation_block_reason(self, snapshot: SensorSnapshot) -> str | None:
        """Why the input gate, conveyor or compactor must not be opened or
        started now, or None when every interlock is clear."""
        unsafe = self._unsafe_conditions(snapshot)
        if unsafe:
            return unsafe[0]
        if self._safety_latch_active():
            return "SAFETY_LATCH_ACTIVE"
        if self.state in LOCKED_STATE_BLOCK_REASONS:
            return LOCKED_STATE_BLOCK_REASONS[self.state]
        if snapshot.fill_percent >= self.config.max_fill_percent:
            return "MACHINE_FULL"
        return None

    def _maintenance_block_reason(self, snapshot: SensorSnapshot) -> str | None:
        """Interlock for a PIN-authorised technician jogging one output: any
        physical hazard or an active safety latch blocks it, maintenance mode
        does not."""
        hazards = self._physical_hazards(snapshot)
        if hazards:
            return hazards[0]
        if self._safety_latch_active():
            return "SAFETY_LATCH_ACTIVE"
        return None

    def _guarded_output(
        self,
        write: Callable[[], None],
        block_reason: Callable[[SensorSnapshot], str | None] | None = None,
    ) -> str | None:
        """Reads the latest sensors, evaluates the interlock and performs the
        output write as one critical section under the controller lock.
        Returns None when written, otherwise the blocking reason (with all
        outputs forced off and `write` never called)."""
        check = block_reason or self.actuation_block_reason
        with self._lock:
            try:
                snapshot = self.hardware.read()
            except Exception:
                blocked: str | None = "SENSOR_READ_FAILED"
            else:
                blocked = check(snapshot)
            if blocked:
                self._safe_all_stop()
                return blocked
            write()
            return None

    def _stop_outputs(self) -> bool:
        """One all_stop() attempt that never raises. Tracks the output fault:
        set (and logged once per distinct error) while the stop fails, cleared
        once a stop succeeds again. Does not latch; see _safe_all_stop."""
        try:
            self.hardware.all_stop()
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            if self._output_fault != error:
                logger.error("all_stop failed: %s", error)
            self._output_fault = error
            return False
        if self._output_fault is not None:
            logger.info("all_stop recovered after: %s", self._output_fault)
            self.db.audit("OUTPUT_STOP_RECOVERED", {"error": self._output_fault})
            self._output_fault = None
        return True

    def _safe_all_stop(self) -> bool:
        """Stop used by every path that turns all outputs off. It never
        raises, and an unsuccessful stop always latches SAFE_STATE
        (OUTPUT_STOP_FAILED, reported as an ERROR event). While latched every
        tick retries the stop until it succeeds; the latch then stays until a
        validated operator reset. Closing a single output goes through
        _close_output, which latches the same way on a failed write."""
        if self._stop_outputs():
            return True
        self.enter_safe_state(
            "OUTPUT_STOP_FAILED",
            {"error": self._output_fault},
            category="SYSTEM",
            event_type="ERROR",
        )
        return False

    def _close_output(self, write: Callable[[], None]) -> None:
        """Closes or stops a single output (always allowed, no interlock).
        A failed write latches SAFE_STATE (OUTPUT_STOP_FAILED), which stops
        every output and retries the stop each tick until it succeeds; the
        error is then re-raised to the caller."""
        with self._lock:
            try:
                write()
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
                logger.error("output close failed: %s", error)
                self.enter_safe_state(
                    "OUTPUT_STOP_FAILED",
                    {"error": error},
                    category="SYSTEM",
                    event_type="ERROR",
                )
                raise

    def try_open_input_gate(self, reason: str) -> bool:
        blocked = self._guarded_output(lambda: self.hardware.set_input_gate(True))
        self.db.audit(
            "INPUT_GATE_OPENED" if blocked is None else "ACTUATION_BLOCKED",
            {"output": "input_gate", "reason": reason, "blockedBy": blocked},
        )
        return blocked is None

    def _maintenance_output(self, write: Callable[[], None]) -> None:
        blocked = self._guarded_output(write, self._maintenance_block_reason)
        if blocked:
            raise ValueError(f"Aktuator ditolak: {describe_interlocks([blocked])}")

    def _expire_lease(self) -> None:
        if self.state not in {MachineState.SESSION_ACTIVE, MachineState.PROCESSING}:
            return
        if not self.db.active_lease():
            self.set_state(MachineState.SYNC_PENDING, "lease-expired")
            # After the state change, so a failed stop's latch wins.
            self._safe_all_stop()

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
            if data.get("open"):
                self._maintenance_output(lambda: hardware.set_input_gate(True))
            else:
                self._close_output(lambda: hardware.set_input_gate(False))
        elif command == "conveyor":
            direction = str(data.get("direction", "STOPPED"))
            if direction in {"FORWARD", "REVERSE"}:
                self._maintenance_output(lambda: hardware.set_conveyor(direction))
            else:
                self._close_output(lambda: hardware.set_conveyor("STOPPED"))
        elif command == "compactor":
            if data.get("active"):
                self._maintenance_output(lambda: hardware.set_compactor(True))
            else:
                self._close_output(lambda: hardware.set_compactor(False))
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
