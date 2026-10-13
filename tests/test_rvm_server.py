from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import signal
import socket
import sys
import tempfile
import threading
import time
import types
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import cv2
import numpy as np
import urllib.error
import urllib.request

import rvm.main as rvm_main
from rvm.api import LocalApiServer
from rvm.config import RvmConfig
from rvm.controller import MachineState, RvmController
from rvm.database import EdgeDatabase
from rvm.hardware import GpioHardware, MockHardware
from rvm.sync import SyncWorker
from rvm.states import iso_now


def controller_in(tmp, **overrides):
    base = dict(
        machine_code="TEST-001",
        machine_secret="test-secret",
        database_path=str(Path(tmp) / "rvm.db"),
        server_url="http://127.0.0.1:1",
        hardware_driver="mock",
        maintenance_pin_hash=RvmConfig.hash_pin("2468"),
    )
    base.update(overrides)
    return RvmController(RvmConfig(**base))


def signed_lease(secret, session_id="session-1", expires=None):
    now = int(time.time())
    lease = {
        "id": f"lease-{session_id}",
        "sessionId": session_id,
        "issuedAt": now,
        "expiresAt": expires if expires is not None else now + 60,
    }
    canonical = ".".join(str(lease[k]) for k in ("id", "sessionId", "issuedAt", "expiresAt"))
    lease["signature"] = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return lease


# --------------------------------------------------------------------------- #
# remote
# --------------------------------------------------------------------------- #
class RemoteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.c = controller_in(self.tmp.name)

    def tearDown(self):
        self.c.db.close()
        self.tmp.cleanup()

    def test_refresh_and_sync_now_and_stop(self):
        self.c.sync.flush_once = lambda: None
        self.c.sync.flush_captures = lambda: None
        self.assertEqual(self.c.execute_remote_command("REFRESH_STATE", {}), self.c._remote_snapshot())
        self.c.execute_remote_command("SYNC_NOW", {})
        self.c.execute_remote_command("STOP_ALL", {})
        self.assertFalse(self.c.hardware.input_gate_open)

    def test_capture_snapshot_branches(self):
        self.c.config.camera_enabled = False
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("CAPTURE_SNAPSHOT", {})
        self.c.config.camera_enabled = True
        self.c.camera.capture_evidence = lambda *a, **k: None
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("CAPTURE_SNAPSHOT", {})
        self.c.camera.capture_evidence = lambda *a, **k: {
            "id": "c1", "kind": "REMOTE", "reason": "SUPERADMIN_SNAPSHOT",
            "sessionId": None, "imagePath": "p", "facePaths": [],
            "faceCount": 0, "personDetected": False, "occurredAt": iso_now(),
        }
        self.c.sync.flush_captures = lambda: None
        self.c.execute_remote_command("CAPTURE_SNAPSHOT", {})

    def test_open_gate_branches(self):
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("OPEN_GATE", {})
        self.c.set_state(MachineState.SESSION_ACTIVE, "x")
        self.c.db.save_lease({
            "id": "l", "sessionId": "s", "userRef": None,
            "issuedAt": time.time(), "expiresAt": time.time() + 100,
            "status": "ACTIVE", "signature": "x",
        })
        self.c._active_alert = {"category": "FRAUD", "reason": "R"}
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("OPEN_GATE", {})
        self.c._active_alert = None
        self.c.execute_remote_command("OPEN_GATE", {})
        self.assertTrue(self.c.hardware.input_gate_open)
        self.c.execute_remote_command("CLOSE_GATE", {})
        self.assertFalse(self.c.hardware.input_gate_open)

    def test_reset_alert_branches(self):
        self.c.hardware.patch(service_panel_open=True)
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("RESET_ALERT", {})
        self.c.hardware.patch(service_panel_open=False, collection_door_open=True)
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("RESET_ALERT", {})
        self.c.hardware.patch(collection_door_open=False, vibration_g=9.0)
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("RESET_ALERT", {})
        self.c.hardware.patch(vibration_g=0.02, temperature_c=90.0)
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("RESET_ALERT", {})
        self.c.hardware.patch(temperature_c=28.0)
        self.c.config.camera_enabled = True
        self.c.camera.status.online = False
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("RESET_ALERT", {})
        self.c.camera.status.online = True
        self.c.camera.status.occluded = True
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("RESET_ALERT", {})
        self.c.camera.status.occluded = False
        before = self.c.state
        self.c.execute_remote_command("RESET_ALERT", {})
        self.assertIsNone(self.c._active_alert)

    def test_enter_and_resume(self):
        self.c.execute_remote_command("ENTER_MAINTENANCE", {})
        self.assertEqual(self.c.state, MachineState.MAINTENANCE)
        self.c.db.set_json("safe_reason", "X")
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("RESUME_OPERATION", {})
        self.c.db.set_json("safe_reason", None)
        self.c._active_alert = {"reason": "R"}
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("RESUME_OPERATION", {})
        self.c._active_alert = None
        self.c.db.save_lease({
            "id": "l", "sessionId": "s", "userRef": None,
            "issuedAt": time.time(), "expiresAt": time.time() + 100,
            "status": "ACTIVE", "signature": "x",
        })
        self.c.execute_remote_command("RESUME_OPERATION", {})
        self.assertEqual(self.c.state, MachineState.SESSION_ACTIVE)
        self.c.db.deactivate_leases()
        self.c.set_state(MachineState.SAFE_STATE, "x")
        self.c.db.set_json("safe_reason", None)
        self.c.execute_remote_command("RESUME_OPERATION", {})
        self.assertEqual(self.c.state, MachineState.IDLE)

    def test_unknown_command(self):
        with self.assertRaises(ValueError):
            self.c.execute_remote_command("NOPE", {})

    def test_remote_loop(self):
        calls = []
        self.c.sync.fetch_remote_command = lambda: {
            "id": "cmd-1", "command": "STOP_ALL", "payload": {},
        }
        self.c.execute_remote_command = lambda cmd, data=None: calls.append((cmd, data)) or {}
        self.c.sync.report_remote_command = lambda *a, **k: True
        self.c.running = True
        real_sleep = rvm_main.time.sleep if False else __import__("time").sleep
        with mock.patch("rvm.remote.time.sleep", lambda *a: None):
            t = threading.Thread(target=self.c._remote_loop)
            t.start()
            deadline = time.time() + 2
            while time.time() < deadline and not calls:
                time.sleep(0.02)
            self.c.running = False
            t.join(timeout=2)
        self.assertTrue(calls)

    def test_remote_loop_cached(self):
        self.c.db.set_json("remote_result:cmd-2", {"success": True, "result": {}, "error": None})
        reported = []
        self.c.sync.fetch_remote_command = lambda: {"id": "cmd-2", "command": "X", "payload": {}}
        self.c.sync.report_remote_command = lambda cid, **kw: reported.append((cid, kw)) or True
        self.c.running = True
        with mock.patch("rvm.remote.time.sleep", lambda *a: None):
            t = threading.Thread(target=self.c._remote_loop)
            t.start()
            deadline = time.time() + 2
            while time.time() < deadline and not reported:
                time.sleep(0.02)
            self.c.running = False
            t.join(timeout=2)
        self.assertTrue(reported)


