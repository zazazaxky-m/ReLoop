"""B01b: the RVM stops accepting items when the signed session bound is
exhausted. The refusal goes through the existing guarded paths (R01): the
conveyor never moves, no ITEM_ACCEPTED_POINT is emitted, the gate stays shut,
and the consumed counter survives lease renewal and a restart."""
from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from rvm.config import RvmConfig
from rvm.controller import RvmController, MachineState
from rvm.lease import policy_version, sign_lease_v2

SECRET = "bound-test-secret"
MACHINE = "BOUND-001"
ITEM_TYPE = "wt-item"
KG_TYPE = "wt-kg"


def make_controller(tmp: str, **overrides) -> RvmController:
    config = dict(
        machine_code=MACHINE,
        machine_secret=SECRET,
        database_path=str(Path(tmp) / "rvm.db"),
        server_url="http://127.0.0.1:1",
        hardware_driver="mock",
        camera_capture_session_start=False,
        camera_capture_security_events=False,
        compactor_enabled=False,
        max_item_weight_grams=500.0,
    )
    config.update(overrides)
    controller = RvmController(RvmConfig(**config))
    if controller.state == MachineState.BOOTING:
        controller.set_state(MachineState.IDLE, "test-setup")
    return controller


def policy(*, mode: str = "MONEY_REWARD", multiplier_bps: int = 10000, kg: bool = False) -> dict:
    types = [{"id": ITEM_TYPE, "unit": "ITEM", "rewardPerUnit": 100, "maxRewardRupiah": round(100 * multiplier_bps / 10000)}]
    if kg:
        types.append({"id": KG_TYPE, "unit": "KG", "rewardPerUnit": 2000, "maxRewardRupiah": None})
    return {"version": 1, "mode": mode, "multiplierBps": multiplier_bps, "wasteTypes": types}


def lease_for(session_id: str, *, ceiling: int | None, max_items: int | None, pol: dict | None = None,
              ttl: int = 120, reservation: str | None = "res-1") -> dict:
    pol = pol or policy()
    now = int(time.time())
    signed = sign_lease_v2(SECRET, {
        "id": f"lease-{session_id}", "machineCode": MACHINE, "sessionId": session_id, "userRef": "user-1",
        "issuedAt": now, "expiresAt": now + ttl, "reservationId": reservation,
        "policyVersion": policy_version(pol), "ceilingRupiah": ceiling, "maxItems": max_items,
    })
    signed["policy"] = pol
    return signed


def sensor_pass(controller: RvmController) -> None:
    snapshot = controller.hardware.read()
    controller._process_sensors(snapshot)
    controller._last = snapshot


def events_of(controller: RvmController, event_type: str, session_id: str | None = None) -> list[dict]:
    rows = controller.db.pending(500)
    return [r for r in rows if r["eventType"] == event_type and (session_id is None or r["sessionId"] == session_id)]


class OutputRecorder:
    """Records every conveyor/gate write of the mock adapter."""

    def __init__(self, controller: RvmController):
        self.writes: list[tuple] = []
        hardware = controller.hardware
        original_conveyor, original_gate = hardware.set_conveyor, hardware.set_input_gate

        def conveyor(direction):
            self.writes.append(("conveyor", direction))
            original_conveyor(direction)

        def gate(open_):
            self.writes.append(("gate", open_))
            original_gate(open_)

        hardware.set_conveyor = conveyor
        hardware.set_input_gate = gate


def insert_item(controller: RvmController, waste_type_id: str | None, weight: float = 25.0) -> None:
    """One physical item through the mock sensors: detected, weighed, acceptance beam."""
    if waste_type_id:
        assert controller.select_waste_type(waste_type_id), "selection needs SESSION_ACTIVE"
    hardware = controller.hardware
    hardware.patch(chamber_open=True)
    sensor_pass(controller)
    hardware.patch(item_present=True)
    sensor_pass(controller)
    hardware.patch(item_present=False, weight_grams=weight, weight_stable=True)
    sensor_pass(controller)
    hardware.patch(acceptance_triggered=True)
    sensor_pass(controller)
    hardware.patch(acceptance_triggered=False, weight_grams=0, weight_stable=False, chamber_open=False)
    sensor_pass(controller)


