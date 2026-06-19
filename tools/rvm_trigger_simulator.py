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


def run(client: TriggerClient, scenario: str) -> None:
    client.reset()
    if scenario == "normal-bottle":
        client.lease()
        client.sensors(chamber_open=True)
        client.pulse("item_present")
        client.sensors(weight_grams=22.4, weight_stable=True)
        client.pulse("acceptance_triggered")
        client.sensors(chamber_open=False, weight_grams=0, weight_stable=False, fill_percent=21)
    elif scenario == "normal-can":
        client.lease()
        client.sensors(chamber_open=True)
        client.pulse("item_present")
        client.sensors(weight_grams=15.1, weight_stable=True)
        client.pulse("acceptance_triggered")
        client.sensors(chamber_open=False, weight_grams=0, weight_stable=False, fill_percent=21)
    elif scenario == "string-pull":
        client.lease()
        client.sensors(chamber_open=True)
        client.pulse("item_present")
        client.sensors(weight_grams=23, weight_stable=True)
        client.pulse("acceptance_triggered")
        client.pulse("reverse_motion")
    elif scenario == "acceptance-without-item":
        client.lease()
        client.pulse("acceptance_triggered")
    elif scenario == "abnormal-weight":
        client.lease()
        client.sensors(chamber_open=True)
        client.pulse("item_present")
        client.sensors(weight_grams=900, weight_stable=True)
    elif scenario == "item-without-session":
        client.pulse("item_present")
    elif scenario == "vandalism-impact":
        client.sensors(vibration_g=4.8)
    elif scenario == "panel-forced":
        client.sensors(service_panel_open=True)
    elif scenario == "door-forced":
        client.sensors(collection_door_open=True)
    elif scenario == "camera-covered":
        client.sensors(camera_online=True, camera_occluded=True)
    elif scenario == "camera-offline":
        client.sensors(camera_online=False)
    elif scenario == "machine-full":
        client.sensors(fill_percent=98)
    elif scenario == "chamber-timeout":
        client.lease(seconds=5)
        client.sensors(chamber_open=True)
        time.sleep(6)
    else:
        raise ValueError(f"Scenario tidak dikenal: {scenario}")
    time.sleep(0.8)
    print(json.dumps(request(client.base, "/api/state"), indent=2))


def main() -> None:
    scenarios = [
        "normal-bottle", "normal-can", "string-pull",
        "acceptance-without-item", "abnormal-weight", "item-without-session",
        "vandalism-impact", "panel-forced", "door-forced",
        "camera-covered", "camera-offline", "machine-full", "chamber-timeout",
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
