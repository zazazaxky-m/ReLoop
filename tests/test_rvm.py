from __future__ import annotations

import hashlib
import hmac
import tempfile
import time
import unittest
from pathlib import Path

from rvm.config import RvmConfig
from rvm.controller import MachineState, RvmController
from rvm.database import EdgeDatabase
from rvm.hardware import MockHardware


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

    def test_maintenance_requires_pin(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = self.make_controller(tmp)
            self.assertIsNone(controller.maintenance_login("wrong"))
            token = controller.maintenance_login("2468")
            self.assertTrue(controller.maintenance_authorized(token))
            controller.db.close()


if __name__ == "__main__":
    unittest.main()