class SessionBoundTest(unittest.TestCase):
    def test_ceiling_stops_items_once_the_next_item_cannot_be_covered(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                recorder = OutputRecorder(controller)
                session = "session-ceiling"
                self.assertTrue(controller.activate_lease(lease_for(session, ceiling=250, max_items=None)))
                self.assertTrue(controller.hardware.input_gate_open)
                bound = controller.public_state()["sessionBound"]
                self.assertEqual(bound["ceilingRupiah"], 250)
                self.assertEqual(bound["consumedRupiah"], 0)
                self.assertEqual(bound["remainingRupiah"], 250)
                self.assertFalse(bound["exhausted"])

                insert_item(controller, ITEM_TYPE)
                insert_item(controller, ITEM_TYPE)
                self.assertEqual(len(events_of(controller, "ITEM_ACCEPTED_POINT", session)), 2)
                bound = controller.public_state()["sessionBound"]
                self.assertEqual(bound["consumedRupiah"], 200)
                self.assertEqual(bound["consumedItems"], 2)
                self.assertEqual(bound["remainingRupiah"], 50)
                # The cheapest item (Rp100) no longer fits: the bound is exhausted.
                self.assertTrue(bound["exhausted"])
                self.assertEqual(bound["reason"], "SESSION_CEILING_REACHED")
                self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
                self.assertFalse(controller.hardware.input_gate_open)
                self.assertFalse(controller.try_open_input_gate("test-at-bound"))
                self.assertFalse(controller.hardware.input_gate_open)

                # A third item forced in anyway is refused at the acceptance
                # point: no conveyor movement, no acceptance, gate shut.
                writes_before = len(recorder.writes)
                insert_item(controller, ITEM_TYPE)
                self.assertEqual(len(events_of(controller, "ITEM_ACCEPTED_POINT", session)), 2)
                rejected = events_of(controller, "ITEM_REJECTED", session)
                self.assertEqual(len(rejected), 1)
                self.assertEqual(rejected[0]["payload"]["reason"], "SESSION_BOUND_REACHED")
                self.assertEqual(rejected[0]["payload"]["bound"], "SESSION_CEILING_REACHED")
                self.assertNotIn(("conveyor", "FORWARD"), recorder.writes[writes_before:])
                self.assertNotIn(("gate", True), recorder.writes[writes_before:])
                self.assertEqual(controller.hardware.conveyor, "STOPPED")
                self.assertFalse(controller.hardware.input_gate_open)
                self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
                self.assertEqual(controller.public_state()["sessionBound"]["consumedRupiah"], 200)
                self.assertEqual(controller.db.session_consumption(session)["consumed_items"], 2)
            finally:
                controller.db.close()

    def test_max_items_bound_refuses_the_next_item(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                recorder = OutputRecorder(controller)
                session = "session-items"
                self.assertTrue(controller.activate_lease(lease_for(session, ceiling=None, max_items=1)))
                insert_item(controller, ITEM_TYPE)
                bound = controller.public_state()["sessionBound"]
                self.assertEqual(bound["consumedItems"], 1)
                self.assertEqual(bound["remainingItems"], 0)
                self.assertTrue(bound["exhausted"])
                self.assertEqual(bound["reason"], "SESSION_MAX_ITEMS_REACHED")
                writes_before = len(recorder.writes)
                insert_item(controller, ITEM_TYPE)
                self.assertEqual(len(events_of(controller, "ITEM_ACCEPTED_POINT", session)), 1)
                rejected = events_of(controller, "ITEM_REJECTED", session)
                self.assertEqual([r["payload"]["bound"] for r in rejected], ["SESSION_MAX_ITEMS_REACHED"])
                self.assertNotIn(("conveyor", "FORWARD"), recorder.writes[writes_before:])
                self.assertFalse(controller.hardware.input_gate_open)
            finally:
                controller.db.close()

    def test_per_type_caps_bound_the_selected_type_and_a_kg_type_uses_the_machine_max_weight(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                session = "session-kg"
                pol = policy(multiplier_bps=15000, kg=True)
                # KG cap: ceil(0.5 kg x Rp2.000/kg x 1.5) = Rp1.500; ITEM cap: round(100 x 1.5) = Rp150.
                self.assertTrue(controller.activate_lease(lease_for(session, ceiling=2000, max_items=None, pol=pol)))
                insert_item(controller, KG_TYPE, weight=480.0)
                self.assertEqual(controller.public_state()["sessionBound"]["consumedRupiah"], 1500)
                # Another KG item cannot be covered (1.500 + 1.500 > 2.000): refused.
                insert_item(controller, KG_TYPE, weight=480.0)
                self.assertEqual(len(events_of(controller, "ITEM_ACCEPTED_POINT", session)), 1)
                self.assertEqual(len(events_of(controller, "ITEM_REJECTED", session)), 1)
                # The bound is not exhausted for the cheapest type: an ITEM still fits.
                self.assertFalse(controller.public_state()["sessionBound"]["exhausted"])
                insert_item(controller, ITEM_TYPE)
                self.assertEqual(len(events_of(controller, "ITEM_ACCEPTED_POINT", session)), 2)
                self.assertEqual(controller.public_state()["sessionBound"]["consumedRupiah"], 1650)
                # Without a selection the most expensive cap is assumed: refused now.
                controller._selected_waste_type_id = None
                insert_item(controller, None)
                self.assertEqual(len(events_of(controller, "ITEM_ACCEPTED_POINT", session)), 2)
                self.assertEqual(len(events_of(controller, "ITEM_REJECTED", session)), 2)
            finally:
                controller.db.close()

    def test_renew_and_restart_keep_the_consumed_counter_and_never_reopen_the_gate_at_the_bound(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            session = "session-durable"
            try:
                self.assertTrue(controller.activate_lease(lease_for(session, ceiling=250, max_items=None, ttl=2)))
                insert_item(controller, ITEM_TYPE)
                insert_item(controller, ITEM_TYPE)
                self.assertTrue(controller.public_state()["sessionBound"]["exhausted"])
                time.sleep(2.1)
                self.assertIsNone(controller.db.active_lease())
                # Renewal: same session, same reservation and ceiling, fresh expiry.
                renewed = lease_for(session, ceiling=250, max_items=None, ttl=120)
                self.assertTrue(controller.activate_lease(renewed))
                self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
                self.assertFalse(controller.hardware.input_gate_open, "gate must stay shut at the bound")
                bound = controller.public_state()["sessionBound"]
                self.assertEqual(bound["consumedRupiah"], 200)
                self.assertEqual(bound["consumedItems"], 2)
                self.assertTrue(bound["exhausted"])
                self.assertEqual(controller.db.active_lease()["issued_at"], renewed["issuedAt"])
                # No CHAMBER_OPENED (lease activation) for a renewal that did not open the gate.
                opened = [e for e in events_of(controller, "CHAMBER_OPENED", session) if e["payload"].get("leaseActivated")]
                self.assertEqual(len(opened), 1)
            finally:
                controller.db.close()
            # Restart on the same SQLite file: the counter and the bound survive.
            restarted = make_controller(tmp)
            try:
                restarted._recover_state_after_restart()
                self.assertEqual(restarted.state, MachineState.SESSION_ACTIVE)
                bound = restarted.public_state()["sessionBound"]
                self.assertEqual(bound["consumedRupiah"], 200)
                self.assertTrue(bound["exhausted"])
                self.assertFalse(restarted.hardware.input_gate_open)
                insert_item(restarted, ITEM_TYPE)
                self.assertEqual(len(events_of(restarted, "ITEM_ACCEPTED_POINT", session)), 2)
                self.assertEqual(len(events_of(restarted, "ITEM_REJECTED", session)), 1)
            finally:
                restarted.db.close()

    def test_interlock_still_outranks_everything_below_the_bound(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp, camera_enabled=True)
            try:
                controller.camera.status.online = True
                session = "session-interlock"
                self.assertTrue(controller.activate_lease(lease_for(session, ceiling=1000, max_items=None)))
                # The enabled camera worker reports an occluded lens: the R01
                # guard refuses the conveyor exactly as before B01b.
                controller.camera.status.occluded = True
                insert_item(controller, ITEM_TYPE)
                rejected = events_of(controller, "ITEM_REJECTED", session)
                self.assertEqual(rejected[-1]["payload"], {"reason": "ACTUATION_BLOCKED", "blockedBy": "CAMERA_OCCLUDED"})
                self.assertEqual(events_of(controller, "ITEM_ACCEPTED_POINT", session), [])
                # Nothing was consumed for an item the conveyor never moved.
                self.assertEqual(controller.db.session_consumption(session)["consumed_rupiah"], 0)
                self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
                self.assertFalse(controller.hardware.input_gate_open)
                self.assertEqual(controller.hardware.conveyor, "STOPPED")
            finally:
                controller.db.close()

    def test_a_lease_below_the_cheapest_item_opens_no_gate_but_keeps_the_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = make_controller(tmp)
            try:
                session = "session-tiny"
                self.assertTrue(controller.activate_lease(lease_for(session, ceiling=50, max_items=None)))
                self.assertEqual(controller.state, MachineState.SESSION_ACTIVE)
                self.assertFalse(controller.hardware.input_gate_open)
                bound = controller.public_state()["sessionBound"]
                self.assertTrue(bound["exhausted"])
                self.assertEqual(bound["remainingRupiah"], 50)
            finally:
                controller.db.close()


if __name__ == "__main__":
    unittest.main()
