#!/usr/bin/env python3
"""Comprehensive local sensor trigger simulator for ReLoop RVM."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
import uuid


def request(base: str, path: str, data: dict | None = None, token: str = "") -> dict:
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=body,
        method="GET" if body is None else "POST",
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.loads(res.read() or b"{}")


class TriggerClient:
    def __init__(self, base: str, pin: str, secret: str):
        self.base = base
        self.secret = secret
        self.token = request(base, "/api/maintenance/login", {"pin": pin})["token"]

    def sensors(self, **values) -> dict:
        return request(
            self.base,
            "/api/maintenance/command",
            {"command": "mock-sensors", "values": values},
            self.token,
        )

    def reset(self) -> None:
        request(self.base, "/api/maintenance/command", {"command": "reset-safe-state"}, self.token)
        self.sensors(
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
        )

    def lease(self, seconds: int = 180) -> str:
        now = time.time()
        lease = {
            "id": str(uuid.uuid4()),
            "sessionId": f"sim-{uuid.uuid4()}",
            "userRef": "local-simulator",
            "issuedAt": now,
            "expiresAt": now + seconds,
        }
        canonical = ".".join(str(lease[key]) for key in ("id", "sessionId", "issuedAt", "expiresAt"))
        lease["signature"] = hmac.new(
            self.secret.encode(), canonical.encode(), hashlib.sha256
        ).hexdigest()
        result = request(self.base, "/api/session/lease", lease)
        if not result.get("ok"):
            raise RuntimeError("Lease ditolak")
        return lease["sessionId"]

    def pulse(self, name: str, duration: float = 0.25) -> None:
        self.sensors(**{name: True})
        time.sleep(duration)
        self.sensors(**{name: False})

    def simulate(self, scenario: str) -> dict:
        return request(
            self.base,
            "/api/maintenance/command",
            {"command": "simulate", "scenario": scenario},
            self.token,
        )


def run(client: TriggerClient, scenario: str) -> None:
    client.reset()
    session_scenarios = {
        "normal-bottle",
        "normal-can",
        "string-pull",
        "acceptance-without-item",
        "abnormal-weight",
        "abnormal-underweight",
        "chamber-timeout",
    }
    if scenario in session_scenarios:
        client.lease()
    client.simulate(scenario)

    deadline = time.time() + 8
    state = request(client.base, "/api/state")
    while state.get("simulation", {}).get("running") and time.time() < deadline:
        time.sleep(0.2)
        state = request(client.base, "/api/state")
    print(json.dumps(state, indent=2))

def main() -> None:
    scenarios = [
        "normal-bottle", "normal-can", "string-pull",
        "acceptance-without-item", "abnormal-weight", "abnormal-underweight",
        "item-without-session", "chamber-timeout", "vandalism-impact",
        "panel-forced", "door-forced", "camera-covered", "camera-offline",
        "camera-blurry", "overheat", "machine-full",
    ]
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8765")
    parser.add_argument("--pin", required=True)
    parser.add_argument("--secret", required=True)
    parser.add_argument("--scenario", choices=scenarios, required=True)
    args = parser.parse_args()
    try:
        run(TriggerClient(args.base, args.pin, args.secret), args.scenario)
    except urllib.error.URLError as exc:
        raise SystemExit(f"RVM local API tidak dapat dijangkau: {exc}") from exc


if __name__ == "__main__":
    main()
