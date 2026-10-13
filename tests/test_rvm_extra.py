from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest import mock

import cv2
import numpy as np
import urllib.error
import urllib.request

from rvm.api import LocalApiServer
from rvm.camera import CameraStatus, CameraWorker
from rvm.config import RvmConfig
from rvm.controller import MachineState, RvmController
from rvm.database import EdgeDatabase
from rvm.fraud import RvmFraudMixin
from rvm.hardware import GpioHardware, MockHardware, SensorSnapshot
from rvm.remote import RvmRemoteMixin
from rvm.simulation import RvmSimulationMixin
from rvm.states import iso_now
from rvm.sync import SyncWorker


def controller_in(tmp: str, **overrides) -> RvmController:
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


def signed_lease(secret: str, session_id: str = "session-1", expires: int | None = None):
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
# config
# --------------------------------------------------------------------------- #
class ConfigTest(unittest.TestCase):
    def test_hash_and_verify_pin(self):
        h = RvmConfig.hash_pin("1234")
        self.assertEqual(h, hashlib.sha256(b"1234").hexdigest())
        cfg = RvmConfig(machine_secret="x", maintenance_pin_hash=h)
        self.assertTrue(cfg.verify_pin("1234"))
        self.assertFalse(cfg.verify_pin("0000"))
        self.assertFalse(RvmConfig(machine_secret="x").verify_pin("1234"))

    def test_public_dict_shape(self):
        d = RvmConfig(machine_secret="x").public_dict()
        self.assertEqual(d["machineCode"], "RLP-001")
        self.assertEqual(d["maxFillPercent"], 95)

    def test_load_and_validate(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cfg.json"
            path.write_text(json.dumps({"machine_code": "X", "machine_secret": "ok"}))
            cfg = RvmConfig.load(path)
            self.assertEqual(cfg.machine_code, "X")

    def test_validate_all_branches(self):
        cases = {
            "machine_code": RvmConfig(machine_secret="x", machine_code="  "),
            "machine_secret": RvmConfig(machine_secret="CHANGE_ME"),
            "host": RvmConfig(machine_secret="x", host="0.0.0.0"),
            "batch_size": RvmConfig(machine_secret="x", batch_size=99),
            "max_fill": RvmConfig(machine_secret="x", max_fill_percent=200),
            "weight": RvmConfig(machine_secret="x", min_item_weight_grams=10, max_item_weight_grams=5),
            "driver": RvmConfig(machine_secret="x", hardware_driver="odd"),
            "cam_size": RvmConfig(machine_secret="x", camera_classifier_input_size=0),
            "cam_labels": RvmConfig(machine_secret="x", camera_classifier_labels=[]),
            "temp": RvmConfig(machine_secret="x", max_temperature_c=5),
            "jpeg": RvmConfig(machine_secret="x", camera_jpeg_quality=10),
            "retention": RvmConfig(machine_secret="x", camera_retention_days=0),
            "max_caps": RvmConfig(machine_secret="x", camera_max_local_captures=10),
            "grace": RvmConfig(machine_secret="x", camera_startup_grace_seconds=99),
            "anomaly": RvmConfig(machine_secret="x", camera_anomaly_frames=0),
            "media_sync": RvmConfig(machine_secret="x", media_sync_seconds=5),
            "media_cache": RvmConfig(machine_secret="x", media_max_cache_mb=10),
        }
        for name, cfg in cases.items():
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    cfg.validate()


# --------------------------------------------------------------------------- #
# database
# --------------------------------------------------------------------------- #
class DatabaseExtraTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = EdgeDatabase(str(Path(self.tmp.name) / "edge.db"))

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def test_json_default_and_decode_error(self):
        self.assertIsNone(self.db.get_json("missing"))
        self.db._conn.execute(
            "INSERT INTO kv(key,value,updated_at) VALUES('bad','{not json',0)"
        )
        self.db._conn.commit()
        self.assertIsNone(self.db.get_json("bad"))

    def test_enqueue_explicit_id_and_pending(self):
        eid = self.db.enqueue("E", {"a": 1}, "now", "sess", "dep", "fixed-id")
        self.assertEqual(eid, "fixed-id")
        self.assertEqual(self.db.pending(10)[0]["localEventId"], "fixed-id")

    def test_mark_sent_and_failed(self):
        self.db.mark_sent([])
        self.db.mark_failed([], "noop")
        eid = self.db.enqueue("E", {}, "now")
        row = self.db.pending(10)[0]
        self.db.mark_failed([row["db_id"]], "boom")
        self.assertEqual(self.db.queue_depth(), 1)
        attempts = self.db._conn.execute(
            "SELECT attempts FROM outbox WHERE id=?", (row["db_id"],)
        ).fetchone()["attempts"]
        self.assertEqual(attempts, 1)
        self.db.mark_sent([row["db_id"]])
        self.assertEqual(self.db.queue_depth(), 0)

    def test_capture_roundtrip(self):
        with tempfile.TemporaryDirectory() as cap:
            worker = CameraWorker(True, 0, cap, 18.0, 25.0, "", ["unknown"], 224, lambda *_a: None)
            worker._cv2 = cv2
            worker._latest_frame = np.full((60, 80, 3), 120, dtype=np.uint8)
            worker._detect = lambda _f: ([(10, 10, 20, 20)], True)
            ev = worker.capture_evidence("FRAUD", "X", "s1")
            self.db.enqueue_capture(ev)
            self.assertEqual(self.db.capture_queue_depth(), 1)
            row = self.db.pending_captures(5)[0]
            self.assertEqual(row["localCaptureId"], ev["id"])
            self.db.mark_capture_sent(row["db_id"])
            self.assertEqual(self.db.capture_queue_depth(), 0)
            self.db.mark_capture_failed(row["db_id"], 2, "err")

    def test_lease_lifecycle(self):
        self.assertIsNone(self.db.active_lease())
        now = time.time()
        self.db.save_lease({
            "id": "l1", "sessionId": "s1", "userRef": None,
            "issuedAt": now, "expiresAt": now - 10, "status": "ACTIVE", "signature": "x",
        })
        self.assertIsNone(self.db.active_lease())
        self.db.save_lease({
            "id": "l2", "sessionId": "s2", "userRef": None,
            "issuedAt": now, "expiresAt": now + 100, "status": "ACTIVE", "signature": "x",
        })
        self.assertEqual(self.db.active_lease()["session_id"], "s2")
        self.db.deactivate_leases()
        self.assertIsNone(self.db.active_lease())


# --------------------------------------------------------------------------- #
# hardware
# --------------------------------------------------------------------------- #
class HardwareTest(unittest.TestCase):
    def test_mock_basics(self):
        hw = MockHardware()
        snap = hw.read()
        self.assertTrue(snap.camera_online)
        hw.set_input_gate(True)
        hw.set_conveyor("FORWARD")
        hw.set_compactor(True)
        hw.all_stop()
        self.assertFalse(hw.input_gate_open)
        self.assertEqual(hw.conveyor, "STOPPED")
        hw.close()
        with self.assertRaises(ValueError):
            hw.patch(nope=1)
        self.assertEqual(SensorSnapshot().to_dict()["temperature_c"], 28.0)

    def test_gpio_missing_module(self):
        real = sys.modules.get("gpiozero")
        sys.modules["gpiozero"] = None
        try:
            with self.assertRaises(RuntimeError):
                GpioHardware(RvmConfig(machine_secret="x"))
        finally:
            if real is None:
                sys.modules.pop("gpiozero", None)
            else:
                sys.modules["gpiozero"] = real

    def test_gpio_missing_pins(self):
        fake = types.ModuleType("gpiozero")

        class B:
            def __init__(self, *a, **k): pass
        fake.Button = B
        fake.DigitalOutputDevice = B
        fake.DistanceSensor = B
        real = sys.modules.get("gpiozero")
        sys.modules["gpiozero"] = fake
        try:
            with self.assertRaises(RuntimeError):
                GpioHardware(RvmConfig(machine_secret="x", gpio_pins={"chamber": 1}))
        finally:
            if real is None:
                sys.modules.pop("gpiozero", None)
            else:
                sys.modules["gpiozero"] = real

    def test_gpio_outputs_boot_off_and_all_stop_survives_failing_output(self):
        fake = types.ModuleType("gpiozero")
        outputs = []

        class Input:
            def __init__(self, *a, **k): self.is_pressed = False

        class Output:
            def __init__(self, *a, **k):
                self.initial_value = k.get("initial_value")
                self._value = bool(self.initial_value)
                self.fail = False
                outputs.append(self)

            @property
            def value(self): return self._value

            @value.setter
            def value(self, v):
                if self.fail:
                    raise OSError("gpio write failed")
                self._value = bool(v)

            def on(self): self.value = True
            def off(self): self.value = False
        fake.Button = Input
        fake.DigitalOutputDevice = Output
        fake.DistanceSensor = Input
        pins = {
            "chamber": 1, "item_beam": 2, "acceptance_beam": 3, "service_panel": 4,
            "collection_door": 5, "input_gate": 6, "conveyor_forward": 7,
            "conveyor_reverse": 8, "compactor": 9,
        }
        real = sys.modules.get("gpiozero")
        sys.modules["gpiozero"] = fake
        try:
            hw = GpioHardware(RvmConfig(machine_secret="x", gpio_pins=pins))
        finally:
            if real is None:
                sys.modules.pop("gpiozero", None)
            else:
                sys.modules["gpiozero"] = real
        # Boot / crash restart: every actuator starts de-energised.
        self.assertEqual(len(outputs), 4)
        self.assertTrue(all(output.initial_value is False for output in outputs))
        self.assertFalse(any(output.value for output in outputs))

        hw.set_input_gate(True)
        hw.set_conveyor("FORWARD")
        hw.set_compactor(True)
        hw.gate.fail = True
        with self.assertRaisesRegex(OSError, "gpio write failed"):
            hw.all_stop()
        # A failing gate output must not leave the conveyor or compactor running.
        self.assertFalse(hw.conveyor_fwd.value)
        self.assertFalse(hw.conveyor_rev.value)
        self.assertFalse(hw.compactor.value)

    def test_gpio_full_read(self):
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
        mpu = types.ModuleType("mpu6050")

        class Mpu:
            def __init__(self, *a, **k): pass
            def get_accel_data(self, g=False): return {"x": 0.0, "y": 0.0, "z": 1.0}
        mpu.mpu6050 = Mpu
        hx = types.ModuleType("hx711")

        class Hx:
            def __init__(self, *a, **k): pass
            def set_reference_unit(self, *a): pass
            def reset(self): pass
            def tare(self): pass
            def get_weight(self, n): return 12.0
            def power_down(self): pass
            def power_up(self): pass
        hx.HX711 = Hx

        pins = {
            "chamber": 1, "item_beam": 2, "acceptance_beam": 3, "service_panel": 4,
            "collection_door": 5, "input_gate": 6, "conveyor_forward": 7,
            "conveyor_reverse": 8, "compactor": 9, "ultrasonic_echo": 10,
            "ultrasonic_trigger": 11, "direction_reverse": 12,
        }
        cfg = RvmConfig(
            machine_secret="x", gpio_pins=pins, load_cell_enabled=True,
            vibration_sensor_enabled=True,
        )
        saved = {m: sys.modules.get(m) for m in ("gpiozero", "mpu6050", "hx711")}
        sys.modules["gpiozero"] = fake
        sys.modules["mpu6050"] = mpu
        sys.modules["hx711"] = hx
        try:
            hw = GpioHardware(cfg)
            snap = hw.read()
            self.assertEqual(snap.weight_grams, 12.0)
            self.assertAlmostEqual(snap.vibration_g, 0.0)
            hw.set_input_gate(True)
            hw.set_conveyor("FORWARD")
            hw.set_conveyor("REVERSE")
            hw.set_conveyor("STOPPED")
            hw.set_compactor(True)
            hw.all_stop()
            hw.close()
        finally:
            for m, v in saved.items():
                if v is None:
                    sys.modules.pop(m, None)
                else:
                    sys.modules[m] = v


# --------------------------------------------------------------------------- #
# fraud mixin
# --------------------------------------------------------------------------- #
class FraudTest(unittest.TestCase):
    def test_report_fraud_disabled_camera(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            c.config.camera_enabled = False
            c.report_fraud("REVERSE_MOTION", {"x": 1})
            alert = c.public_state()["alert"]
            self.assertEqual(alert["reason"], "REVERSE_MOTION")
            c.db.close()

    def test_report_fraud_enabled_camera(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp, camera_enabled=True)
            c._capture_camera_evidence = lambda *a, **k: captured.append(a)
            captured = []
            c.report_fraud("REVERSE_MOTION", {})
            self.assertEqual(len(captured), 1)
            c.db.close()

    def test_set_and_clear_alert(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            c._set_alert("FRAUD", "R", "WARNING", {"a": 1})
            self.assertEqual(c._active_alert["reason"], "R")
            c._clear_alert()
            self.assertIsNone(c._active_alert)
            self.assertIsNone(c.db.get_json("active_alert"))
            c.db.close()

    def test_capture_evidence_disabled_returns(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp)
            c.config.camera_enabled = False
            self.assertIsNone(c._capture_camera_evidence("FRAUD", "R", None))
            c.db.close()

    def test_capture_evidence_queued_and_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp, camera_enabled=True)
            c.config.camera_capture_security_events = True
            c.camera = mock.MagicMock()
            c.camera.capture_evidence.return_value = None
            c._capture_camera_evidence("FRAUD", "R", "s1")
            time.sleep(0.1)
            self.assertEqual(c.db.get_json("active_alert"), None)
            c.camera.capture_evidence.return_value = {
                "id": "cap1", "kind": "FRAUD", "reason": "R", "sessionId": "s1",
                "imagePath": str(Path(tmp) / "cap1.jpg"), "facePaths": [],
                "faceCount": 0, "personDetected": False, "occurredAt": iso_now(),
            }
            c._capture_camera_evidence("FRAUD", "R", "s1")
            time.sleep(0.1)
            self.assertEqual(c.db.capture_queue_depth(), 1)
            c.db.close()

    def test_camera_alert_dispatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = controller_in(tmp, camera_enabled=True)
            c._camera_alert("CAMERA_OCCLUDED", {})
            self.assertEqual(c.state, MachineState.SAFE_STATE)
            # The latch only resets once the enabled camera is healthy again.
            with self.assertRaisesRegex(ValueError, "kamera masih offline"):
                c._reset_mock_state()
            self.assertEqual(c.state, MachineState.SAFE_STATE)
            c.camera.status.online = True
            c._reset_mock_state()
            c._camera_alert("FACE_MODEL_LOAD_FAILED", {})
            self.assertIsNone(c._active_alert)
            c.db.close()


# --------------------------------------------------------------------------- #
# camera (full, with cv2)
# --------------------------------------------------------------------------- #
class CameraFullTest(unittest.TestCase):
    def _worker(self, tmp, **kw):
        return CameraWorker(
            True, 0, str(Path(tmp) / "ev"), 18.0, 25.0,
            kw.get("model", ""), ["bottle_pet", "can_aluminium", "unknown"], 224,
            lambda *_a: None,
            face_detection_enabled=kw.get("face", True),
            person_detection_enabled=kw.get("person", True),
        )

    def test_capture_with_and_without_faces(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self._worker(tmp)
            w._cv2 = cv2
            w._latest_frame = np.full((60, 80, 3), 120, dtype=np.uint8)
            w._detect = lambda _f: ([(10, 10, 20, 20)], True)
            ev = w.capture_evidence("FRAUD", "R", "s1")
            self.assertEqual(len(ev["facePaths"]), 1)
            w._detect = lambda _f: ([], False)
            ev2 = w.capture_evidence("FRAUD", "R", "s1")
            self.assertEqual(ev2["faceCount"], 0)
            self.assertFalse(ev2["personDetected"])

    def test_classify_branches(self):
        with tempfile.TemporaryDirectory() as tmp:
            disabled = CameraWorker(
                False, 0, str(Path(tmp) / "ev"), 18.0, 25.0, "",
                ["bottle_pet", "can_aluminium", "unknown"], 224, lambda *_a: None,
            )
            self.assertEqual(
                disabled.classify(),
                {"detectedType": "unknown", "confidence": 0.0, "reason": "CAMERA_DISABLED"},
            )
            w = self._worker(tmp)
            self.assertEqual(
                w.classify(),
                {"detectedType": "unknown", "confidence": 0.0, "reason": "NO_FRAME"},
            )
            w._latest_frame = np.full((60, 80, 3), 120, dtype=np.uint8)
            self.assertEqual(
                w.classify(),
                {"detectedType": "unknown", "confidence": 0.0, "reason": "NO_MODEL"},
            )
            net = mock.MagicMock()
            net.forward.return_value = np.array([[0.1, 0.9, 0.05]])
            w._net = net
            w._cv2 = cv2
            out = w.classify()
            self.assertEqual(out["detectedType"], "can_aluminium")
            self.assertAlmostEqual(out["confidence"], 0.9)

    def test_cleanup_removes_old_and_over_max(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self._worker(tmp, face=False, person=False)
            w.max_local_captures = 2
            w.retention_days = 1
            folder = Path(w.evidence_dir) / "2020-01-01"
            folder.mkdir(parents=True)
            old = folder / "old.jpg"
            old.write_bytes(b"x")
            old_stat = old.stat()
            import os
            os.utime(old, (old_stat.st_atime, time.time() - 86400 * 2))
            for i in range(3):
                f = Path(w.evidence_dir) / f"new{i}.jpg"
                f.write_bytes(b"y")
            (Path(w.evidence_dir) / "stale.jpg").mkdir()
            w.cleanup_old_captures()
            self.assertFalse(old.exists())
            self.assertEqual(len(list(Path(w.evidence_dir).rglob("new*.jpg"))), 2)

    def _run_frames(self, tmp, frames, want, timeout=3.0):
        w = self._worker(tmp)
        w.startup_grace_seconds = 0.0
        w.anomaly_frames = 1
        w._load_detectors = lambda cv2_module: None
        alerts = []
        w.on_alert = lambda reason, payload: alerts.append(reason)

        class FakeCap:
            def __init__(self, frames):
                self._gen = iter(frames)
            def read(self):
                try:
                    fr = next(self._gen)
                except StopIteration:
                    return False, None
                return (True, fr) if fr is not None else (False, None)
            def release(self):
                pass
        with mock.patch.object(cv2, "VideoCapture", return_value=FakeCap(frames)):
            w.start()
            try:
                deadline = time.time() + timeout
                while time.time() < deadline and want not in alerts:
                    time.sleep(0.02)
            finally:
                w.stop()
        return alerts

    def test_run_offline(self):
        with tempfile.TemporaryDirectory() as tmp:
            alerts = self._run_frames(tmp, [None, None], "CAMERA_OFFLINE")
            self.assertIn("CAMERA_OFFLINE", alerts)

    def test_run_occluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            frame = np.zeros((60, 80, 3), dtype=np.uint8)
            alerts = self._run_frames(tmp, [frame], "CAMERA_OCCLUDED")
            self.assertIn("CAMERA_OCCLUDED", alerts)

    def test_run_blurry(self):
        with tempfile.TemporaryDirectory() as tmp:
            frame = np.full((60, 80, 3), 200, dtype=np.uint8)
            alerts = self._run_frames(tmp, [frame], "CAMERA_BLURRY")
            self.assertIn("CAMERA_BLURRY", alerts)

    def test_detect(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self._worker(tmp)
            frame = np.full((60, 80, 3), 120, dtype=np.uint8)

            w._cv2 = cv2
            w._face_detector = None
            w._person_detector = None
            self.assertEqual(w._detect(frame), ([], False))

            w._face_detector = mock.MagicMock()
            w._face_detector.detectMultiScale.return_value = [(10, 10, 20, 20)]
            w._person_detector = None
            faces, person = w._detect(frame)
            self.assertEqual(faces, [(10, 10, 20, 20)])
            self.assertTrue(person)

            w._face_detector = None
            w._person_detector = mock.MagicMock()
            w._person_detector.detectMultiScale.return_value = ([(5, 5, 10, 10)], [0.9])
            faces, person = w._detect(frame)
            self.assertEqual(faces, [])
            self.assertTrue(person)

            w._face_detector = mock.MagicMock()
            w._face_detector.detectMultiScale.return_value = [(1, 1, 5, 5), (2, 2, 5, 5)]
            w._person_detector = mock.MagicMock()
            w._person_detector.detectMultiScale.return_value = ([(5, 5, 10, 10)], [0.9])
            faces, person = w._detect(frame)
            self.assertEqual(len(faces), 2)
            self.assertTrue(person)

    def test_load_detectors_sets_detectors(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self._worker(tmp, face=True, person=True)
            w._load_detectors(cv2)
            self.assertIsNotNone(w._face_detector)
            self.assertIsNotNone(w._person_detector)

            w2 = self._worker(tmp, face=False, person=False)
            w2._load_detectors(cv2)
            self.assertIsNone(w2._face_detector)
            self.assertIsNone(w2._person_detector)

    def test_load_detectors_face_model_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self._worker(tmp, face=True, person=False)
            alerts = []
            w.on_alert = lambda reason, payload: alerts.append(reason)
            empty = mock.MagicMock()
            empty.empty.return_value = True
            with mock.patch.object(cv2, "CascadeClassifier", return_value=empty):
                w._load_detectors(cv2)
            self.assertIsNone(w._face_detector)
            self.assertIn("FACE_MODEL_LOAD_FAILED", alerts)

    def test_capture_imwrite_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self._worker(tmp)
            w._cv2 = types.SimpleNamespace(IMWRITE_JPEG_QUALITY=1, imwrite=lambda *a: False)
            w._latest_frame = np.full((60, 80, 3), 120, dtype=np.uint8)
            w._detect = lambda _f: ([], False)
            self.assertIsNone(w.capture_evidence("FRAUD", "R", "s1"))

    def test_capture_skips_empty_crop(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self._worker(tmp)
            w._cv2 = cv2
            w._latest_frame = np.full((60, 80, 3), 120, dtype=np.uint8)
            w._detect = lambda _f: ([(10, 10, -5, -5)], False)
            ev = w.capture_evidence("FRAUD", "R", "s1")
            self.assertEqual(ev["faceCount"], 0)
            self.assertEqual(ev["facePaths"], [])
        with tempfile.TemporaryDirectory() as tmp:
            alerts = []
            w = self._worker(tmp, model="/nope.onnx")
            w._load_detectors = lambda cv2_module: None
            w.on_alert = lambda reason, payload: alerts.append(reason)
            cap = mock.MagicMock()
            cap.read.return_value = (True, np.full((60, 80, 3), 120, dtype=np.uint8))
            cap.release = lambda: None
            with mock.patch.object(cv2, "VideoCapture", return_value=cap):
                w.start()
                try:
                    deadline = time.time() + 2
                    while time.time() < deadline and "CLASSIFIER_LOAD_FAILED" not in alerts:
                        time.sleep(0.02)
                finally:
                    w.stop()
            self.assertIn("CLASSIFIER_LOAD_FAILED", alerts)

        with tempfile.TemporaryDirectory() as tmp:
            alerts = []
            w = self._worker(tmp)
            w.on_alert = lambda reason, payload: alerts.append(reason)
            orig = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

            def fake_import(name, *a, **k):
                if name == "cv2":
                    raise ImportError("no cv2")
                return orig(name, *a, **k)
            with mock.patch("builtins.__import__", side_effect=fake_import):
                w.start()
                try:
                    deadline = time.time() + 2
                    while time.time() < deadline and "CAMERA_DEPENDENCY_MISSING" not in alerts:
                        time.sleep(0.02)
                finally:
                    w.stop()
            self.assertIn("CAMERA_DEPENDENCY_MISSING", alerts)


if __name__ == "__main__":
    unittest.main()
