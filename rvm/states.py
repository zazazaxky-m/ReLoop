from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum


class MachineState(StrEnum):
    BOOTING = "BOOTING"
    IDLE = "IDLE"
    SESSION_ACTIVE = "SESSION_ACTIVE"
    PROCESSING = "PROCESSING"
    SYNC_PENDING = "SYNC_PENDING"
    FULL = "FULL"
    MAINTENANCE = "MAINTENANCE"
    SAFE_STATE = "SAFE_STATE"
    ERROR = "ERROR"


SIMULATION_SCENARIOS = frozenset({
    "normal-bottle",
    "normal-can",
    "string-pull",
    "acceptance-without-item",
    "abnormal-weight",
    "abnormal-underweight",
    "item-without-session",
    "chamber-timeout",
    "vandalism-impact",
    "panel-forced",
    "door-forced",
    "camera-covered",
    "camera-offline",
    "camera-blurry",
    "overheat",
    "machine-full",
})

# States in which no lease, remote command or processing step may open or
# start an actuator, mapped to the interlock reason reported for them. A
# server-side session event never moves the machine out of these states;
# only a validated operator action does.
LOCKED_STATE_BLOCK_REASONS = {
    MachineState.SAFE_STATE: "SAFETY_LATCH_ACTIVE",
    MachineState.MAINTENANCE: "MAINTENANCE_MODE",
    MachineState.FULL: "MACHINE_FULL",
}

# Operator-facing explanation for each interlock reason code.
INTERLOCK_MESSAGES = {
    "SERVICE_PANEL_OPEN": "service panel masih terbuka",
    "COLLECTION_DOOR_OPEN": "pintu kolektor masih terbuka",
    "HIGH_VIBRATION": "getaran masih tinggi",
    "HIGH_TEMPERATURE": "suhu masih tinggi",
    "CAMERA_OFFLINE": "kamera masih offline",
    "CAMERA_OCCLUDED": "kamera masih tertutup",
    "MACHINE_FULL": "kapasitas mesin penuh",
    "MAINTENANCE_MODE": "mesin dalam mode maintenance",
    "MAINTENANCE_REQUIRED": "mesin belum dalam mode maintenance",
    "SAFETY_LATCH_ACTIVE": "alert keselamatan belum direset",
    "SENSOR_READ_FAILED": "sensor tidak dapat dibaca",
    "OUTPUT_STOP_FAILED": "output gagal dimatikan",
}


def describe_interlocks(reasons: list[str]) -> str:
    return ", ".join(INTERLOCK_MESSAGES.get(reason, reason) for reason in reasons)


MAINTENANCE_LOCKOUT_THRESHOLD = 5
MAINTENANCE_LOCKOUT_SECONDS = 600

SESSION_SIMULATION_SCENARIOS = frozenset({
    "normal-bottle",
    "normal-can",
    "string-pull",
    "abnormal-weight",
    "abnormal-underweight",
    "chamber-timeout",
    "acceptance-without-item",
})


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def iso_from_epoch(value: float | int | None) -> str | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")