# --------------------------------------------------------------------------- #
# simulation
# --------------------------------------------------------------------------- #
class SimulationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.c = controller_in(self.tmp.name)

    def tearDown(self):
        self.c.db.close()
        self.tmp.cleanup()

    def test_reset_mock_state(self):
        self.c.db.save_lease({
            "id": "l", "sessionId": "s", "userRef": None,
            "issuedAt": time.time(), "expiresAt": time.time() + 100,
            "status": "ACTIVE", "signature": "x",
        })
        self.c._reset_mock_state(deactivate_lease=False)
        self.assertEqual(self.c.state, MachineState.SESSION_ACTIVE)

    def test_simulation_lease(self):
        self.c._simulation_lease()
        self.assertEqual(self.c.state, MachineState.SESSION_ACTIVE)

    def test_simulation_patch_non_mock(self):
        self.c.hardware = object()
        with self.assertRaises(ValueError):
            self.c._simulation_patch(item_present=True)

    def test_simulation_pulse(self):
        self.c._simulation_pulse("item_present")
        self.assertFalse(self.c.hardware.read().item_present)

    def test_start_simulation_errors(self):
        self.c.hardware = object()
        with self.assertRaises(ValueError):
            self.c.start_simulation("vandalism-impact")
        self.c.hardware = MockHardware()
        with self.assertRaises(ValueError):
            self.c.start_simulation("unknown-scenario")
        self.c.start_simulation("vandalism-impact")
        try:
            with self.assertRaises(ValueError):
                self.c.start_simulation("panel-forced")
        finally:
            if self.c._simulation_thread:
                self.c._simulation_thread.join(timeout=3)

    def _run_scenario(self, scenario):
        if scenario in {
            "normal-bottle", "normal-can", "string-pull", "abnormal-weight",
            "abnormal-underweight", "chamber-timeout", "acceptance-without-item",
        }:
            self.c.sync.fetch_active_lease = lambda: signed_lease(
                self.c.config.machine_secret, f"sim-{scenario}"
            )
        self.c.start_simulation(scenario)
        if self.c._simulation_thread:
            self.c._simulation_thread.join(timeout=5)
        self.assertEqual(self.c._simulation_result["status"], "COMPLETED")

    def test_all_scenarios(self):
        with mock.patch("rvm.simulation.time.sleep", lambda *a: None):
            for scenario in [
                "normal-bottle", "normal-can", "string-pull", "acceptance-without-item",
                "abnormal-weight", "abnormal-underweight", "item-without-session",
                "chamber-timeout", "vandalism-impact", "panel-forced", "door-forced",
                "camera-covered", "camera-offline", "camera-blurry", "overheat", "machine-full",
            ]:
                with self.subTest(scenario=scenario):
                    self._run_scenario(scenario)


