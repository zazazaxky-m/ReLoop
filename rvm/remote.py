"""Remote command polling and execution for the RVM controller. Split out of
controller.py as a mixin; methods operate on the live `RvmController`
instance (`self`) and its `sync`, `db`, `hardware`, `camera`, `config`
attributes."""

from __future__ import annotations

import time
from typing import Any

from .states import MachineState, describe_interlocks


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
        if command == "STOP_ALL":
            # Outputs off at once, never behind the controller lock; then once
            # more under it so a guarded write already in flight cannot leave
            # an output running after STOP_ALL returns. A failed stop latches
            # SAFE_STATE and is reported back as a failed command.
            self._safe_all_stop()
            with self._lock:
                if not self._safe_all_stop():
                    raise RuntimeError(
                        "STOP_ALL gagal: output tidak dapat dimatikan, mesin dikunci di safe state"
                    )
        elif command in {"CAPTURE_SNAPSHOT", "SYNC_NOW"}:
            # Camera and network I/O: run outside the safety critical section
            # so a slow or hanging server never delays the sensor loop,
            # safe-state entry or STOP_ALL.
            self._execute_io_command(command)
        else:
            with self._lock:
                self._execute_state_command(command)
        self.db.audit(
            "REMOTE_COMMAND_EXECUTED",
            {"command": command, "payload": payload},
        )
        return self._remote_snapshot()

    def _execute_io_command(self, command: str) -> None:
        if command == "CAPTURE_SNAPSHOT":
            if not self.config.camera_enabled:
                raise ValueError("Kamera mesin tidak aktif")
            evidence = self.camera.capture_evidence(
                "REMOTE", "SUPERADMIN_SNAPSHOT", self.session_id()
            )
            if not evidence:
                raise ValueError("Frame kamera belum tersedia")
            self.db.enqueue_capture(evidence)
            self.sync.flush_captures()
        else:  # SYNC_NOW
            self.sync.flush_once()
            self.sync.flush_captures()

    def _execute_state_command(self, command: str) -> None:
        if command == "REFRESH_STATE":
            pass
        elif command == "OPEN_GATE":
            if self.state != MachineState.SESSION_ACTIVE or not self.db.active_lease():
                raise ValueError("Gate hanya dapat dibuka saat sesi aktif")
            if self._active_alert:
                raise ValueError("Gate tidak dapat dibuka selama alert aktif")
            if self._gate_bound_block():
                raise ValueError("Gate tidak dapat dibuka: batas sesi sudah tercapai")
            if not self.try_open_input_gate("remote-open-gate"):
                raise ValueError("Gate tidak dapat dibuka: interlock keselamatan aktif")
        elif command == "CLOSE_GATE":
            self._close_output(lambda: self.hardware.set_input_gate(False))
        elif command == "RESET_ALERT":
            unsafe = self._unsafe_conditions(self.hardware.read())
            if unsafe:
                raise ValueError("Reset ditolak: " + describe_interlocks(unsafe))
            self._reset_mock_state(deactivate_lease=False)
        elif command == "ENTER_MAINTENANCE":
            if not self._safe_all_stop():
                raise RuntimeError(
                    "Output tidak dapat dimatikan, mesin dikunci di safe state"
                )
            self.set_state(MachineState.MAINTENANCE, "remote-superadmin")
        elif command == "RESUME_OPERATION":
            if self.db.get_json("safe_reason") or self._active_alert:
                raise ValueError("Reset alert sebelum melanjutkan operasi")
            # Leave maintenance only with every output confirmed stopped.
            if not self._safe_all_stop():
                raise RuntimeError(
                    "Output tidak dapat dimatikan, mesin dikunci di safe state"
                )
            if self.db.active_lease():
                self.set_state(MachineState.SESSION_ACTIVE, "remote-resume")
                self.try_open_input_gate("remote-resume")
            else:
                self.set_state(MachineState.IDLE, "remote-resume")
        else:
            raise ValueError("Perintah remote tidak diizinkan")
