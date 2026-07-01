from __future__ import annotations

import hashlib
import hmac
import re
import tempfile
import time
import unittest
from pathlib import Path

from rvm.camera import CameraWorker
from rvm.config import RvmConfig
from rvm.controller import MachineState, RvmController, SIMULATION_SCENARIOS
from rvm.database import EdgeDatabase
from rvm.hardware import MockHardware
from rvm.sync import SyncWorker


class DatabaseTest(unittest.TestCase):
    def test_outbox_survives_reopen(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "edge.db")
            db = EdgeDatabase(path)
            event_id = db.enqueue("HEARTBEAT", {"status": "ONLINE"}, "2026-01-01T00:00:00Z")
            self.assertEqual(db.queue_depth(), 1)
            db.close()
            reopened = EdgeDatabase(path)
            self.assertEqual(reopened.pending(10)[0]["localEventId"], event_id)
            reopened.close()


class CameraEvidenceTest(unittest.TestCase):
    def test_capture_saves_scene_face_crop_and_durable_queue(self):
        import cv2
        import numpy as np

        with tempfile.TemporaryDirectory() as tmp:
            worker = CameraWorker(
                True,
                0,
                str(Path(tmp) / "evidence"),
                18.0,
                25.0,
                "",
                ["unknown"],
                224,
                lambda *_args: None,
            )
            worker._cv2 = cv2
            worker._latest_frame = np.full((240, 320, 3), 180, dtype=np.uint8)
            worker._detect = lambda _frame: ([(100, 50, 80, 100)], True)

            capture = worker.capture_evidence(
                "SESSION_START", "SESSION_ACTIVATED", "session-camera"
            )
            self.assertIsNotNone(capture)
            self.assertTrue(Path(capture["imagePath"]).is_file())
            self.assertEqual(capture["faceCount"], 1)
            self.assertTrue(Path(capture["facePaths"][0]).is_file())
            self.assertTrue(capture["personDetected"])

            db = EdgeDatabase(str(Path(tmp) / "edge.db"))
            db.enqueue_capture(capture)
            pending = db.pending_captures()
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]["localCaptureId"], capture["id"])
            self.assertEqual(db.capture_queue_depth(), 1)
            db.mark_capture_sent(pending[0]["db_id"])
            self.assertEqual(db.capture_queue_depth(), 0)
            db.close()


class MediaSyncTest(unittest.TestCase):
    def test_playlist_downloads_with_checksum_and_can_be_disabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "media"
            db = EdgeDatabase(str(Path(tmp) / "edge.db"))
            config = RvmConfig(
                machine_code="TEST-001",
                machine_secret="test-secret",
                database_path=str(Path(tmp) / "unused.db"),
                server_url="http://127.0.0.1:1",
                media_cache_dir=str(cache),
            )
            worker = SyncWorker(config, db)
            payload = b"fake-image-content"
            manifest = {
                "enabled": True,
                "version": "v1",
                "items": [{
                    "id": "ad-1", "title": "Brand A", "mediaType": "IMAGE",
                    "mimeType": "image/png", "fileSize": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "durationSeconds": 9, "downloadPath": "/download/ad-1",
                }],
            }
            worker._signed_get = lambda route, timeout=10: (
                __import__("json").dumps(manifest).encode()
                if "manifest" in route else payload
            )
            self.assertTrue(worker.sync_media())
            playlist = db.get_json("media_playlist")
            self.assertTrue(playlist["enabled"])
            self.assertEqual(playlist["items"][0]["url"], "/media/ad-1.png")
            self.assertEqual((cache / "ad-1.png").read_bytes(), payload)

            worker._signed_get = lambda _route, timeout=10: b'{"enabled":false,"version":"v2","items":[]}'
            self.assertTrue(worker.sync_media())
            self.assertFalse(db.get_json("media_playlist")["enabled"])
            self.assertFalse((cache / "ad-1.png").exists())
            db.close()