# --------------------------------------------------------------------------- #
# controller extras
# --------------------------------------------------------------------------- #
class ControllerExtraTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.c = controller_in(self.tmp.name)

    def tearDown(self):
        self.c.db.close()
        self.tmp.cleanup()

    def _start_resume(self, state):
        with tempfile.TemporaryDirectory() as tmp:
            first = controller_in(tmp)
            first.db.set_json("machine_state", state)
            if state == MachineState.SESSION_ACTIVE:
                first.db.save_lease({
                    "id": "l", "sessionId": "s", "userRef": None,
                    "issuedAt": time.time(), "expiresAt": time.time() + 100,
                    "status": "ACTIVE", "signature": "x",
                })
            if state == MachineState.PROCESSING:
                expected = MachineState.SAFE_STATE
            elif state == MachineState.BOOTING:
                expected = MachineState.IDLE
            else:
                expected = state
            first.db.close()
            second = controller_in(tmp)
            second.start()
            try:
                self.assertEqual(second.state, expected)
            finally:
                second.stop()

    def test_resume_states(self):
        for state in [
            MachineState.BOOTING, MachineState.SESSION_ACTIVE, MachineState.MAINTENANCE,
            MachineState.FULL, MachineState.ERROR, MachineState.SAFE_STATE,
            MachineState.PROCESSING,
        ]:
            with self.subTest(state=state):
                self._start_resume(state)

    def test_run_chamber_timeout(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            lease = signed_lease(c.config.machine_secret, "to-session")
            self.assertTrue(c.activate_lease(lease))
            c.set_state(MachineState.PROCESSING, "x")
            c._processing_started_at = time.time() - c.config.chamber_timeout_seconds - 1
            c.running = True
            with mock.patch("rvm.controller.time.sleep", lambda *a: None):
                t = threading.Thread(target=c._run)
                t.start()
                deadline = time.time() + 3
                while time.time() < deadline and not any(
                    e["eventType"] == "CHAMBER_TIMEOUT" for e in c.db.pending(50)
                ):
                    time.sleep(0.02)
                c.running = False
                t.join(timeout=2)
            self.assertTrue(any(e["eventType"] == "CHAMBER_TIMEOUT" for e in c.db.pending(50)))
            c.db.close()

    def test_run_control_loop_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)

            def boom():
                raise RuntimeError("boom")
            c.hardware.read = boom
            c.running = True
            with self.assertLogs("rvm.controller", level="ERROR"), \
                    mock.patch("rvm.controller.time.sleep", lambda *a: None):
                t = threading.Thread(target=c._run)
                t.start()
                deadline = time.time() + 3
                while time.time() < deadline and c.state != MachineState.SAFE_STATE:
                    time.sleep(0.02)
                c.running = False
                t.join(timeout=2)
            self.assertEqual(c.state, MachineState.SAFE_STATE)
            c.db.close()

    def test_run_heartbeat(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            c._last_heartbeat = 0.0
            c.running = True
            with mock.patch("rvm.controller.time.sleep", lambda *a: None):
                t = threading.Thread(target=c._run)
                t.start()
                deadline = time.time() + 3
                while time.time() < deadline and not any(
                    e["eventType"] == "HEARTBEAT" for e in c.db.pending(50)
                ):
                    time.sleep(0.02)
                c.running = False
                t.join(timeout=2)
            self.assertTrue(any(e["eventType"] == "HEARTBEAT" for e in c.db.pending(50)))
            c.db.close()

    def test_expire_lease(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            c.set_state(MachineState.SESSION_ACTIVE, "x")
            c._expire_lease()
            self.assertEqual(c.state, MachineState.SYNC_PENDING)
            c.db.close()

    def test_verify_lease(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            self.assertFalse(c.verify_lease({"id": 1}))
            bad = signed_lease(c.config.machine_secret)
            bad["signature"] = "wrong"
            self.assertFalse(c.verify_lease(bad))
            self.assertTrue(c.verify_lease(signed_lease(c.config.machine_secret)))
            c.db.close()

    def test_activate_invalid_with_qr(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            lease = {"id": "l", "sessionId": "s", "qrDataUrl": "data:img", "expiresAt": time.time() + 100}
            self.assertFalse(c.activate_lease(lease))
            self.assertIsNotNone(c.db.get_json("display"))
            c.db.close()

    def test_activate_valid_camera_capture(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp, camera_enabled=True, camera_capture_session_start=True)
            c.camera.status.online = True  # enabled camera must be healthy to open the gate
            captured = []
            c._capture_camera_evidence = lambda *a, **k: captured.append(a)
            self.assertTrue(c.activate_lease(signed_lease(c.config.machine_secret, "cap-sess")))
            self.assertEqual(len(captured), 1)
            c.db.close()

    def test_maintenance_command_branches(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            c.maintenance_command("reset-safe-state", {})
            c.maintenance_command("gate", {"open": True})
            self.assertTrue(c.hardware.input_gate_open)
            c.maintenance_command("conveyor", {"direction": "FORWARD"})
            self.assertEqual(c.hardware.conveyor, "FORWARD")
            c.maintenance_command("compactor", {"active": True})
            self.assertTrue(c.hardware.compactor)
            c.sync.flush_once = lambda: None
            c.maintenance_command("flush", {})
            c.hardware.patch = lambda **k: None
            c.maintenance_command("mock-sensors", {"values": {"vibration_g": 1}})
            c.maintenance_command("simulate", {"scenario": "vandalism-impact"})
            if c._simulation_thread:
                c._simulation_thread.join(timeout=3)
            with self.assertRaises(ValueError):
                c.maintenance_command("bogus", {})
            c.db.close()

    def test_public_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            state = c.public_state()
            self.assertEqual(state["runtimeState"], MachineState.BOOTING)
            c.db.close()

    def test_lease_loop(self):
        scenarios = [
            {"lease": signed_lease(self.c.config.machine_secret, "L1"), "session": {}, "idleTimeoutMinutes": 5, "wasteTypes": [{"id": "wt"}]},
            {"lease": signed_lease(self.c.config.machine_secret, "L2"), "session": {}, "idleTimeoutMinutes": 5, "wasteTypes": None},
            None,
            {"lease": None, "session": None, "idleTimeoutMinutes": None, "wasteTypes": None},
        ]
        idx = {"i": 0}
        def fetch_session():
            v = scenarios[idx["i"]] if idx["i"] < len(scenarios) else None
            idx["i"] += 1
            return v
        displays = iter([{"qrDataUrl": "d", "expiresAt": 1, "status": "ONLINE"}, None])
        self.c.sync.fetch_machine_session = fetch_session
        self.c.sync.fetch_display = lambda: next(displays)
        self.c.running = True
        with mock.patch("rvm.controller.time.sleep", lambda *a: None):
            t = threading.Thread(target=self.c._lease_loop)
            t.start()
            deadline = time.time() + 2
            while time.time() < deadline and idx["i"] < len(scenarios):
                time.sleep(0.02)
            self.c.running = False
            t.join(timeout=2)
        self.assertEqual(self.c.db.get_json("waste_types"), [{"id": "wt"}])

    def test_chamber_open_without_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            c.hardware.patch(chamber_open=True)
            c._process_sensors(c.hardware.read())
            self.assertEqual(c._active_alert["reason"], "CHAMBER_OPEN_WITHOUT_SESSION")
            c.db.close()

    def test_maintenance_authorized_expired(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            token = c.maintenance_login("2468")
            c._maintenance_tokens[token] = 0.0
            self.assertFalse(c.maintenance_authorized(token))
            c.db.close()

    def test_lease_loop_deactivate(self):
        self.c.db.save_lease({
            "id": "l", "sessionId": "s", "userRef": None,
            "issuedAt": time.time(), "expiresAt": time.time() + 100,
            "status": "ACTIVE", "signature": "x",
        })
        def fetch():
            self.c.running = False  # one poll, then the loop exits cleanly
            return {"lease": None}
        self.c.sync.fetch_machine_session = fetch
        self.c.sync.fetch_display = lambda: None
        self.c.running = True
        t = threading.Thread(target=self.c._lease_loop)
        t.start()
        t.join(timeout=3)
        self.assertEqual(self.c.state, MachineState.IDLE)
        self.assertIsNone(self.c.db.active_lease())

    def test_remote_loop_failure(self):
        self.c.sync.fetch_remote_command = lambda: {"id": "c", "command": "STOP_ALL", "payload": {}}
        def boom(cmd, data=None):
            raise RuntimeError("x")
        self.c.execute_remote_command = boom
        reported = []
        self.c.sync.report_remote_command = lambda cid, **kw: reported.append(kw) or True
        self.c.running = True
        with mock.patch("rvm.remote.time.sleep", lambda *a: None):
            t = threading.Thread(target=self.c._remote_loop)
            t.start()
            deadline = time.time() + 2
            while time.time() < deadline and not reported:
                time.sleep(0.02)
            self.c.running = False
            t.join(timeout=2)
        self.assertTrue(reported)
        self.assertFalse(reported[0]["success"])

    def test_session_scenario_no_lease_runtimeerror(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            c.sync.fetch_active_lease = lambda: None
            c.start_simulation("normal-bottle")
            if c._simulation_thread:
                c._simulation_thread.join(timeout=5)
            self.assertEqual(c._simulation_result["status"], "FAILED")
            self.assertIsNotNone(c._simulation_error)
            c.db.close()

    def test_simulation_lease_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            c.activate_lease = lambda lease: False
            with self.assertRaises(RuntimeError):
                c._simulation_lease()
            c.db.close()

    def _gpio_errors(self, *, drop_hx711, drop_mpu):
        fake = types.ModuleType("gpiozero")
        class Dev:
            def __init__(self, *a, **k): self.value = False
            def on(self): self.value = True
            def off(self): self.value = False
            @property
            def is_pressed(self): return self.value
            @property
            def distance(self): return 0.5
        fake.Button = Dev
        fake.DigitalOutputDevice = Dev
        fake.DistanceSensor = Dev
        pins = {
            "chamber": 1, "item_beam": 2, "acceptance_beam": 3, "service_panel": 4,
            "collection_door": 5, "input_gate": 6, "conveyor_forward": 7,
            "conveyor_reverse": 8, "compactor": 9, "ultrasonic_echo": 10,
            "ultrasonic_trigger": 11, "direction_reverse": 12,
        }
        cfg = RvmConfig(machine_secret="x", gpio_pins=pins,
                        load_cell_enabled=True, vibration_sensor_enabled=True)
        saved = {m: sys.modules.get(m) for m in ("gpiozero", "mpu6050", "hx711")}
        sys.modules["gpiozero"] = fake
        if drop_hx711:
            sys.modules["hx711"] = None
        else:
            hx = types.ModuleType("hx711")
            class Hx:
                def __init__(self, *a, **k): pass
                def set_reference_unit(self, *a): pass
                def reset(self): pass
                def tare(self): pass
                def get_weight(self, n): return 0.0
                def power_down(self): pass
                def power_up(self): pass
            hx.HX711 = Hx
            sys.modules["hx711"] = hx
        if drop_mpu:
            sys.modules["mpu6050"] = None
        else:
            mpu = types.ModuleType("mpu6050")
            class Mpu:
                def __init__(self, *a, **k): pass
                def get_accel_data(self, g=False): return {"x": 0, "y": 0, "z": 1}
            mpu.mpu6050 = Mpu
            sys.modules["mpu6050"] = mpu
        try:
            with self.assertRaises(RuntimeError):
                GpioHardware(cfg)
        finally:
            for m, v in saved.items():
                if v is None:
                    sys.modules.pop(m, None)
                else:
                    sys.modules[m] = v

    def test_gpio_driver_errors(self):
        self._gpio_errors(drop_hx711=True, drop_mpu=False)
        self._gpio_errors(drop_hx711=False, drop_mpu=True)


# --------------------------------------------------------------------------- #
# sync worker (network mocked)
# --------------------------------------------------------------------------- #
class Resp:
    def __init__(self, status, data=b""):
        self.status = status
        self._data = data
    def read(self):
        return self._data
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


class UrlFake:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []
    def __call__(self, request, timeout=10):
        self.calls.append(request.full_url)
        for key, val in self.routes.items():
            if key and key in request.full_url:
                if isinstance(val, Exception):
                    raise val
                if isinstance(val, Resp):
                    return val
                return Resp(200, val)
        return Resp(404, b"{}")


def make_sync(tmp, **cfg):
    base = dict(
        machine_code="TEST-001", machine_secret="test-secret",
        database_path=str(Path(tmp) / "edge.db"),
        server_url="http://127.0.0.1:9",
    )
    base.update(cfg)
    db = EdgeDatabase(base["database_path"])
    return SyncWorker(RvmConfig(**base), db), db


class SyncTest(unittest.TestCase):
    def test_flush_once_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            self.assertTrue(w.flush_once())
            db.close()

    def test_flush_once_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            db.enqueue("E", {"a": 1}, "now")
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-events": b"{}"})):
                self.assertTrue(w.flush_once())
            self.assertTrue(w.online)
            self.assertEqual(db.queue_depth(), 0)
            db.close()

    def test_flush_once_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            db.enqueue("E", {}, "now")
            err = urllib.error.URLError("down")
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-events": err})):
                self.assertFalse(w.flush_once())
            self.assertFalse(w.online)
            self.assertEqual(db.queue_depth(), 1)
            db.close()

    def test_flush_once_http_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            db.enqueue("E", {}, "now")
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-events": Resp(500, b"")})):
                self.assertFalse(w.flush_once())
            db.close()

    def _capture(self, db, tmp):
        img = Path(tmp) / "scene.jpg"
        img.write_bytes(b"IMAGE")
        cap = {
            "id": "c1", "kind": "FRAUD", "reason": "R", "sessionId": "s1",
            "imagePath": str(img), "facePaths": [], "faceCount": 0,
            "personDetected": False, "occurredAt": iso_now(),
        }
        db.enqueue_capture(cap)
        return img

    def test_flush_captures_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            self.assertTrue(w.flush_captures())
            db.close()

    def test_flush_captures_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            self._capture(db, tmp)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-captures": b"{}"})):
                self.assertTrue(w.flush_captures())
            self.assertEqual(db.capture_queue_depth(), 0)
            db.close()

    def test_flush_captures_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            db.enqueue_capture({
                "id": "c2", "kind": "FRAUD", "reason": "R", "sessionId": "s1",
                "imagePath": str(Path(tmp) / "missing.jpg"), "facePaths": [],
                "faceCount": 0, "personDetected": False, "occurredAt": iso_now(),
            })
            self.assertFalse(w.flush_captures())
            db.close()

    def test_flush_captures_http_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            self._capture(db, tmp)
            err = urllib.error.URLError("down")
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-captures": err})):
                self.assertFalse(w.flush_captures())
            db.close()

    def test_flush_captures_http_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            self._capture(db, tmp)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-captures": Resp(500, b"")})):
                self.assertFalse(w.flush_captures())
            db.close()

    def test_fetch_machine_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-session/": b'{"lease":null}'})):
                self.assertEqual(w.fetch_machine_session(), {"lease": None})
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-session/": urllib.error.URLError("x")})):
                self.assertIsNone(w.fetch_machine_session())
            db.close()

    def test_fetch_remote_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-commands/": b'{"command":{"id":1,"command":"STOP_ALL","payload":{}}}'})):
                self.assertEqual(w.fetch_remote_command()["id"], 1)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-commands/": urllib.error.URLError("x")})):
                self.assertIsNone(w.fetch_remote_command())
            db.close()

    def test_report_remote_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-commands/": b"{}"})):
                self.assertTrue(w.report_remote_command("c1", True, {}))
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-commands/": urllib.error.URLError("x")})):
                self.assertFalse(w.report_remote_command("c1", True, {}))
            db.close()

    def test_report_remote_command_error_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-commands/": b"{}"})):
                self.assertTrue(w.report_remote_command("c1", False, {}, "boom"))
            db.close()

    def test_sync_media_unknown_mime(self):
        payload = b"x"
        digest = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp, media_cache_dir=str(Path(tmp) / "m"), media_max_cache_mb=1024)
            manifest = json.dumps({
                "enabled": True, "version": "v1", "items": [{
                    "id": "a1", "title": "A", "mediaType": "WEIRD",
                    "mimeType": "application/x-weird", "fileSize": len(payload),
                    "sha256": digest, "durationSeconds": 5, "downloadPath": "/d/a1",
                }],
            }).encode()
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/manifest/": manifest})):
                self.assertTrue(w.sync_media())
            db.close()

    def test_fetch_display(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/display/": b'{"qrDataUrl":"x"}'})):
                self.assertEqual(w.fetch_display()["qrDataUrl"], "x")
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/display/": urllib.error.URLError("x")})):
                self.assertIsNone(w.fetch_display())
            db.close()

    def test_fetch_active_lease(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/machine-session/": b'{"lease":{"id":1}}'})):
                self.assertEqual(w.fetch_active_lease()["id"], 1)
            db.close()

    def test_signed_get_and_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/x/": b"hello"})):
                self.assertEqual(w._signed_get("/x/"), b"hello")
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({"/x/": Resp(500, b"")})):
                with self.assertRaises(RuntimeError):
                    w._signed_get("/x/")
            self.assertEqual(w.status()["queueDepth"], 0)
            db.close()

    def test_sync_media_branches(self):
        payload = b"IMG"
        digest = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp, media_cache_dir=str(Path(tmp) / "media"), media_max_cache_mb=1024)
            manifest = json.dumps({
                "enabled": True, "version": "v1", "items": [{
                    "id": "ad-1", "title": "A", "mediaType": "IMAGE",
                    "mimeType": "image/png", "fileSize": len(payload),
                    "sha256": digest, "durationSeconds": 9, "downloadPath": "/download/ad-1",
                }],
            }).encode()
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                "/manifest/": manifest, "/download/ad-1": payload,
            })):
                self.assertTrue(w.sync_media())
            self.assertTrue((Path(tmp) / "media" / "ad-1.png").is_file())

            # disabled playlist removes cached file
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                "/manifest/": json.dumps({"enabled": False, "version": "v2", "items": []}).encode(),
            })):
                self.assertTrue(w.sync_media())
            self.assertFalse((Path(tmp) / "media" / "ad-1.png").exists())

            # cache too big
            w2, db2 = make_sync(tmp, database_path=str(Path(tmp) / "e2.db"),
                                media_cache_dir=str(Path(tmp) / "m2"), media_max_cache_mb=0)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                "/manifest/": manifest, "/download/ad-1": payload,
            })):
                self.assertFalse(w2.sync_media())

            # size mismatch
            w3, db3 = make_sync(tmp, database_path=str(Path(tmp) / "e3.db"),
                                media_cache_dir=str(Path(tmp) / "m3"))
            bad = json.loads(manifest)
            bad["items"][0]["fileSize"] = len(payload) + 5
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                "/manifest/": json.dumps(bad).encode(), "/download/ad-1": payload,
            })):
                self.assertFalse(w3.sync_media())

            # checksum mismatch
            w4, db4 = make_sync(tmp, database_path=str(Path(tmp) / "e4.db"),
                                media_cache_dir=str(Path(tmp) / "m4"))
            wrong = json.loads(manifest)
            wrong["items"][0]["sha256"] = "deadbeef"
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                "/manifest/": json.dumps(wrong).encode(), "/download/ad-1": payload,
            })):
                self.assertFalse(w4.sync_media())

            # missing downloadPath -> KeyError -> False
            w5, db5 = make_sync(tmp, database_path=str(Path(tmp) / "e5.db"),
                                media_cache_dir=str(Path(tmp) / "m5"))
            nokey = json.loads(manifest)
            del nokey["items"][0]["downloadPath"]
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                "/manifest/": json.dumps(nokey).encode(),
            })):
                self.assertFalse(w5.sync_media())

            # empty playlist enabled
            w6, db6 = make_sync(tmp, database_path=str(Path(tmp) / "e6.db"),
                                media_cache_dir=str(Path(tmp) / "m6"))
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                "/manifest/": json.dumps({"enabled": True, "version": "v3", "items": []}).encode(),
            })):
                self.assertTrue(w6.sync_media())

            # urlopen error
            w7, db7 = make_sync(tmp, database_path=str(Path(tmp) / "e7.db"),
                                media_cache_dir=str(Path(tmp) / "m7"))
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                "/manifest/": urllib.error.URLError("x"),
            })):
                self.assertFalse(w7.sync_media())

            # valid existing cache (correct size + sha) skips download
            w8, db8 = make_sync(tmp, database_path=str(Path(tmp) / "e8.db"),
                                media_cache_dir=str(Path(tmp) / "m8"))
            target = Path(tmp) / "m8" / "ad-1.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                "/manifest/": manifest,
            })):
                self.assertTrue(w8.sync_media())
            db.close(); db2.close(); db3.close(); db4.close(); db5.close(); db6.close(); db7.close(); db8.close()

    def test_run_loop(self):
        with tempfile.TemporaryDirectory() as tmp:
            w, db = make_sync(tmp, media_cache_dir=str(Path(tmp) / "media"), media_sync_seconds=0)
            w.start()
            try:
                with mock.patch("rvm.sync.urllib.request.urlopen", UrlFake({
                    "/manifest/": json.dumps({"enabled": True, "version": "v1", "items": []}).encode(),
                })):
                    time.sleep(0.3)
            finally:
                w.stop()
            db.close()


