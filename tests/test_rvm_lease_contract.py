"""B01b: lease protocol v2 (signed reward caps) on the RVM side, asserted
against the same fixture the Node test reads
(tests/fixtures/contracts/machine-lease.v2.json)."""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import tempfile
import time
import unittest
from pathlib import Path

from rvm.config import RvmConfig
from rvm.controller import RvmController, MachineState
from rvm.lease import (
    LEASE_PROTOCOL_VERSION,
    canonical_lease_v2,
    canonical_policy,
    policy_version,
    sign_lease_v2,
    verify_lease_v2,
)

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "contracts" / "machine-lease.v2.json"
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
SECRET = FIXTURE["secret"]


def make_controller(tmp: str, machine_code: str = "AUDIT-A-01", **overrides) -> RvmController:
    config = dict(
        machine_code=machine_code,
        machine_secret=SECRET,
        database_path=str(Path(tmp) / "rvm.db"),
        server_url="http://127.0.0.1:1",
        hardware_driver="mock",
        camera_capture_session_start=False,
        camera_capture_security_events=False,
    )
    config.update(overrides)
    controller = RvmController(RvmConfig(**config))
    controller.set_state(MachineState.IDLE, "test-setup")
    return controller


class FixtureContractTest(unittest.TestCase):
    def test_python_json_dumps_produces_the_fixture_canonical_bytes_and_signature(self):
        self.assertEqual(LEASE_PROTOCOL_VERSION, 2)
        for name, entry in FIXTURE["leases"].items():
            with self.subTest(lease=name):
                lease = entry["lease"]
                canonical = canonical_lease_v2(lease)
                self.assertIsInstance(canonical, bytes)
                self.assertEqual(canonical.decode("utf-8"), entry["canonical"])
                # The exact convention the brief fixes.
                expected = json.dumps(
                    [2, lease["id"], lease["machineCode"], lease["sessionId"], lease["userRef"],
                     lease["issuedAt"], lease["expiresAt"], lease["reservationId"], lease["policyVersion"],
                     lease["ceilingRupiah"], lease["maxItems"]],
                    separators=(",", ":"), ensure_ascii=False,
                ).encode("utf-8")
                self.assertEqual(canonical, expected)
                self.assertEqual(
                    hmac.new(SECRET.encode("utf-8"), canonical, hashlib.sha256).hexdigest(), lease["signature"]
                )
                signed = sign_lease_v2(SECRET, {key: lease[key] for key in (
                    "id", "machineCode", "sessionId", "userRef", "issuedAt", "expiresAt",
                    "reservationId", "policyVersion", "ceilingRupiah", "maxItems")})
                self.assertEqual(signed["signature"], lease["signature"])
                self.assertEqual(signed["version"], 2)
                self.assertIsNone(verify_lease_v2(SECRET, lease, lease["machineCode"]))

    def test_policy_snapshot_canonical_form_and_version(self):
        for name, entry in FIXTURE["leases"].items():
            with self.subTest(lease=name):
                policy = entry["lease"]["policy"]
                self.assertEqual(canonical_policy(policy).decode("utf-8"), entry["policyCanonical"])
                self.assertEqual(policy_version(policy), entry["lease"]["policyVersion"])

    def test_every_tampered_field_is_refused(self):
        base = FIXTURE["leases"]["money"]["lease"]
        cap_fields = {"reservationId", "policyVersion", "ceilingRupiah", "maxItems"}
        self.assertTrue(cap_fields.issubset({t["field"] for t in FIXTURE["tamper"]}))
        for tamper in FIXTURE["tamper"]:
            with self.subTest(case=tamper["case"]):
                tampered = {**base, tamper["field"]: tamper["value"]}
                self.assertIsNotNone(verify_lease_v2(SECRET, tampered, base["machineCode"]))

    def test_policy_tampering_breaks_the_signed_policy_version(self):
        base = FIXTURE["leases"]["money"]["lease"]
        for tamper in FIXTURE["policyTamper"]:
            with self.subTest(case=tamper["case"]):
                policy = copy.deepcopy(base["policy"])
                cursor = policy
                for step in tamper["path"][:-1]:
                    cursor = cursor[step]
                cursor[tamper["path"][-1]] = tamper["value"]
                self.assertIsNotNone(verify_lease_v2(SECRET, {**base, "policy": policy}, base["machineCode"]))
        # A lease without its snapshot cannot prove its caps: refused as well.
        without = {key: value for key, value in base.items() if key != "policy"}
        self.assertIsNotNone(verify_lease_v2(SECRET, without, base["machineCode"]))

    def test_lease_is_bound_to_this_machine(self):
        base = FIXTURE["leases"]["money"]["lease"]
        self.assertIsNotNone(verify_lease_v2(SECRET, base, "AUDIT-B-01"))

    def test_v1_lease_and_non_integer_bounds_are_refused(self):
        v1 = dict(FIXTURE["legacyV1"]["lease"])
        canonical = ".".join(str(v1[k]) for k in ("id", "sessionId", "issuedAt", "expiresAt"))
        v1["signature"] = hmac.new(SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()
        self.assertIsNotNone(verify_lease_v2(SECRET, v1, "AUDIT-A-01"))
        base = FIXTURE["leases"]["money"]["lease"]
        # A float is never an integer here even when it prints like one: json.dumps(10000.0) is "10000.0".
        for field, value in (("ceilingRupiah", "10000"), ("ceilingRupiah", 10000.0), ("maxItems", 1.5),
                             ("issuedAt", True), ("version", 1)):
            with self.subTest(field=field):
                self.assertIsNotNone(verify_lease_v2(SECRET, {**base, field: value}, "AUDIT-A-01"))


class ControllerLeaseV2Test(unittest.TestCase):
    def _live(self, lease: dict, **changes) -> dict:
        now = int(time.time())
        fields = {key: lease[key] for key in (
            "id", "machineCode", "sessionId", "userRef", "reservationId", "ceilingRupiah", "maxItems")}
        fields.update(issuedAt=now, expiresAt=now + 120, policyVersion=policy_version(lease["policy"]))
        fields.update(changes)
        signed = sign_lease_v2(SECRET, fields)
        signed["policy"] = lease["policy"]
        return signed

    def test_controller_activates_a_v2_lease_and_stores_the_signed_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                lease = self._live(FIXTURE["leases"]["money"]["lease"])
                self.assertTrue(controller.verify_lease(lease))
                self.assertTrue(controller.activate_lease(lease))
                self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
                row = controller.db.active_lease()
                self.assertEqual(row["version"], 2)
                self.assertEqual(row["machine_code"], "AUDIT-A-01")
                self.assertEqual(row["reservation_id"], lease["reservationId"])
                self.assertEqual(row["policy_version"], lease["policyVersion"])
                self.assertEqual(row["ceiling_rupiah"], 10000)
                self.assertEqual(row["max_items"], 20)
                self.assertEqual(row["signature"], lease["signature"])
                self.assertEqual(json.loads(row["policy_json"]), lease["policy"])
            finally:
                controller.db.close()

    def test_controller_refuses_v1_leases_and_tampered_caps(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                now = int(time.time())
                v1 = {"id": "lease-v1", "sessionId": "session-v1", "issuedAt": now, "expiresAt": now + 60}
                canonical = ".".join(str(v1[k]) for k in ("id", "sessionId", "issuedAt", "expiresAt"))
                v1["signature"] = hmac.new(SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()
                self.assertFalse(controller.verify_lease(v1))
                self.assertFalse(controller.activate_lease(v1))
                self.assertIsNone(controller.db.active_lease())
                self.assertEqual(controller.state, MachineState.IDLE)
                base = self._live(FIXTURE["leases"]["money"]["lease"])
                for field, value in (("ceilingRupiah", 999999), ("maxItems", None),
                                     ("reservationId", "other"), ("policyVersion", "0" * 64)):
                    with self.subTest(field=field):
                        self.assertFalse(controller.activate_lease({**base, field: value}))
                        self.assertIsNone(controller.db.active_lease())
                        self.assertFalse(controller.hardware.input_gate_open)
                # Another machine's lease never opens this one.
                other = self._live(FIXTURE["leases"]["money"]["lease"], machineCode="AUDIT-B-01")
                self.assertFalse(controller.activate_lease(other))
                self.assertIsNone(controller.db.active_lease())
            finally:
                controller.db.close()

    def test_compliance_lease_has_no_money_bound(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                lease = self._live(FIXTURE["leases"]["compliance"]["lease"])
                self.assertTrue(controller.activate_lease(lease))
                bound = controller.public_state()["sessionBound"]
                self.assertIsNone(bound)
                self.assertTrue(controller.hardware.input_gate_open)
            finally:
                controller.db.close()


if __name__ == "__main__":
    unittest.main()