class ControllerTest(unittest.TestCase):
    def make_controller(self, tmp: str) -> RvmController:
        return RvmController(
            RvmConfig(
                machine_code="TEST-001",
                machine_secret="test-secret",
                database_path=str(Path(tmp) / "rvm.db"),
                server_url="http://127.0.0.1:1",
                hardware_driver="mock",
                maintenance_pin_hash=RvmConfig.hash_pin("2468"),
            )
        )

    def test_remote_commands_are_allowlisted_and_guard_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            with self.assertRaisesRegex(ValueError, "tidak diizinkan"):
                controller.execute_remote_command("RUN_SHELL", {})
            with self.assertRaisesRegex(ValueError, "sesi aktif"):
                controller.execute_remote_command("OPEN_GATE", {})

            state = controller.execute_remote_command("ENTER_MAINTENANCE", {})
            self.assertEqual(state["runtimeState"], MachineState.MAINTENANCE)
            controller.execute_remote_command("STOP_ALL", {})
            hardware = controller.hardware
            self.assertIsInstance(hardware, MockHardware)
            hardware.patch(service_panel_open=True)
            with self.assertRaisesRegex(ValueError, "panel masih terbuka"):
                controller.execute_remote_command("RESET_ALERT", {})
            hardware.patch(service_panel_open=False)
            controller.execute_remote_command("RESET_ALERT", {})
            resumed = controller.execute_remote_command("RESUME_OPERATION", {})
            self.assertEqual(resumed["runtimeState"], MachineState.IDLE)
            controller.db.close()

    def test_session_and_security_events_trigger_camera_capture(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            controller.config.camera_enabled = True
            captures = []
            controller._capture_camera_evidence = (
                lambda kind, reason, session_id: captures.append(
                    (kind, reason, session_id)
                )
            )
            now = int(time.time())
            lease = {
                "id": "lease-capture-hooks",
                "sessionId": "session-capture-hooks",
                "issuedAt": now,
                "expiresAt": now + 60,
            }
            canonical = ".".join(
                str(lease[key]) for key in ("id", "sessionId", "issuedAt", "expiresAt")
            )
            lease["signature"] = hmac.new(
                b"test-secret", canonical.encode(), hashlib.sha256
            ).hexdigest()
            self.assertTrue(controller.activate_lease(lease))
            controller.report_fraud("REVERSE_MOTION", {})
            controller.enter_safe_state("HIGH_IMPACT_DETECTED", {})

            self.assertIn(
                ("SESSION_START", "SESSION_ACTIVATED", "session-capture-hooks"),
                captures,
            )
            self.assertIn(
                ("FRAUD", "REVERSE_MOTION", "session-capture-hooks"), captures
            )
            self.assertIn(
                ("SECURITY", "HIGH_IMPACT_DETECTED", "session-capture-hooks"),
                captures,
            )
            controller.db.close()

    def test_signed_lease_activates(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            now = int(time.time())
            lease = {
                "id": "lease-1",
                "sessionId": "session-1",
                "issuedAt": now,
                "expiresAt": now + 60,
            }
            canonical = ".".join(str(lease[key]) for key in ("id", "sessionId", "issuedAt", "expiresAt"))
            lease["signature"] = hmac.new(
                b"test-secret", canonical.encode(), hashlib.sha256
            ).hexdigest()
            self.assertTrue(controller.activate_lease(lease))
            self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
            controller.db.close()

    def test_vandalism_enters_safe_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            hardware = controller.hardware
            self.assertIsInstance(hardware, MockHardware)
            hardware.patch(vibration_g=4.0)
            controller._process_sensors(hardware.read())
            self.assertEqual(controller.state, MachineState.SAFE_STATE)
            self.assertGreaterEqual(controller.db.queue_depth(), 2)
            alert = controller.public_state()["alert"]
            self.assertEqual(alert["category"], "VANDALISM")
            self.assertEqual(alert["reason"], "HIGH_IMPACT_DETECTED")
            self.assertEqual(alert["severity"], "CRITICAL")
            controller.db.close()

    def test_interactive_vandalism_scenario(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            controller.start()
            try:
                controller.start_simulation("vandalism-impact")
                deadline = time.time() + 2
                while controller.state != MachineState.SAFE_STATE and time.time() < deadline:
                    time.sleep(0.05)
                self.assertEqual(controller.state, MachineState.SAFE_STATE)
                self.assertEqual(controller.db.get_json("safe_reason"), "HIGH_IMPACT_DETECTED")
            finally:
                controller.stop()

    def test_item_detection_emits_camera_classification(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            hardware = controller.hardware
            self.assertIsInstance(hardware, MockHardware)
            now = int(time.time())
            lease = {
                "id": "lease-camera",
                "sessionId": "session-camera",
                "issuedAt": now,
                "expiresAt": now + 60,
            }
            canonical = ".".join(
                str(lease[key]) for key in ("id", "sessionId", "issuedAt", "expiresAt")
            )
            lease["signature"] = hmac.new(
                b"test-secret", canonical.encode(), hashlib.sha256
            ).hexdigest()
            self.assertTrue(controller.activate_lease(lease))

            hardware.patch(item_present=True)
            controller._process_sensors(hardware.read())

            events = controller.db.pending(20)
            classifications = [
                event for event in events if event["eventType"] == "IMAGE_CLASSIFIED"
            ]
            self.assertEqual(len(classifications), 1)
            self.assertEqual(classifications[0]["sessionId"], "session-camera")
            self.assertEqual(classifications[0]["payload"]["reason"], "CAMERA_DISABLED")
            controller.db.close()

    def test_simulated_can_marks_waste_type(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            hardware = controller.hardware
            self.assertIsInstance(hardware, MockHardware)
            now = int(time.time())
            lease = {
                "id": "lease-can",
                "sessionId": "session-can",
                "issuedAt": now,
                "expiresAt": now + 60,
            }
            canonical = ".".join(
                str(lease[key]) for key in ("id", "sessionId", "issuedAt", "expiresAt")
            )
            lease["signature"] = hmac.new(
                b"test-secret", canonical.encode(), hashlib.sha256
            ).hexdigest()
            self.assertTrue(controller.activate_lease(lease))
            controller._simulation_waste_type_key = "anorganik"
            hardware.patch(item_present=True)
            controller._process_sensors(hardware.read())
            event = next(
                row for row in controller.db.pending(20)
                if row["eventType"] == "ITEM_DETECTED"
            )
            self.assertEqual(event["payload"]["wasteTypeKey"], "anorganik")
            controller.db.close()

    def test_interactive_fraud_scenarios_expose_alert(self):
        scenarios = {
            "string-pull": "REVERSE_MOTION",
            "abnormal-weight": "ABNORMAL_ITEM_WEIGHT",
            "abnormal-underweight": "ABNORMAL_ITEM_WEIGHT",
            "chamber-timeout": "CHAMBER_PROCESS_TIMEOUT",
            "acceptance-without-item": "IMPOSSIBLE_ACCEPTANCE_SEQUENCE",
        }
        for scenario, expected_reason in scenarios.items():
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as tmp:
                controller = self.make_controller(tmp)
                now = int(time.time())
                lease = {
                    "id": f"lease-{scenario}",
                    "sessionId": f"session-{scenario}",
                    "issuedAt": now,
                    "expiresAt": now + 60,
                }
                canonical = ".".join(
                    str(lease[key]) for key in ("id", "sessionId", "issuedAt", "expiresAt")
                )
                lease["signature"] = hmac.new(
                    b"test-secret", canonical.encode(), hashlib.sha256
                ).hexdigest()
                self.assertTrue(controller.activate_lease(lease))
                controller.start()
                try:
                    controller.start_simulation(scenario)
                    deadline = time.time() + 3
                    alert = None
                    while time.time() < deadline:
                        alert = controller.public_state()["alert"]
                        if alert and alert["reason"] == expected_reason:
                            break
                        time.sleep(0.05)
                    self.assertIsNotNone(alert)
                    self.assertEqual(alert["category"], "FRAUD")
                    self.assertEqual(alert["reason"], expected_reason)
                finally:
                    controller.stop()

    def test_non_session_scenarios_reach_expected_state(self):
        expected = {
            "item-without-session": (MachineState.IDLE, "ITEM_WITHOUT_ACTIVE_SESSION"),
            "vandalism-impact": (MachineState.SAFE_STATE, "HIGH_IMPACT_DETECTED"),
            "panel-forced": (MachineState.SAFE_STATE, "SERVICE_PANEL_FORCED_OPEN"),
            "door-forced": (MachineState.SAFE_STATE, "COLLECTION_DOOR_FORCED_OPEN"),
            "camera-covered": (MachineState.SAFE_STATE, "CAMERA_OCCLUDED"),
            "camera-offline": (MachineState.SAFE_STATE, "CAMERA_OFFLINE"),
            "camera-blurry": (MachineState.IDLE, "CAMERA_BLURRY"),
            "overheat": (MachineState.SAFE_STATE, "HIGH_TEMPERATURE"),
            "machine-full": (MachineState.FULL, None),
        }
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            controller.start()
            try:
                for scenario, (expected_state, expected_alert) in expected.items():
                    with self.subTest(scenario=scenario):
                        controller.start_simulation(scenario)
                        deadline = time.time() + 3
                        while (
                            controller._simulation_thread
                            and controller._simulation_thread.is_alive()
                            and time.time() < deadline
                        ):
                            time.sleep(0.05)
                        self.assertEqual(controller.state, expected_state)
                        alert = controller.public_state()["alert"]
                        self.assertEqual(
                            alert["reason"] if alert else None,
                            expected_alert,
                        )
                        controller._reset_mock_state()
            finally:
                controller.stop()

    def test_simulator_panel_exposes_every_registered_scenario(self):
        html = (Path(__file__).parents[1] / "rvm" / "web" / "index.html").read_text(
            encoding="utf-8"
        )
        buttons = set(re.findall(r'data-scenario="([^"]+)"', html))
        self.assertEqual(buttons, set(SIMULATION_SCENARIOS))

    def test_normal_item_emits_full_telemetry_sequence(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            hardware = controller.hardware
            self.assertIsInstance(hardware, MockHardware)
            now = int(time.time())
            lease = {
                "id": "lease-telemetry",
                "sessionId": "session-telemetry",
                "issuedAt": now,
                "expiresAt": now + 60,
            }
            canonical = ".".join(
                str(lease[key]) for key in ("id", "sessionId", "issuedAt", "expiresAt")
            )
            lease["signature"] = hmac.new(
                b"test-secret", canonical.encode(), hashlib.sha256
            ).hexdigest()
            self.assertTrue(controller.activate_lease(lease))

            for values in (
                {"chamber_open": True},
                {"item_present": True},
                {"item_present": False, "weight_grams": 22.0, "weight_stable": True},
                {"acceptance_triggered": True},
            ):
                hardware.patch(**values)
                snapshot = hardware.read()
                controller._process_sensors(snapshot)
                controller._last = snapshot

            event_types = {event["eventType"] for event in controller.db.pending(50)}
            self.assertTrue({
                "ITEM_DETECTED",
                "WEIGHT_MEASURED",
                "SENSOR_SEQUENCE",
                "CONVEYOR_STARTED",
                "ITEM_ACCEPTED_POINT",
                "COMPACTION_STARTED",
                "COMPACTION_COMPLETED",
            }.issubset(event_types))
            controller.db.close()

    def test_camera_blur_and_overheat_are_visible_alerts(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            hardware = controller.hardware
            self.assertIsInstance(hardware, MockHardware)

            hardware.patch(camera_blurry=True)
            controller._process_sensors(hardware.read())
            alert = controller.public_state()["alert"]
            self.assertEqual(alert["category"], "SENSOR")
            self.assertEqual(alert["reason"], "CAMERA_BLURRY")

            controller._reset_mock_state()
            hardware.patch(temperature_c=70.0)
            controller._process_sensors(hardware.read())
            alert = controller.public_state()["alert"]
            self.assertEqual(controller.state, MachineState.SAFE_STATE)
            self.assertEqual(alert["category"], "SAFETY")
            self.assertEqual(alert["reason"], "HIGH_TEMPERATURE")
            controller.db.close()

    def test_fraud_is_exposed_until_reset(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            controller.report_fraud("REVERSE_MOTION", {"retrievalAttempt": True})

            alert = controller.public_state()["alert"]
            self.assertEqual(alert["category"], "FRAUD")
            self.assertEqual(alert["reason"], "REVERSE_MOTION")
            self.assertEqual(alert["severity"], "WARNING")
            self.assertTrue(alert["payload"]["retrievalAttempt"])

            controller._reset_mock_state()
            self.assertIsNone(controller.public_state()["alert"])
            controller.db.close()

    def test_maintenance_requires_pin(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            self.assertIsNone(controller.maintenance_login("wrong"))
            token = controller.maintenance_login("2468")
            self.assertTrue(controller.maintenance_authorized(token))
            controller.db.close()


if __name__ == "__main__":
    unittest.main()