# --------------------------------------------------------------------------- #
# local api server
# --------------------------------------------------------------------------- #
class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.c = controller_in(cls.tmp.name, media_cache_dir=str(Path(cls.tmp.name) / "media"))
        Path(cls.c.config.media_cache_dir).mkdir(parents=True, exist_ok=True)
        (Path(cls.c.config.media_cache_dir) / "ad-1.png").write_bytes(b"MEDIA")
        cls.assets = Path(__file__).resolve().parents[1] / "rvm" / "web"
        servers = []

        class Cap(ThreadingHTTPServer):
            def __init__(self, *a, **k):
                super().__init__(*a, **k)
                servers.append(self)
        cls.servers = servers
        cls.Cap = Cap
        with mock.patch("rvm.api.ThreadingHTTPServer", Cap):
            cls.api = LocalApiServer(cls.c, cls.assets)
            cls.thread = threading.Thread(target=cls.api.serve, daemon=True)
            cls.thread.start()
            deadline = time.time() + 5
            while not servers and time.time() < deadline:
                time.sleep(0.02)
        cls.port = servers[0].server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.api.stop()
        cls.thread.join(timeout=3)
        cls.c.db.close()
        cls.tmp.cleanup()

    def get(self, path, method="GET", body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, data

    def post(self, path, payload, headers=None):
        return self.get(path, "POST", json.dumps(payload).encode(),
                        {"Content-Type": "application/json", **(headers or {})})

    def test_health_and_state(self):
        status, _ = self.get("/api/health")
        self.assertEqual(status, 200)
        status, _ = self.get("/api/state")
        self.assertEqual(status, 200)

    def test_assets_and_404(self):
        status, _ = self.get("/")
        self.assertEqual(status, 200)
        status, _ = self.get("/nope.html")
        self.assertEqual(status, 404)

    def test_traversal_blocked(self):
        status, _ = self.get("/../rvm/__init__.py")
        self.assertEqual(status, 403)

    def test_media(self):
        status, _ = self.get("/media/ad-1.png")
        self.assertEqual(status, 200)
        status, _ = self.get("/media/missing.png")
        self.assertEqual(status, 404)

    def test_media_range(self):
        status, _ = self.get("/media/ad-1.png", headers={"Range": "bytes=0-3"})
        self.assertEqual(status, 206)
        status, _ = self.get("/media/ad-1.png", headers={"Range": "bytes=999-"})
        self.assertEqual(status, 416)

    def test_session_lease(self):
        status, _ = self.post("/api/session/lease", {"bad": True})
        self.assertEqual(status, 401)
        status, _ = self.post("/api/session/lease", signed_lease(self.c.config.machine_secret, "api-sess"))
        self.assertEqual(status, 200)
        status, _ = self.post("/api/session/waste-type", {"wasteTypeId": "wt1"})
        self.assertEqual(status, 200)

    def test_maintenance_login(self):
        self.c._maintenance_lockout_until = time.time() + 100
        status, _ = self.post("/api/maintenance/login", {"pin": "2468"})
        self.assertEqual(status, 429)
        self.c._maintenance_lockout_until = 0.0
        status, body = self.post("/api/maintenance/login", {"pin": "wrong"})
        self.assertEqual(status, 401)
        status, body = self.post("/api/maintenance/login", {"pin": "2468"})
        self.assertEqual(status, 200)
        token = json.loads(body)["token"]
        status, _ = self.post("/api/maintenance/command", {"command": "gate", "open": True},
                               {"Authorization": f"Bearer {token}"})
        self.assertEqual(status, 200)
        status, _ = self.post("/api/maintenance/command", {"command": "bogus"},
                               {"Authorization": f"Bearer {token}"})
        self.assertEqual(status, 422)
        status, _ = self.post("/api/maintenance/command", {"command": "gate"}, {})
        self.assertEqual(status, 401)

    def test_unknown_route_and_bad_json(self):
        status, _ = self.post("/api/unknown", {})
        self.assertEqual(status, 404)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("POST", "/api/session/lease", b"{not json",
                     {"Content-Type": "application/json"})
        self.assertEqual(conn.getresponse().status, 422)
        conn.close()
        status, _ = self.post("/api/maintenance/command", {"command": "nope"},
                               {"Authorization": "Bearer tok"})
        self.assertEqual(status, 401)

    def test_connection_drop_does_not_crash(self):
        def raw(path):
            s = socket.socket()
            s.settimeout(2)
            s.connect(("127.0.0.1", self.port))
            s.sendall(f"GET {path} HTTP/1.1\r\nHost: x\r\n\r\n".encode())
            s.close()
        raw("/api/health")
        raw("/")
        raw("/media/ad-1.png")
        time.sleep(0.3)
        status, _ = self.get("/api/health")
        self.assertEqual(status, 200)


# --------------------------------------------------------------------------- #
# main entrypoint
# --------------------------------------------------------------------------- #
class MainTest(unittest.TestCase):
    def test_main_dev(self):
        cfg = RvmConfig(machine_secret="x", camera_enabled=False)
        started = []
        stopped = []

        class FakeController:
            def __init__(self, c):
                self.config = c
                self.db = None
            def start(self):
                started.append(1)
            def stop(self):
                stopped.append(1)
            def public_state(self):
                return {}
        class FakeApi:
            def __init__(self, c, a):
                self.controller = c
            def serve(self):
                pass
            def stop(self):
                pass
        signals = {}
        with mock.patch("rvm.main.RvmConfig.load", staticmethod(lambda p: cfg)), \
             mock.patch("rvm.main.RvmController", FakeController), \
             mock.patch("rvm.main.LocalApiServer", FakeApi), \
             mock.patch("rvm.main.signal.signal", lambda s, h: signals.__setitem__(s, h)), \
             mock.patch.object(sys, "argv", ["main"]):
            rvm_main.main()
            signals[signal.SIGINT](None, None)
        self.assertTrue(started)
        self.assertTrue(stopped)

    def test_main_prod_abort(self):
        with mock.patch("rvm.main.RvmConfig.load", staticmethod(lambda p: RvmConfig(machine_secret="x"))), \
             mock.patch.object(sys, "argv", ["main", "--env", "prod"]), \
             mock.patch("rvm.main.os.getenv", lambda k, d=None: None):
            with self.assertRaises(SystemExit):
                rvm_main.main()

    def test_main_prod_ok(self):
        cfg = RvmConfig(machine_secret="x", camera_enabled=False)
        signals = {}

        class FakeController:
            def __init__(self, c):
                self.config = c
            def start(self):
                pass
            def stop(self):
                pass
            def public_state(self):
                return {}
        class FakeApi:
            def __init__(self, c, a):
                self.controller = c
            def serve(self):
                pass
            def stop(self):
                pass
        with mock.patch("rvm.main.RvmConfig.load", staticmethod(lambda p: cfg)), \
             mock.patch("rvm.main.RvmController", FakeController), \
             mock.patch("rvm.main.LocalApiServer", FakeApi), \
             mock.patch("rvm.main.signal.signal", lambda s, h: signals.__setitem__(s, h)), \
             mock.patch.object(sys, "argv", ["main", "--env", "prod"]), \
             mock.patch("rvm.main.os.getenv", lambda k, d=None: {"RVM_SERVER_URL": "http://x", "RVM_MACHINE_SECRET": "s"}.get(k, d)):
            rvm_main.main()
            signals[signal.SIGINT](None, None)
        self.assertEqual(cfg.server_url, "http://x")
        self.assertEqual(cfg.machine_secret, "s")


if __name__ == "__main__":
    unittest.main()
