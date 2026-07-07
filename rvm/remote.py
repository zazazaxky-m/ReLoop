"""Remote command polling and execution for the RVM controller. Split out of
controller.py as a mixin; methods operate on the live `RvmController`
instance (`self`) and its `sync`, `db`, `hardware`, `camera`, `config`
attributes."""

from __future__ import annotations

import time
from typing import Any

from .states import MachineState


class RvmRemoteMixin:
    def _remote_loop(self) -> None:
        while self.running:
            command = self.sync.fetch_remote_command()
            if command:
                command_id = str(command.get("id", ""))
                cached = self.db.get_json(f"remote_result:{command_id}")
                if cached:
                    self.sync.report_remote_command(command_id, **cached)
                else:
                    try:
                        result = self.execute_remote_command(
                            str(command.get("command", "")),
                            dict(command.get("payload") or {}),
                        )
                        report = {"success": True, "result": result, "error": None}
                    except Exception as exc:
                        report = {"success": False, "result": {}, "error": str(exc)}
                    self.db.set_json(f"remote_result:{command_id}", report)
                    self.sync.report_remote_command(command_id, **report)
            time.sleep(2)

    def _remote_snapshot(self) -> dict[str, Any]:
        state = self.public_state()
        state.pop("display", None)
        return state

    def execute_remote_command(
        self, command: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        payload = payload or {}
        with self._lock:
            if command == "REFRESH_STATE":
                pass
            elif command == "CAPTURE_SNAPSHOT":
                if not self.config.camera_enabled:
                    raise ValueError("Kamera mesin tidak aktif")
                evidence = self.camera.capture_evidence(
                    "REMOTE", "SUPERADMIN_SNAPSHOT", self.session_id()
                )
                if not evidence:
                    raise ValueError("Frame kamera belum tersedia")
                self.db.enqueue_capture(evidence)
                self.sync.flush_captures()
            elif command == "SYNC_NOW":
                self.sync.flush_once()
                self.sync.flush_captures()
            elif command == "STOP_ALL":
                self.hardware.all_stop()
            elif command == "OPEN_GATE":
                if self.state != MachineState.SESSION_ACTIVE or not self.db.active_lease():
                    raise ValueError("Gate hanya dapat dibuka saat sesi aktif")
                if self._active_alert:
                    raise ValueError("Gate tidak dapat dibuka selama alert aktif")
                self.hardware.set_input_gate(True)
            elif command == "CLOSE_GATE":
                self.hardware.set_input_gate(False)
            elif command == "RESET_ALERT":
                sensor = self.hardware.read()
                unsafe = []
                if sensor.service_panel_open:
                    unsafe.append("service panel masih terbuka")
                if sensor.collection_door_open:
                    unsafe.append("pintu kolektor masih terbuka")
                if sensor.vibration_g >= self.config.vibration_threshold_g:
                    unsafe.append("getaran masih tinggi")
                if sensor.temperature_c >= self.config.max_temperature_c:
                    unsafe.append("suhu masih tinggi")
                if self.config.camera_enabled and not self.camera.status.online:
                    unsafe.append("kamera masih offline")
                if self.config.camera_enabled and self.camera.status.occluded:
                    unsafe.append("kamera masih tertutup")
                if unsafe:
                    raise ValueError("Reset ditolak: " + ", ".join(unsafe))
                self._reset_mock_state(deactivate_lease=False)
            elif command == "ENTER_MAINTENANCE":
                self.hardware.all_stop()
                self.set_state(MachineState.MAINTENANCE, "remote-superadmin")
            elif command == "RESUME_OPERATION":
                if self.db.get_json("safe_reason") or self._active_alert:
                    raise ValueError("Reset alert sebelum melanjutkan operasi")
                if self.db.active_lease():
                    self.set_state(MachineState.SESSION_ACTIVE, "remote-resume")
                    self.hardware.set_input_gate(True)
                else:
                    self.set_state(MachineState.IDLE, "remote-resume")
            else:
                raise ValueError("Perintah remote tidak diizinkan")
            self.db.audit(
                "REMOTE_COMMAND_EXECUTED",
                {"command": command, "payload": payload},
            )
            return self._remote_snapshot()
