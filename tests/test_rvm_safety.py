from __future__ import annotations

import hashlib, hmac, tempfile, time, unittest
import threading
import urllib.error
from unittest import mock
from pathlib import Path
from rvm.config import RvmConfig
from rvm.controller import RvmController, MachineState
from rvm.hardware import SensorSnapshot
from rvm.lease import policy_version, sign_lease_v2
from rvm.states import iso_now

class SafetyTest(unittest.TestCase):
    def test_valid_lease_cannot_clear_open_service_panel(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = RvmController(RvmConfig(machine_code="TEST-001",
                machine_secret="test-secret",database_path=str(Path(tmp)/"rvm.db"),
                server_url="http://127.0.0.1:1",hardware_driver="mock"))
            try:
                controller.hardware.patch(service_panel_open=True)
                controller.enter_safe_state("SERVICE_PANEL_FORCED_OPEN", {})
                now = int(time.time())
                # B01b: the lease is a valid v2 lease (the interlock is what refuses it).
                policy = {"version":1,"mode":"COMPLIANCE_ONLY","multiplierBps":10000,"wasteTypes":[]}
                lease = sign_lease_v2("test-secret",{"id":"lease-test","machineCode":"TEST-001",
                         "sessionId":"session-test","userRef":None,"issuedAt":now,"expiresAt":now+60,
                         "reservationId":None,"policyVersion":policy_version(policy),"ceilingRupiah":None,"maxItems":None})
                lease["policy"] = policy
                self.assertTrue(controller.verify_lease(lease))
                self.assertFalse(controller.activate_lease(lease))
                self.assertEqual(controller.state, MachineState.SAFE_STATE)
                self.assertFalse(controller.hardware.input_gate_open)
            finally:
                controller.db.close()


# --------------------------------------------------------------------------- #
# shared fixtures
# --------------------------------------------------------------------------- #
SECRET = "test-secret"


def make_controller(tmp: str, **overrides) -> RvmController:
    config = dict(
        machine_code="TEST-001",
        machine_secret=SECRET,
        database_path=str(Path(tmp) / "rvm.db"),
        server_url="http://127.0.0.1:1",
        hardware_driver="mock",
        maintenance_pin_hash=RvmConfig.hash_pin("2468"),
        camera_capture_session_start=False,
        camera_capture_security_events=False,
    )
    config.update(overrides)
    controller = RvmController(RvmConfig(**config))
    controller.set_state(MachineState.IDLE, "test-setup")
    return controller


def signed_lease(session_id: str = "session-safety", *, lease_id: str | None = None,
                 ttl: int = 60, machine_code: str = "TEST-001") -> dict:
    """A signed lease v2 without a money bound (B01b); the v1 form is refused by the worker."""
    now = int(time.time())
    policy = {"version": 1, "mode": "COMPLIANCE_ONLY", "multiplierBps": 10000, "wasteTypes": []}
    lease = sign_lease_v2(SECRET, {
        "id": lease_id or f"lease-{session_id}", "machineCode": machine_code, "sessionId": session_id, "userRef": None,
        "issuedAt": now, "expiresAt": now + ttl, "reservationId": None,
        "policyVersion": policy_version(policy), "ceilingRupiah": None, "maxItems": None,
    })
    lease["policy"] = policy
    return lease


def sensor_pass(controller: RvmController) -> None:
    """One sensor-processing pass exactly as the control loop runs it."""
    snapshot = controller.hardware.read()
    controller._process_sensors(snapshot)
    controller._last = snapshot


def events_of(controller: RvmController, event_type: str) -> list[dict]:
    return [row for row in controller.db.pending(500) if row["eventType"] == event_type]


class PhysicalLikeHardware:
    """HardwareAdapter without the mock's simulated camera signals or the
    mock-only sensor reset, standing in for the GPIO driver."""

    def __init__(self):
        self.snapshot = SensorSnapshot()
        self.input_gate_open = False
        self.conveyor = "STOPPED"
        self.compactor = False

    def read(self) -> SensorSnapshot:
        return SensorSnapshot(**self.snapshot.to_dict())

    def set_sensors(self, **values) -> None:
        for key, value in values.items():
            setattr(self.snapshot, key, value)

    def set_input_gate(self, open_: bool) -> None:
        self.input_gate_open = open_

    def set_conveyor(self, direction: str) -> None:
        self.conveyor = direction

    def set_compactor(self, active: bool) -> None:
        self.compactor = active

    def all_stop(self) -> None:
        self.input_gate_open = False
        self.conveyor = "STOPPED"
        self.compactor = False

    def close(self) -> None:
        self.all_stop()


class SafetyAssertions(unittest.TestCase):
    def assert_outputs_off(self, controller: RvmController) -> None:
        hardware = controller.hardware
        self.assertFalse(hardware.input_gate_open, "input gate must be closed")
        self.assertEqual(hardware.conveyor, "STOPPED")
        self.assertFalse(hardware.compactor, "compactor must be off")

    def assert_latched(self, controller: RvmController, reason: str) -> None:
        self.assertEqual(controller.state, MachineState.SAFE_STATE)
        self.assertEqual(controller.db.get_json("safe_reason"), reason)
        self.assertIsNotNone(controller._active_alert)
        self.assertEqual(controller._active_alert["reason"], reason)
        self.assertEqual(controller._active_alert["severity"], "CRITICAL")


# --------------------------------------------------------------------------- #
# interlock conditions: a valid lease never beats a local safety condition
# --------------------------------------------------------------------------- #
class InterlockGuardTest(SafetyAssertions):
    def test_lease_and_gate_refused_while_unsafe_condition_present(self):
        cases = {
            "service-panel-open": ({"service_panel_open": True}, "SERVICE_PANEL_OPEN"),
            "collection-door-open": ({"collection_door_open": True}, "COLLECTION_DOOR_OPEN"),
            "overtemperature": ({"temperature_c": 70.0}, "HIGH_TEMPERATURE"),
            "high-vibration": ({"vibration_g": 4.0}, "HIGH_VIBRATION"),
            "camera-occluded": ({"camera_occluded": True}, "CAMERA_OCCLUDED"),
            "camera-offline": ({"camera_online": False}, "CAMERA_OFFLINE"),
            "bin-full": ({"fill_percent": 96}, "MACHINE_FULL"),
        }
        for name, (sensors, reason) in cases.items():
            with self.subTest(condition=name), tempfile.TemporaryDirectory() as tmp:
                controller = make_controller(tmp)
                try:
                    controller.hardware.patch(**sensors)
                    self.assertFalse(controller.activate_lease(signed_lease()))
                    self.assertIsNone(controller.db.active_lease())
                    self.assertEqual(controller.state, MachineState.IDLE)
                    self.assert_outputs_off(controller)
                    self.assertEqual(
                        controller.actuation_block_reason(controller.hardware.read()), reason
                    )
                    self.assertFalse(controller.try_open_input_gate("test"))
                    self.assert_outputs_off(controller)
                finally:
                    controller.db.close()

    def test_lease_refused_in_maintenance_and_full_states(self):
        for state, reason in (
            (MachineState.MAINTENANCE, "MAINTENANCE_MODE"),
            (MachineState.FULL, "MACHINE_FULL"),
        ):
            with self.subTest(state=state), tempfile.TemporaryDirectory() as tmp:
                controller = make_controller(tmp)
                try:
                    controller.set_state(state, "test-setup")
                    self.assertFalse(controller.activate_lease(signed_lease()))
                    self.assertEqual(controller.state, state)
                    self.assertIsNone(controller.db.active_lease())
                    self.assert_outputs_off(controller)
                    self.assertEqual(
                        controller.actuation_block_reason(controller.hardware.read()), reason
                    )
                finally:
                    controller.db.close()

    def test_enabled_camera_must_be_online_and_unobstructed(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp, camera_enabled=True)
            try:
                controller.camera.status.online = False
                self.assertFalse(controller.activate_lease(signed_lease()))
                self.assertEqual(
                    controller.actuation_block_reason(controller.hardware.read()),
                    "CAMERA_OFFLINE",
                )
                controller.camera.status.online = True
                controller.camera.status.occluded = True
                self.assertFalse(controller.activate_lease(signed_lease()))
                self.assertEqual(
                    controller.actuation_block_reason(controller.hardware.read()),
                    "CAMERA_OCCLUDED",
                )
                self.assert_outputs_off(controller)
                # Requirement met: the same lease now opens the gate.
                controller.camera.status.occluded = False
                self.assertIsNone(controller.actuation_block_reason(controller.hardware.read()))
                self.assertTrue(controller.activate_lease(signed_lease()))
                self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
                self.assertTrue(controller.hardware.input_gate_open)
            finally:
                controller.db.close()

    def test_latch_keeps_blocking_after_the_condition_clears(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                controller.hardware.patch(vibration_g=4.0)
                sensor_pass(controller)
                controller.hardware.patch(vibration_g=0.02)
                sensor_pass(controller)
                self.assert_latched(controller, "HIGH_IMPACT_DETECTED")
                self.assertFalse(controller.activate_lease(signed_lease()))
                self.assert_latched(controller, "HIGH_IMPACT_DETECTED")
                self.assertEqual(
                    controller.actuation_block_reason(controller.hardware.read()),
                    "SAFETY_LATCH_ACTIVE",
                )
                # An unrelated state transition cannot leave the latched state...
                controller.set_state(MachineState.IDLE, "test-unrelated-write")
                self.assert_latched(controller, "HIGH_IMPACT_DETECTED")
                # ...and even if the in-memory state were corrupted, the
                # persisted latch (safe_reason + critical alert) still blocks.
                controller.state = MachineState.IDLE
                self.assertFalse(controller.activate_lease(signed_lease()))
                self.assertFalse(controller.try_open_input_gate("test"))
                self.assert_outputs_off(controller)
            finally:
                controller.db.close()


# --------------------------------------------------------------------------- #
# level-triggered door checks
# --------------------------------------------------------------------------- #
class LevelTriggeredDoorTest(SafetyAssertions):
    def test_panel_held_open_forces_outputs_off_on_every_tick(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                self.assertTrue(controller.activate_lease(signed_lease()))
                controller.hardware.patch(service_panel_open=True)
                for _tick in range(3):
                    # Something drove the outputs on behind the controller's back
                    # (stuck relay, racing writer); the open panel must win again.
                    controller.hardware.set_input_gate(True)
                    controller.hardware.set_conveyor("FORWARD")
                    controller.hardware.set_compactor(True)
                    sensor_pass(controller)
                    self.assert_outputs_off(controller)
                    self.assert_latched(controller, "SERVICE_PANEL_FORCED_OPEN")
                # Latching is level-triggered but alerting is not repeated per tick.
                self.assertEqual(len(events_of(controller, "SAFE_STATE_ENTERED")), 1)
            finally:
                controller.db.close()

    def test_door_already_open_relatches_without_a_new_rising_edge(self):
        for sensor, reason in (
            ("service_panel_open", "SERVICE_PANEL_FORCED_OPEN"),
            ("collection_door_open", "COLLECTION_DOOR_FORCED_OPEN"),
        ):
            with self.subTest(sensor=sensor), tempfile.TemporaryDirectory() as tmp:
                controller = make_controller(tmp)
                try:
                    controller.hardware.patch(**{sensor: True})
                    sensor_pass(controller)
                    self.assert_latched(controller, reason)
                    # A stale/foreign write clears the latch while the door is
                    # still open; the next tick sees no edge but must re-latch.
                    controller.db.set_json("safe_reason", None)
                    controller._clear_alert()
                    controller.set_state(MachineState.IDLE, "test-stale-write")
                    controller.hardware.set_input_gate(True)
                    sensor_pass(controller)
                    self.assert_latched(controller, reason)
                    self.assert_outputs_off(controller)
                finally:
                    controller.db.close()


# --------------------------------------------------------------------------- #
# lease renew / new session / cancel / expiry while latched
# --------------------------------------------------------------------------- #
class LatchedLeaseEventsTest(SafetyAssertions):
    REASON = "SERVICE_PANEL_FORCED_OPEN"

    def latched_controller(self, tmp: str) -> tuple[RvmController, dict]:
        controller = make_controller(tmp)
        lease = signed_lease("session-a")
        self.assertTrue(controller.activate_lease(lease))
        controller.hardware.patch(service_panel_open=True)
        sensor_pass(controller)
        controller.hardware.patch(service_panel_open=False)
        sensor_pass(controller)
        self.assert_latched(controller, self.REASON)
        self.assert_outputs_off(controller)
        return controller, lease

    def poll(self, controller: RvmController, payload: dict | None) -> None:
        controller.sync.fetch_machine_session = lambda: payload
        controller.sync.fetch_display = lambda: None
        controller._poll_server_session()

    def test_server_lease_events_never_open_outputs_or_clear_the_latch(self):
        def renew(controller, lease):
            renewed = signed_lease("session-a", lease_id="lease-session-a-renewed", ttl=600)
            self.poll(controller, {"lease": renewed, "session": {"id": "session-a"}})

        def new_session(controller, lease):
            self.poll(controller, {"lease": signed_lease("session-b"), "session": {"id": "session-b"}})
            self.assertIsNone(controller.db.active_lease())

        def cancel(controller, lease):
            self.poll(controller, {"lease": None, "session": None})
            self.assertIsNone(controller.db.active_lease())

        def expiry(controller, lease):
            controller.db.save_lease(
                {**lease, "expiresAt": time.time() - 1, "status": "ACTIVE"}
            )
            sensor_pass(controller)
            renewed = signed_lease("session-a", lease_id="lease-session-a-renewed", ttl=600)
            self.poll(controller, {"lease": renewed, "session": {"id": "session-a"}})
            self.assertIsNone(controller.db.active_lease())

        for name, event in {
            "renew": renew, "new-session": new_session, "cancel": cancel, "expiry": expiry,
        }.items():
            with self.subTest(event=name), tempfile.TemporaryDirectory() as tmp:
                controller, lease = self.latched_controller(tmp)
                try:
                    opened_before = len(events_of(controller, "CHAMBER_OPENED"))
                    event(controller, lease)
                    sensor_pass(controller)
                    self.assert_latched(controller, self.REASON)
                    self.assert_outputs_off(controller)
                    self.assertEqual(
                        len(events_of(controller, "CHAMBER_OPENED")), opened_before
                    )
                finally:
                    controller.db.close()

    def test_session_end_keeps_maintenance_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                self.assertTrue(controller.activate_lease(signed_lease()))
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                self.poll(controller, {"lease": None, "session": None})
                self.assertEqual(controller.state, MachineState.MAINTENANCE)
                self.assertIsNone(controller.db.active_lease())
                self.assert_outputs_off(controller)
            finally:
                controller.db.close()


# --------------------------------------------------------------------------- #
# every actuator path goes through the interlock
# --------------------------------------------------------------------------- #
class ActuatorPathTest(SafetyAssertions):
    def item_in_processing(self, tmp: str) -> tuple[RvmController, list]:
        controller = make_controller(tmp, camera_enabled=True)
        controller.camera.status.online = True
        self.assertTrue(controller.activate_lease(signed_lease()))
        writes: list = []
        hardware = controller.hardware
        real_conveyor, real_compactor, real_gate = (
            hardware.set_conveyor, hardware.set_compactor, hardware.set_input_gate,
        )
        hardware.set_conveyor = lambda d: (writes.append(("conveyor", d)), real_conveyor(d))
        hardware.set_compactor = lambda a: (writes.append(("compactor", a)), real_compactor(a))
        hardware.set_input_gate = lambda o: (writes.append(("gate", o)), real_gate(o))
        hardware.patch(chamber_open=True)
        sensor_pass(controller)
        hardware.patch(item_present=True)
        sensor_pass(controller)
        self.assertEqual(controller.state, MachineState.PROCESSING)
        # The camera loses sight of the chamber while the item is processed.
        controller.camera.status.occluded = True
        return controller, writes

    def test_conveyor_and_compactor_refused_when_interlock_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller, writes = self.item_in_processing(tmp)
            try:
                controller.hardware.patch(item_present=False, weight_grams=22.0, weight_stable=True)
                sensor_pass(controller)
                controller.hardware.patch(acceptance_triggered=True)
                sensor_pass(controller)
                self.assertNotIn(("conveyor", "FORWARD"), writes)
                self.assertNotIn(("compactor", True), writes)
                self.assertEqual(events_of(controller, "CONVEYOR_STARTED"), [])
                self.assertEqual(events_of(controller, "COMPACTION_STARTED"), [])
                # An item the conveyor never moved must not be credited: the
                # server credits on ITEM_ACCEPTED_POINT.
                self.assertEqual(events_of(controller, "ITEM_ACCEPTED_POINT"), [])
                rejected = events_of(controller, "ITEM_REJECTED")
                self.assertEqual(len(rejected), 1)
                self.assertEqual(
                    rejected[0]["payload"],
                    {"reason": "ACTUATION_BLOCKED", "blockedBy": "CAMERA_OCCLUDED"},
                )
                self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
                self.assert_outputs_off(controller)
            finally:
                controller.db.close()

    def test_gate_reopen_after_rejected_item_refused_when_interlock_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller, writes = self.item_in_processing(tmp)
            try:
                controller.hardware.patch(item_present=False, weight_grams=900.0, weight_stable=True)
                sensor_pass(controller)
                self.assertEqual(len(events_of(controller, "ITEM_REJECTED")), 1)
                self.assertNotIn(("gate", True), writes)
                self.assert_outputs_off(controller)
            finally:
                controller.db.close()

    def test_maintenance_jog_is_interlocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                # Jogs are only accepted in MAINTENANCE (J1a); there, a
                # physical hazard still refuses them.
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                controller.hardware.patch(service_panel_open=True)
                for command, data in (
                    ("gate", {"open": True}),
                    ("conveyor", {"direction": "FORWARD"}),
                    ("conveyor", {"direction": "REVERSE"}),
                    ("compactor", {"active": True}),
                ):
                    with self.subTest(command=command, data=data):
                        with self.assertRaisesRegex(ValueError, "panel masih terbuka"):
                            controller.maintenance_command(command, data)
                        self.assert_outputs_off(controller)
                # With every condition clear a technician may jog outputs in
                # maintenance mode.
                controller.hardware.patch(service_panel_open=False)
                controller.maintenance_command("gate", {"open": True})
                self.assertTrue(controller.hardware.input_gate_open)
                controller.maintenance_command("conveyor", {"direction": "FORWARD"})
                self.assertEqual(controller.hardware.conveyor, "FORWARD")
            finally:
                controller.db.close()

    def test_close_and_stop_always_allowed_while_latched(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                controller.hardware.patch(service_panel_open=True)
                sensor_pass(controller)
                self.assert_latched(controller, "SERVICE_PANEL_FORCED_OPEN")
                controller.maintenance_command("gate", {"open": False})
                controller.maintenance_command("conveyor", {"direction": "STOPPED"})
                controller.maintenance_command("compactor", {"active": False})
                controller.execute_remote_command("CLOSE_GATE", {})
                controller.execute_remote_command("STOP_ALL", {})
                self.assert_outputs_off(controller)
                self.assert_latched(controller, "SERVICE_PANEL_FORCED_OPEN")
            finally:
                controller.db.close()

    def test_remote_open_gate_and_resume_respect_interlock(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                self.assertTrue(controller.activate_lease(signed_lease()))
                controller.hardware.set_input_gate(False)
                # The panel opens; the control loop has not ticked yet.
                controller.hardware.patch(service_panel_open=True)
                with self.assertRaisesRegex(ValueError, "Gate tidak dapat dibuka"):
                    controller.execute_remote_command("OPEN_GATE", {})
                self.assert_outputs_off(controller)
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                controller.execute_remote_command("RESUME_OPERATION", {})
                self.assert_outputs_off(controller)
            finally:
                controller.db.close()


# --------------------------------------------------------------------------- #
# J1: jogs only in MAINTENANCE; a session only starts from a stopped machine
# --------------------------------------------------------------------------- #
class SessionStartFromStoppedMachineTest(SafetyAssertions):
    JOGS = (
        ("gate", {"open": True}),
        ("conveyor", {"direction": "FORWARD"}),
        ("conveyor", {"direction": "REVERSE"}),
        ("compactor", {"active": True}),
    )

    @staticmethod
    def drive_output_on(controller: RvmController, output: str) -> None:
        """The reviewer's probe jogged the output from the maintenance API in
        IDLE, which J1(a) now refuses; a relay driven on behind the
        controller's back (stuck relay, foreign writer) is the same hazard."""
        if output == "compactor":
            controller.hardware.set_compactor(True)
        else:
            controller.hardware.set_conveyor("FORWARD")

    def assert_session_open_with_only_the_gate(self, controller: RvmController) -> None:
        self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
        self.assertTrue(controller.hardware.input_gate_open)
        self.assertEqual(controller.hardware.conveyor, "STOPPED")
        self.assertFalse(controller.hardware.compactor, "compactor must be off")

    def test_maintenance_jog_requires_maintenance_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                # The reviewer's probe: a PIN-authorised jog in IDLE.
                for command, data in self.JOGS:
                    with self.subTest(state="IDLE", command=command, data=data):
                        with self.assertRaisesRegex(ValueError, "mode maintenance"):
                            controller.maintenance_command(command, data)
                        self.assert_outputs_off(controller)
                        self.assertEqual(controller.state, MachineState.IDLE)
                # A refused jog does not disturb a user's session.
                self.assertTrue(controller.activate_lease(signed_lease()))
                with self.assertRaisesRegex(ValueError, "mode maintenance"):
                    controller.maintenance_command("compactor", {"active": True})
                self.assert_session_open_with_only_the_gate(controller)
                # Latched: refused for the mode, and in MAINTENANCE by the latch.
                controller.enter_safe_state("HIGH_IMPACT_DETECTED", {"vibrationG": 4.8})
                with self.assertRaisesRegex(ValueError, "mode maintenance"):
                    controller.maintenance_command("conveyor", {"direction": "FORWARD"})
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                with self.assertRaisesRegex(ValueError, "alert keselamatan belum direset"):
                    controller.maintenance_command("conveyor", {"direction": "FORWARD"})
                self.assert_outputs_off(controller)
                # MAINTENANCE may be entered while latched; the latch persists.
                self.assertEqual(controller.state, MachineState.MAINTENANCE)
                self.assertEqual(controller.db.get_json("safe_reason"), "HIGH_IMPACT_DETECTED")
                self.assertEqual(controller._active_alert["severity"], "CRITICAL")
                self.assertTrue(controller._safety_latch_active())
            finally:
                controller.db.close()
        # Positive control: in MAINTENANCE every jog is accepted.
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                for command, data in self.JOGS:
                    controller.maintenance_command(command, data)
                self.assertTrue(controller.hardware.input_gate_open)
                self.assertEqual(controller.hardware.conveyor, "REVERSE")
                self.assertTrue(controller.hardware.compactor)
            finally:
                controller.db.close()

    def test_lease_stops_running_outputs_before_opening_the_gate(self):
        for output in ("compactor", "conveyor"):
            with self.subTest(output=output), tempfile.TemporaryDirectory() as tmp:
                controller = make_controller(tmp)
                try:
                    hardware = controller.hardware
                    self.drive_output_on(controller, output)
                    writes: list = []
                    real_all_stop, real_gate = hardware.all_stop, hardware.set_input_gate
                    hardware.all_stop = lambda: (writes.append("all_stop"), real_all_stop())
                    hardware.set_input_gate = lambda o: (writes.append(("gate", o)), real_gate(o))

                    self.assertTrue(controller.activate_lease(signed_lease()))
                    self.assert_session_open_with_only_the_gate(controller)
                    # Every output was stopped before the gate opened to the user.
                    self.assertIn("all_stop", writes)
                    self.assertLess(writes.index("all_stop"), writes.index(("gate", True)))
                finally:
                    controller.db.close()

    def test_jog_left_running_in_maintenance_is_stopped_before_the_next_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                controller.maintenance_command("compactor", {"active": True})
                controller.maintenance_command("conveyor", {"direction": "FORWARD"})
                controller.execute_remote_command("RESUME_OPERATION", {})
                self.assertEqual(controller.state, MachineState.IDLE)
                self.assert_outputs_off(controller)
                self.assertTrue(controller.activate_lease(signed_lease()))
                self.assert_session_open_with_only_the_gate(controller)
            finally:
                controller.db.close()

    def test_failed_stop_at_session_start_latches_and_refuses_the_lease(self):
        for persistent in (False, True):
            with self.subTest(persistent=persistent), tempfile.TemporaryDirectory() as tmp:
                controller = make_controller(tmp)
                try:
                    hardware = controller.hardware
                    self.drive_output_on(controller, "compactor")
                    if persistent:
                        fault = OutputFaultTest.break_all_stop(controller)
                    else:
                        fail_next_all_stop(hardware)
                    with self.assertLogs("rvm.controller", level="ERROR"):
                        self.assertFalse(controller.activate_lease(signed_lease()))
                    # Nothing saved, the gate never opened, and the machine is latched.
                    self.assertIsNone(controller.db.active_lease())
                    self.assertFalse(hardware.input_gate_open)
                    self.assertEqual(events_of(controller, "CHAMBER_OPENED"), [])
                    self.assert_latched(controller, "OUTPUT_STOP_FAILED")
                    self.assertFalse(controller.activate_lease(signed_lease("session-retry")))
                    if persistent:
                        # The compactor really is still running: every
                        # actuation and reset is refused until a stop succeeds.
                        self.assertTrue(hardware.compactor)
                        self.assertEqual(
                            controller.actuation_block_reason(hardware.read()), "OUTPUT_STOP_FAILED"
                        )
                        with self.assertRaisesRegex(ValueError, "output gagal dimatikan"):
                            controller.execute_remote_command("RESET_ALERT", {})
                        fault["active"] = False
                    # The latched tick retries the stop; the latch outlives it.
                    for _tick in range(3):
                        controller._tick()
                    self.assert_outputs_off(controller)
                    self.assert_latched(controller, "OUTPUT_STOP_FAILED")
                    self.assertFalse(controller.activate_lease(signed_lease("session-retry")))
                    # No wedge: the operator reset clears it and a session starts.
                    controller.execute_remote_command("RESET_ALERT", {})
                    self.assertEqual(controller.state, MachineState.IDLE)
                    self.assertTrue(controller.activate_lease(signed_lease("session-after-reset")))
                    self.assert_session_open_with_only_the_gate(controller)
                finally:
                    controller.db.close()


# --------------------------------------------------------------------------- #
# reset: only a legitimate operator action with every condition safe
# --------------------------------------------------------------------------- #
class LatchResetTest(SafetyAssertions):
    def test_reset_refused_while_unsafe_on_physical_adapter(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                hardware = PhysicalLikeHardware()
                controller.hardware = hardware
                hardware.set_sensors(service_panel_open=True)
                sensor_pass(controller)
                self.assert_latched(controller, "SERVICE_PANEL_FORCED_OPEN")
                with self.assertRaisesRegex(ValueError, "panel masih terbuka"):
                    controller.execute_remote_command("RESET_ALERT", {})
                with self.assertRaisesRegex(ValueError, "panel masih terbuka"):
                    controller.maintenance_command("reset-safe-state", {})
                self.assert_latched(controller, "SERVICE_PANEL_FORCED_OPEN")
                self.assert_outputs_off(controller)

                hardware.set_sensors(service_panel_open=False)
                controller.execute_remote_command("RESET_ALERT", {})
                self.assertEqual(controller.state, MachineState.IDLE)
                self.assertIsNone(controller.db.get_json("safe_reason"))
                self.assertIsNone(controller._active_alert)
                self.assert_outputs_off(controller)
            finally:
                controller.db.close()


# --------------------------------------------------------------------------- #
# concurrency: interlock check and output write are atomic vs. the sensor loop
# --------------------------------------------------------------------------- #
class InterlockRaceTest(SafetyAssertions):
    def test_panel_opening_during_gate_request_cannot_bypass_interlock(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                self.assertTrue(controller.activate_lease(signed_lease("session-race")))
                hardware = controller.hardware
                hardware.set_input_gate(False)  # closed while an item was processed

                events: list = []
                result: list = []
                guard_passed = threading.Event()
                panel_opened = threading.Event()
                real_read, real_set_gate = hardware.read, hardware.set_input_gate
                requester = threading.Thread(
                    target=lambda: result.append(controller.try_open_input_gate("race-test")),
                    name="gate-request",
                    daemon=True,
                )

                def read():
                    snapshot = real_read()
                    source = "guard-read" if threading.current_thread() is requester else "tick-read"
                    events.append((source, snapshot.service_panel_open))
                    return snapshot

                def set_input_gate(open_):
                    if threading.current_thread() is requester and open_:
                        # The interlock check has passed. Hold the request
                        # between check and output write while the panel opens
                        # and the control loop tries to tick.
                        guard_passed.set()
                        panel_opened.wait(2)
                        time.sleep(0.1)
                    events.append(("gate-write", open_))
                    real_set_gate(open_)

                hardware.read = read
                hardware.set_input_gate = set_input_gate

                def sensor_loop():
                    guard_passed.wait(2)
                    hardware.patch(service_panel_open=True)
                    events.append(("panel-opened",))
                    panel_opened.set()
                    controller._tick()

                sensor = threading.Thread(target=sensor_loop, name="sensor-loop", daemon=True)
                sensor.start()
                requester.start()
                requester.join(5)
                sensor.join(5)
                self.assertFalse(requester.is_alive())
                self.assertFalse(sensor.is_alive())

                self.assertEqual(events[:2], [("guard-read", False), ("panel-opened",)])
                # The loop could not observe the panel between the guard's check
                # and its write: it ticked only after the write...
                self.assertLess(
                    events.index(("gate-write", True)), events.index(("tick-read", True))
                )
                self.assertEqual(result, [True])
                # ...and that tick latched the machine and closed the gate.
                self.assert_latched(controller, "SERVICE_PANEL_FORCED_OPEN")
                self.assert_outputs_off(controller)
            finally:
                controller.db.close()


# --------------------------------------------------------------------------- #
# STOP_ALL and the safety loop never wait for the network
# --------------------------------------------------------------------------- #
class NetworkIndependenceTest(SafetyAssertions):
    @staticmethod
    def hang_sync_now(controller, entered, release):
        def flush_once():
            entered.set()
            release.wait(5)
            return False

        controller.sync.flush_once = flush_once
        controller.sync.flush_captures = lambda: True
        return lambda: controller.execute_remote_command("SYNC_NOW", {})

    @staticmethod
    def hang_capture_snapshot(controller, entered, release):
        def flush_captures():
            entered.set()
            release.wait(5)
            return False

        controller.camera.capture_evidence = lambda *a, **k: {
            "id": "remote-capture", "kind": "REMOTE", "reason": "SUPERADMIN_SNAPSHOT",
            "sessionId": None, "imagePath": "unused.jpg", "facePaths": [],
            "faceCount": 0, "personDetected": False, "occurredAt": iso_now(),
        }
        controller.sync.flush_captures = flush_captures
        return lambda: controller.execute_remote_command("CAPTURE_SNAPSHOT", {})

    @staticmethod
    def hang_session_poll(controller, entered, release):
        def fetch_machine_session():
            entered.set()
            release.wait(5)
            return None

        controller.sync.fetch_machine_session = fetch_machine_session
        controller.sync.fetch_display = lambda: None
        return controller._poll_server_session

    def test_stop_all_and_safety_tick_never_wait_for_network(self):
        for name, arrange in {
            "SYNC_NOW": self.hang_sync_now,
            "CAPTURE_SNAPSHOT": self.hang_capture_snapshot,
            "session-poll": self.hang_session_poll,
        }.items():
            with self.subTest(network_operation=name), tempfile.TemporaryDirectory() as tmp:
                controller = make_controller(tmp, camera_enabled=True)
                controller.camera.status.online = True
                threads: list[threading.Thread] = []
                entered, release = threading.Event(), threading.Event()
                try:
                    self.assertTrue(controller.activate_lease(signed_lease()))
                    self.assertTrue(controller.hardware.input_gate_open)
                    network = threading.Thread(
                        target=arrange(controller, entered, release), daemon=True
                    )
                    threads.append(network)
                    network.start()
                    self.assertTrue(entered.wait(2), "network operation never started")

                    stop = threading.Thread(
                        target=lambda: controller.execute_remote_command("STOP_ALL", {}),
                        daemon=True,
                    )
                    threads.append(stop)
                    stop.start()
                    stop.join(1)
                    self.assertFalse(stop.is_alive(), f"STOP_ALL waited for {name}")
                    self.assert_outputs_off(controller)

                    controller.hardware.patch(service_panel_open=True)
                    tick = threading.Thread(target=controller._tick, daemon=True)
                    threads.append(tick)
                    tick.start()
                    tick.join(1)
                    self.assertFalse(tick.is_alive(), f"safety tick waited for {name}")
                    self.assert_latched(controller, "SERVICE_PANEL_FORCED_OPEN")
                    self.assert_outputs_off(controller)
                finally:
                    release.set()
                    for thread in threads:
                        thread.join(5)
                    controller.db.close()

    def test_stop_all_effective_when_polling_and_result_report_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                self.assertTrue(controller.activate_lease(signed_lease()))
                controller.hardware.set_conveyor("FORWARD")
                command = {"id": "cmd-stop", "command": "STOP_ALL", "payload": {}}
                # Network down, then STOP_ALL, then the server re-delivers it
                # because the result report failed.
                deliveries = [None, command, command]

                def fetch_remote_command():
                    item = deliveries.pop(0)
                    if not deliveries:
                        controller.running = False
                    return item

                reports: list = []
                executed: list = []
                real_execute = controller.execute_remote_command

                def execute(cmd, payload=None):
                    executed.append(cmd)
                    return real_execute(cmd, payload)

                controller.sync.fetch_remote_command = fetch_remote_command
                def report_remote_command(command_id, **report):
                    reports.append((command_id, report))
                    return False  # result report lost: network down

                controller.sync.report_remote_command = report_remote_command
                controller.execute_remote_command = execute
                controller.running = True
                with mock.patch("rvm.remote.time.sleep", lambda *_a: None):
                    controller._remote_loop()

                self.assert_outputs_off(controller)
                self.assertEqual(executed, ["STOP_ALL"])
                self.assertEqual(len(reports), 2)
                self.assertEqual(reports[0], reports[1])
                self.assertTrue(reports[0][1]["success"])
            finally:
                controller.running = False
                controller.db.close()


    def test_remote_io_commands_are_bounded_by_http_timeouts(self):
        """A slow server cannot hold the single remote-command loop forever:
        every HTTP call made by SYNC_NOW / CAPTURE_SNAPSHOT carries a finite
        timeout, and their sum stays within the worst case documented in
        rvm/README.md (45 s and 40 s)."""
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp, camera_enabled=True)
            try:
                def capture(capture_id: str) -> dict:
                    image = Path(tmp) / f"{capture_id}.jpg"
                    image.write_bytes(b"jpeg")
                    return {
                        "id": capture_id, "kind": "SECURITY", "reason": "TEST",
                        "sessionId": None, "imagePath": str(image), "facePaths": [],
                        "faceCount": 0, "personDetected": False, "occurredAt": iso_now(),
                    }

                for n in range(3):
                    controller.db.enqueue_capture(capture(f"backlog-{n}"))
                controller.emit("HEARTBEAT", {"status": "ONLINE"})
                controller.camera.capture_evidence = lambda *a, **k: capture("remote")
                timeouts: list = []

                def urlopen(request, timeout=None):
                    timeouts.append(timeout)
                    raise urllib.error.URLError("timed out")

                with mock.patch("rvm.sync.urllib.request.urlopen", urlopen):
                    for command, bound in (("SYNC_NOW", 45), ("CAPTURE_SNAPSHOT", 40)):
                        with self.subTest(command=command):
                            timeouts.clear()
                            controller.execute_remote_command(command, {})
                            self.assertTrue(timeouts)
                            self.assertTrue(
                                all(isinstance(t, (int, float)) and t > 0 for t in timeouts),
                                timeouts,
                            )
                            self.assertLessEqual(sum(timeouts), bound)
                    timeouts.clear()
                    controller.sync.fetch_remote_command()
                    controller.sync.report_remote_command("cmd", True)
                    self.assertEqual(timeouts, [3, 5])
            finally:
                controller.db.close()


# --------------------------------------------------------------------------- #
# an output fault never kills the loops or loses the latch
# --------------------------------------------------------------------------- #
class OutputFaultTest(SafetyAssertions):
    @staticmethod
    def break_all_stop(controller: RvmController) -> dict:
        real_all_stop = controller.hardware.all_stop
        fault = {"active": True}

        def all_stop():
            if fault["active"]:
                raise OSError("gpio write failed")
            real_all_stop()

        controller.hardware.all_stop = all_stop
        return fault

    @staticmethod
    def stop_fault_events(controller: RvmController) -> list[dict]:
        return [
            event for event in events_of(controller, "ERROR")
            if event["payload"].get("reason") == "OUTPUT_STOP_FAILED"
        ]

    def test_failing_all_stop_still_persists_the_latch(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                self.assertTrue(controller.activate_lease(signed_lease()))
                fault = self.break_all_stop(controller)
                controller.hardware.patch(service_panel_open=True)
                with self.assertLogs("rvm.controller", level="ERROR"):
                    for _tick in range(3):
                        sensor_pass(controller)
                self.assert_latched(controller, "OUTPUT_STOP_FAILED")
                # Surfaced once per fault episode, not on every tick.
                self.assertEqual(len(self.stop_fault_events(controller)), 1)
                fault["active"] = False
                sensor_pass(controller)
                self.assert_outputs_off(controller)
                self.assert_latched(controller, "OUTPUT_STOP_FAILED")
            finally:
                controller.db.close()

    def test_control_loop_survives_failing_all_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            loop = threading.Thread(target=controller._run, name="control-loop", daemon=True)
            try:
                self.assertTrue(controller.activate_lease(signed_lease()))
                fault = self.break_all_stop(controller)
                controller.hardware.patch(service_panel_open=True)
                with self.assertLogs("rvm.controller", level="ERROR"):
                    controller.running = True
                    loop.start()
                    deadline = time.time() + 2
                    while controller.state != MachineState.SAFE_STATE and time.time() < deadline:
                        time.sleep(0.02)
                    time.sleep(0.2)  # several ticks while the output fault persists
                    self.assertTrue(loop.is_alive(), "control loop died on an output fault")
                    self.assert_latched(controller, "OUTPUT_STOP_FAILED")

                    fault["active"] = False
                    deadline = time.time() + 2
                    while controller.hardware.input_gate_open and time.time() < deadline:
                        time.sleep(0.02)
                    self.assertTrue(loop.is_alive())
                    self.assert_outputs_off(controller)
                    self.assert_latched(controller, "OUTPUT_STOP_FAILED")
            finally:
                controller.running = False
                if loop.ident is not None:
                    loop.join(2)
                controller.db.close()

    def test_session_loop_survives_poll_errors_and_failing_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                # The lease is refused by the open panel, and the refusal's
                # all_stop fails as well.
                controller.hardware.patch(service_panel_open=True)
                self.break_all_stop(controller)
                polls: list = []

                def fetch_machine_session():
                    polls.append(len(polls))
                    if len(polls) == 1:
                        raise RuntimeError("malformed session payload")
                    if len(polls) == 3:
                        controller.running = False
                    return {"lease": signed_lease(), "session": None}

                controller.sync.fetch_machine_session = fetch_machine_session
                controller.sync.fetch_display = lambda: None
                controller.running = True
                with self.assertLogs("rvm.controller", level="WARNING"), mock.patch(
                    "rvm.controller.time.sleep", lambda *_a: None
                ):
                    controller._lease_loop()
                self.assertEqual(len(polls), 3)
                self.assertIsNone(controller.db.active_lease())
                # The refusal's failed stop latches the machine instead of leaving it IDLE.
                self.assert_latched(controller, "OUTPUT_STOP_FAILED")
            finally:
                controller.running = False
                controller.db.close()


class OutputStopFailureLatchTest(SafetyAssertions):
    """A failed all_stop on any path ends latched in SAFE_STATE with the stop
    retried every tick until it succeeds; no lease activates meanwhile and
    only the validated operator reset clears the latch."""

    @staticmethod
    def wait_for(predicate, timeout: float = 2.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if predicate():
                return True
            time.sleep(0.02)
        return predicate()

    @staticmethod
    def trigger_full(controller, lease):
        controller.hardware.patch(fill_percent=96)

    @staticmethod
    def trigger_lease_expiry(controller, lease):
        controller.db.save_lease({**lease, "expiresAt": time.time() - 1, "status": "ACTIVE"})

    @staticmethod
    def trigger_session_end(controller, lease):
        controller.sync.fetch_machine_session = lambda: {"lease": None, "session": None}
        controller.sync.fetch_display = lambda: None
        controller._poll_server_session()

    def test_failed_stop_latches_and_retries_until_outputs_are_off(self):
        triggers = {
            "full": self.trigger_full,
            "lease-expiry": self.trigger_lease_expiry,
            "session-end": self.trigger_session_end,
        }
        for name, trigger in triggers.items():
            for persistent in (False, True):
                with self.subTest(trigger=name, persistent=persistent):
                    self.run_failed_stop_scenario(trigger, persistent)

    def run_failed_stop_scenario(self, trigger, persistent: bool) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            loop = threading.Thread(target=controller._run, name="control-loop", daemon=True)
            try:
                lease = signed_lease()
                self.assertTrue(controller.activate_lease(lease))
                hardware = controller.hardware
                self.assertTrue(hardware.input_gate_open)
                real_all_stop = hardware.all_stop
                attempts: list = []
                fault = {"failures_left": float("inf") if persistent else 1}

                def all_stop():
                    attempts.append(time.time())
                    if fault["failures_left"] > 0:
                        fault["failures_left"] -= 1
                        raise OSError("gpio write failed")
                    real_all_stop()

                with self.assertLogs("rvm.controller", level="ERROR"):
                    controller.running = True
                    loop.start()
                    hardware.all_stop = all_stop
                    trigger(controller, lease)
                    self.assertTrue(
                        self.wait_for(lambda: controller.state == MachineState.SAFE_STATE),
                        f"not latched after a failed stop: {controller.state}",
                    )
                    self.assertEqual(controller.db.get_json("safe_reason"), "OUTPUT_STOP_FAILED")
                    self.assertFalse(controller.activate_lease(signed_lease("session-new")))

                    if persistent:
                        # The failing stop really left the gate open; it is
                        # retried on every tick and blocks every actuation.
                        self.assertTrue(hardware.input_gate_open)
                        before = len(attempts)
                        time.sleep(0.3)
                        self.assertGreater(len(attempts), before + 3, "stop not retried every tick")
                        self.assertEqual(
                            controller.actuation_block_reason(hardware.read()), "OUTPUT_STOP_FAILED"
                        )
                        self.assertFalse(controller.activate_lease(signed_lease("session-new")))
                        with self.assertRaisesRegex(ValueError, "output gagal dimatikan"):
                            controller.execute_remote_command("RESET_ALERT", {})
                        fault["failures_left"] = 0

                    self.assertTrue(
                        self.wait_for(lambda: not hardware.input_gate_open), "stop never succeeded"
                    )
                    self.assert_outputs_off(controller)
                    self.assertTrue(loop.is_alive())
                    # Outputs are off again, but only an operator reset clears the latch.
                    time.sleep(0.1)
                    self.assert_latched(controller, "OUTPUT_STOP_FAILED")
                    self.assertFalse(controller.activate_lease(signed_lease("session-new")))
                    controller.execute_remote_command("RESET_ALERT", {})
                    self.assertNotEqual(controller.state, MachineState.SAFE_STATE)
                    self.assertIsNone(controller.actuation_block_reason(hardware.read()))
            finally:
                controller.running = False
                if loop.ident is not None:
                    loop.join(2)
                controller.db.close()

    def test_safe_state_entered_reports_a_failed_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                def all_stop():
                    raise OSError("gpio write failed")

                controller.hardware.all_stop = all_stop
                with self.assertLogs("rvm.controller", level="ERROR"):
                    controller.enter_safe_state("SERVICE_PANEL_FORCED_OPEN", {})
                entered = [e["payload"] for e in events_of(controller, "SAFE_STATE_ENTERED")]
                self.assertEqual(
                    [e["reason"] for e in entered],
                    ["SERVICE_PANEL_FORCED_OPEN", "OUTPUT_STOP_FAILED"],
                )
                for payload in entered:
                    self.assertEqual(payload["outputsDisabled"], [])
                    self.assertTrue(payload["stopFailed"])
                # The output fault outranks the original reason at once.
                self.assert_latched(controller, "OUTPUT_STOP_FAILED")
            finally:
                controller.db.close()


def fail_next_write(hardware, method: str, value) -> None:
    """Makes the next `hardware.<method>(value)` call raise once."""
    real = getattr(hardware, method)
    armed = {"armed": True}

    def write(arg):
        if armed["armed"] and arg == value:
            armed["armed"] = False
            raise OSError(f"{method} write failed")
        real(arg)

    setattr(hardware, method, write)


def fail_next_all_stop(hardware) -> None:
    real = hardware.all_stop
    armed = {"armed": True}

    def all_stop():
        if armed["armed"]:
            armed["armed"] = False
            raise OSError("gpio write failed")
        real()

    hardware.all_stop = all_stop


class SingleOutputCloseFailureTest(SafetyAssertions):
    """A failed close/stop of one output latches SAFE_STATE (OUTPUT_STOP_FAILED),
    is reported to the caller, blocks every lease, and is cleared only by the
    operator reset (no wedge afterwards)."""

    def assert_latched_until_operator_reset(self, controller: RvmController) -> None:
        for _tick in range(3):
            controller._tick()
        self.assert_latched(controller, "OUTPUT_STOP_FAILED")
        self.assert_outputs_off(controller)
        self.assertIsNotNone(controller.actuation_block_reason(controller.hardware.read()))
        self.assertFalse(controller.activate_lease(signed_lease("session-blocked")))
        controller.execute_remote_command("RESET_ALERT", {})
        self.assertEqual(controller.state, MachineState.IDLE)
        self.assertTrue(controller.activate_lease(signed_lease("session-after-reset")))

    def test_p1_maintenance_compactor_stop_failure_latches(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                controller.maintenance_command("compactor", {"active": True})
                self.assertTrue(controller.hardware.compactor)
                fail_next_write(controller.hardware, "set_compactor", False)
                with self.assertLogs("rvm.controller", level="ERROR"):
                    with self.assertRaises(OSError):
                        controller.maintenance_command("compactor", {"active": False})
                    self.assert_latched_until_operator_reset(controller)
            finally:
                controller.db.close()

    def test_p1b_maintenance_conveyor_stop_failure_blocks_resume(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                controller.maintenance_command("conveyor", {"direction": "FORWARD"})
                fail_next_write(controller.hardware, "set_conveyor", "STOPPED")
                with self.assertLogs("rvm.controller", level="ERROR"):
                    with self.assertRaises(OSError):
                        controller.maintenance_command("conveyor", {"direction": "STOPPED"})
                    self.assert_latched(controller, "OUTPUT_STOP_FAILED")
                    with self.assertRaisesRegex(ValueError, "Reset alert"):
                        controller.execute_remote_command("RESUME_OPERATION", {})
                    self.assert_latched_until_operator_reset(controller)
            finally:
                controller.db.close()

    def test_resume_operation_requires_a_successful_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                # The technician leaves the conveyor running: resuming stops it.
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                controller.maintenance_command("conveyor", {"direction": "FORWARD"})
                controller.execute_remote_command("RESUME_OPERATION", {})
                self.assertEqual(controller.state, MachineState.IDLE)
                self.assert_outputs_off(controller)

                # If that stop fails, resuming is refused and the machine latches.
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                controller.maintenance_command("conveyor", {"direction": "FORWARD"})
                fail_next_all_stop(controller.hardware)
                with self.assertLogs("rvm.controller", level="ERROR"):
                    with self.assertRaisesRegex(RuntimeError, "Output tidak dapat dimatikan"):
                        controller.execute_remote_command("RESUME_OPERATION", {})
                    self.assert_latched_until_operator_reset(controller)
            finally:
                controller.db.close()

    def test_in_tick_close_failure_latches_and_loop_survives(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            loop = threading.Thread(target=controller._run, name="control-loop", daemon=True)
            try:
                self.assertTrue(controller.activate_lease(signed_lease()))
                fail_next_write(controller.hardware, "set_input_gate", False)
                with self.assertLogs("rvm.controller", level="ERROR"):
                    controller.running = True
                    loop.start()
                    # Item detected: closing the gate fails inside the control tick.
                    controller.hardware.patch(item_present=True)
                    self.assertTrue(OutputStopFailureLatchTest.wait_for(
                        lambda: controller.state == MachineState.SAFE_STATE
                    ))
                    time.sleep(0.5)  # several further ticks, including the error backoff
                    self.assertTrue(loop.is_alive())
                    # The loop's error handler keeps the root-cause latch reason.
                    self.assert_latched(controller, "OUTPUT_STOP_FAILED")
                    self.assert_outputs_off(controller)
                    self.assertFalse(controller.activate_lease(signed_lease("session-blocked")))
                    # The aborted tick's sensor edges are not processed twice.
                    self.assertEqual(events_of(controller, "FRAUD_DETECTED"), [])
            finally:
                controller.running = False
                if loop.ident is not None:
                    loop.join(2)
                controller.db.close()

    def test_p2_remote_close_gate_failure_latches(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                controller.maintenance_command("gate", {"open": True})
                self.assertTrue(controller.hardware.input_gate_open)
                fail_next_write(controller.hardware, "set_input_gate", False)
                with self.assertLogs("rvm.controller", level="ERROR"):
                    with self.assertRaises(OSError):
                        controller.execute_remote_command("CLOSE_GATE", {})
                    self.assert_latched_until_operator_reset(controller)
            finally:
                controller.db.close()


class LatchedStateVisibilityTest(SafetyAssertions):
    """A stop failure latched during item processing stays visible: the state
    is not overwritten, the CRITICAL alert is not downgraded by the fraud
    warning, the heartbeat reports ERROR, and a server session end does not
    turn it into a healthy-looking IDLE."""

    def item_in_processing(self, tmp: str) -> RvmController:
        controller = make_controller(tmp)
        self.assertTrue(controller.activate_lease(signed_lease()))
        controller.hardware.patch(chamber_open=True)
        sensor_pass(controller)
        controller.hardware.patch(item_present=True)
        sensor_pass(controller)
        self.assertEqual(controller.state, MachineState.PROCESSING)
        return controller

    def assert_visibly_latched(self, controller: RvmController) -> None:
        self.assert_latched(controller, "OUTPUT_STOP_FAILED")
        self.assertEqual(controller.heartbeat_payload()["status"], "ERROR")
        self.assertFalse(controller.activate_lease(signed_lease("session-blocked")))
        # The server ends the session: still latched, still reported as ERROR.
        controller.sync.fetch_machine_session = lambda: {"lease": None, "session": None}
        controller.sync.fetch_display = lambda: None
        controller._poll_server_session()
        self.assert_latched(controller, "OUTPUT_STOP_FAILED")
        self.assertEqual(controller.heartbeat_payload()["status"], "ERROR")
        self.assertFalse(controller.activate_lease(signed_lease("session-blocked")))

    def test_p3_processing_timeout_with_failed_stop_stays_latched(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.item_in_processing(tmp)
            try:
                controller._processing_started_at = (
                    time.time() - controller.config.chamber_timeout_seconds - 1
                )
                fail_next_all_stop(controller.hardware)
                with self.assertLogs("rvm.controller", level="ERROR"):
                    controller._tick()
                self.assertTrue(events_of(controller, "FRAUD_DETECTED"))
                self.assert_visibly_latched(controller)
            finally:
                controller.db.close()

    def test_p4_abnormal_weight_with_failed_stop_stays_latched(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.item_in_processing(tmp)
            try:
                fail_next_all_stop(controller.hardware)
                controller.hardware.patch(item_present=False, weight_grams=900.0, weight_stable=True)
                with self.assertLogs("rvm.controller", level="ERROR"):
                    sensor_pass(controller)
                self.assertTrue(events_of(controller, "FRAUD_DETECTED"))
                self.assertFalse(controller.hardware.input_gate_open)
                self.assert_visibly_latched(controller)
            finally:
                controller.db.close()

    def test_heartbeat_reports_latch_in_maintenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                controller.enter_safe_state("HIGH_IMPACT_DETECTED", {"vibrationG": 4.8})
                controller.execute_remote_command("ENTER_MAINTENANCE", {})
                self.assertEqual(controller.state, MachineState.MAINTENANCE)
                self.assertEqual(controller.heartbeat_payload()["status"], "ERROR")
            finally:
                controller.db.close()

    def test_s3_full_transition_with_failed_stop_does_not_report_full(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                self.assertTrue(controller.activate_lease(signed_lease()))
                fail_next_all_stop(controller.hardware)
                controller.hardware.patch(fill_percent=96)
                with self.assertLogs("rvm.controller", level="ERROR"):
                    sensor_pass(controller)
                self.assert_latched(controller, "OUTPUT_STOP_FAILED")
                self.assertEqual(
                    [e for e in events_of(controller, "STATUS_CHANGED")
                     if e["payload"].get("status") == "FULL"],
                    [],
                )
            finally:
                controller.db.close()


# --------------------------------------------------------------------------- #
# boot / crash recovery
# --------------------------------------------------------------------------- #
class BootOutputsTest(SafetyAssertions):
    def test_restart_comes_up_with_outputs_off_and_latch_kept(self):
        for scenario in ("session-active", "safe-state"):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as tmp:
                first = make_controller(tmp)
                self.assertTrue(first.activate_lease(signed_lease()))
                if scenario == "safe-state":
                    first.enter_safe_state("HIGH_IMPACT_DETECTED", {"vibrationG": 4.8})
                expected = first.state
                first.db.close()

                second = RvmController(first.config)
                # Relays still energised from before the crash.
                second.hardware.set_input_gate(True)
                second.hardware.set_conveyor("FORWARD")
                second.hardware.set_compactor(True)
                second.start()
                try:
                    self.assert_outputs_off(second)
                    self.assertEqual(second.state, expected)
                    if scenario == "safe-state":
                        self.assert_latched(second, "HIGH_IMPACT_DETECTED")
                finally:
                    second.stop()


if __name__ == "__main__":
    unittest.main()
