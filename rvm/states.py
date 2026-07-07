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
