"""Interactive mock-hardware simulation scenarios for the RVM controller.
Split out of controller.py as a mixin; methods operate on the live
`RvmController` instance (`self`). Only usable when the controller runs with
the mock hardware driver."""

from __future__ import annotations

import hashlib
import hmac
import threading
import time
import uuid
from typing import Any

from .hardware import MockHardware
from .states import (
    MachineState,
    SESSION_SIMULATION_SCENARIOS,
    SIMULATION_SCENARIOS,
    describe_interlocks,
    iso_now,
)


class RvmSimulationMixin:
    def _reset_mock_state(self, deactivate_lease: bool = True) -> None:
        """Operator reset (maintenance reset-safe-state, remote RESET_ALERT,
        simulator). Clears the safety latch only when every safety condition
        is clear on a fresh sensor read; on MockHardware the simulated
        sensors are first returned to their idle values."""
        with self._lock:
            self._safe_all_stop()
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
                    temperature_c=28.0,
                )
                self._last = self.hardware.read()
            unsafe = self._unsafe_conditions(self.hardware.read())
            if unsafe:
                raise ValueError("Reset ditolak: " + describe_interlocks(unsafe))
            self.db.set_json("safe_reason", None)
            self._clear_alert()
            if deactivate_lease:
                self.db.deactivate_leases()
            self._processing_started_at = None
            self._sensor_sequence = []
            self._reset_waste_type_selection()
            if self.db.active_lease():
                self.set_state(MachineState.SESSION_ACTIVE, "simulation-reset")
                self.try_open_input_gate("simulation-reset")
            else:
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
        allowed = SIMULATION_SCENARIOS
        if scenario not in allowed:
            raise ValueError("Skenario simulator tidak dikenal")
        if self._simulation_thread and self._simulation_thread.is_alive():
            raise ValueError("Skenario lain masih berjalan")
        self._simulation_name = scenario
        self._simulation_error = None
        self._simulation_result = {
            "scenario": scenario,
            "status": "RUNNING",
            "startedAt": iso_now(),
        }
        self._simulation_thread = threading.Thread(
            target=self._run_simulation,
            args=(scenario,),
            daemon=True,
            name="rvm-interactive-simulator",
        )
        self._simulation_thread.start()

    def _run_simulation(self, scenario: str) -> None:
        try:
            session_scenarios = SESSION_SIMULATION_SCENARIOS
            requires_session = scenario in session_scenarios
            self._reset_mock_state(deactivate_lease=not requires_session)

            if requires_session and not self.db.active_lease():
                lease = self.sync.fetch_active_lease()
                if not lease or not self.activate_lease(lease):
                    raise RuntimeError(
                        "Belum ada sesi server aktif. Scan QR mesin dari aplikasi pengguna terlebih dahulu."
                    )

            if scenario in {
                "normal-bottle",
                "normal-can",
                "string-pull",
                "abnormal-weight",
                "abnormal-underweight",
            }:
                self._simulation_patch(chamber_open=True)
                self._simulation_pulse("item_present")
                weight = {
                    "normal-bottle": 22.4,
                    "normal-can": 15.1,
                    "string-pull": 23.0,
                    "abnormal-weight": 900.0,
                    "abnormal-underweight": 1.0,
                }[scenario]
                self._simulation_waste_type_key = (
                    "anorganik" if scenario == "normal-can" else "organik"
                )
                self._simulation_patch(weight_grams=weight, weight_stable=True)
                if scenario not in {"abnormal-weight", "abnormal-underweight"}:
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
                self._simulation_pulse("acceptance_triggered")
            elif scenario == "item-without-session":
                self._simulation_pulse("item_present")
            elif scenario == "chamber-timeout":
                self._simulation_patch(chamber_open=True)
                self._simulation_pulse("item_present")
                self._processing_started_at = time.time() - self.config.chamber_timeout_seconds - 1
                time.sleep(0.2)
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
            elif scenario == "camera-blurry":
                self._simulation_patch(camera_blurry=True)
            elif scenario == "overheat":
                self._simulation_patch(temperature_c=self.config.max_temperature_c + 15)
            elif scenario == "machine-full":
                self._simulation_patch(fill_percent=98)
        except Exception as exc:
            self._simulation_error = str(exc)
        finally:
            self._simulation_result = {
                "scenario": scenario,
                "status": "FAILED" if self._simulation_error else "COMPLETED",
                "message": self._simulation_error or "Skenario selesai dan respons sensor berhasil diproses",
                "completedAt": iso_now(),
                "runtimeState": self.state,
                "alertReason": self._active_alert.get("reason") if self._active_alert else None,
            }
            self._simulation_waste_type_key = None
            self._simulation_name = None
