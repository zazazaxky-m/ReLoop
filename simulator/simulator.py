#!/usr/bin/env python3
"""
ReLoop Machine Simulator — sends heartbeat, QR refresh, chamber events,
weight/AI/barcode, sensor sequence, acceptance point, fraud, compactor,
and dummy botol/kaleng deposits to the backend machine-events API.

Usage:
  python simulator.py --machine RLP-001
  python simulator.py --machine RLP-001 --deposit botol
  python simulator.py --machine RLP-001 --interactive
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from typing import Any

try:
    import requests
except ImportError:
    print("Install dependencies: pip install -r requirements.txt")
    sys.exit(1)

DEFAULT_BASE = os.environ.get("RELOOP_BASE_URL", "http://localhost:3000")
# Per-machine ingest secret (provisioned by superadmin). Pass via --secret or env.
DEFAULT_SECRET = os.environ.get("MACHINE_INGEST_SECRET", "")

WASTE_TYPES = {
    "botol": {"name": "Botol Plastik (PET)", "weight": 22, "ai": "bottle_pet"},
    "kaleng": {"name": "Kaleng Aluminium", "weight": 15, "ai": "can_aluminium"},
}


def new_event_id() -> str:
    return str(uuid.uuid4())


def post_event(
    base_url: str,
    secret: str,
    machine_code: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
    session_id: str | None = None,
    deposit_item_id: str | None = None,
    local_event_id: str | None = None,
    retry_same_id: bool = False,
) -> dict[str, Any]:
    eid = local_event_id or new_event_id()
    body = {
        "machineCode": machine_code,
        "localEventId": eid,
        "eventType": event_type,
        "payload": payload or {},
        "sessionId": session_id,
        "depositItemId": deposit_item_id,
        "occurredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    url = f"{base_url.rstrip('/')}/api/machine-events"

    def signed_headers(raw: str) -> dict[str, str]:
        ts = str(int(time.time()))
        nonce = uuid.uuid4().hex
        sig = hmac.new(
            secret.encode("utf-8"),
            f"{ts}.{nonce}.{raw}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return {
            "Content-Type": "application/json",
            "x-reloop-machine": machine_code,
            "x-reloop-timestamp": ts,
            "x-reloop-nonce": nonce,
            "x-reloop-signature": sig,
        }

    # Sign the EXACT bytes we send (no re-serialization by requests).
    raw_body = json.dumps(body, separators=(",", ":"))
    r = requests.post(url, data=raw_body, headers=signed_headers(raw_body), timeout=30)
    data = r.json() if r.content else {}
    print(f"  [{event_type}] HTTP {r.status_code} duplicate={data.get('duplicate')}")
    if r.status_code == 401:
        print(f"    -> auth gagal: {data.get('error')}")
    if retry_same_id:
        # New timestamp/nonce/signature, same body+localEventId → must be idempotent.
        r2 = requests.post(url, data=raw_body, headers=signed_headers(raw_body), timeout=30)
        data2 = r2.json() if r2.content else {}
        print(f"  [RETRY {event_type}] HTTP {r2.status_code} duplicate={data2.get('duplicate')}")
    return {"response": data, "localEventId": eid, "depositItemId": deposit_item_id}


def get_display(base_url: str, machine_code: str) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/api/display/{machine_code}"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return r.json()


def run_heartbeat(base: str, secret: str, code: str, status: str = "ONLINE", fill: int = 35):
    post_event(base, secret, code, "HEARTBEAT", {"status": status, "fillLevelPercent": fill})


def run_full_deposit(
    base: str,
    secret: str,
    code: str,
    session_id: str,
    kind: str = "botol",
    fraud: bool = False,
    bad_weight: bool = False,
    demonstrate_idempotency: bool = True,
) -> None:
    wt = WASTE_TYPES.get(kind, WASTE_TYPES["botol"])
    print(f"\n--- Deposit {kind} (session={session_id}) ---")

    post_event(base, secret, code, "CHAMBER_OPENED", {}, session_id=session_id)

    detected = post_event(
        base,
        secret,
        code,
        "ITEM_DETECTED",
        {"wasteTypeKey": kind, "quantity": 1},
        session_id=session_id,
    )
    item_id = detected["response"].get("depositItemId")

    weight = 500 if bad_weight else wt["weight"]
    post_event(
        base,
        secret,
        code,
        "WEIGHT_MEASURED",
        {"weightGrams": weight},
        session_id=session_id,
        deposit_item_id=item_id,
    )

    post_event(
        base,
        secret,
        code,
        "IMAGE_CLASSIFIED",
        {"detectedType": wt["ai"], "confidence": 0.92},
        session_id=session_id,
        deposit_item_id=item_id,
    )

    post_event(
        base,
        secret,
        code,
        "BARCODE_READ",
        {"barcode": "8901234567890"},
        session_id=session_id,
        deposit_item_id=item_id,
    )

    seq_payload: dict[str, Any] = {
        "steps": [
            "CHAMBER_OPEN",
            "ITEM_PRESENT",
            "WEIGHT_STABLE",
            "IMAGE_CAPTURED",
            "CONVEYOR_FORWARD",
            "ACCEPTANCE_POINT",
        ],
    }
    if fraud:
        seq_payload["retrievalAttempt"] = True
        seq_payload["reverseMotion"] = True

    post_event(
        base,
        secret,
        code,
        "SENSOR_SEQUENCE",
        seq_payload,
        session_id=session_id,
        deposit_item_id=item_id,
    )

    if fraud:
        post_event(
            base,
            secret,
            code,
            "FRAUD_DETECTED",
            {"reason": "string_pull"},
            session_id=session_id,
            deposit_item_id=item_id,
        )
        return

    accept_eid = new_event_id()
    post_event(
        base,
        secret,
        code,
        "ITEM_ACCEPTED_POINT",
        {},
        session_id=session_id,
        deposit_item_id=item_id,
        local_event_id=accept_eid,
        retry_same_id=demonstrate_idempotency,
    )

    post_event(base, secret, code, "CONVEYOR_STARTED", {}, session_id=session_id)
    post_event(
        base, secret, code, "COMPACTION_STARTED", {},
        session_id=session_id, deposit_item_id=item_id,
    )
    post_event(
        base, secret, code, "COMPACTION_COMPLETED", {},
        session_id=session_id, deposit_item_id=item_id,
    )
    print(f"  Deposit item: {item_id}")


def interactive_menu(base: str, secret: str, code: str) -> None:
    session_id = input("Session ID (from /scan after login): ").strip()
    while True:
        print("\n=== ReLoop Simulator ===")
        print("1. Heartbeat ONLINE")
        print("2. Status FULL")
        print("3. Deposit botol")
        print("4. Deposit kaleng")
        print("5. Fraud (string-pull)")
        print("6. Safe state")
        print("7. QR display info")
        print("0. Keluar")
        choice = input("Pilih: ").strip()
        if choice == "0":
            break
        elif choice == "1":
            run_heartbeat(base, secret, code)
        elif choice == "2":
            post_event(base, secret, code, "STATUS_CHANGED", {"status": "FULL"})
            post_event(base, secret, code, "FILL_LEVEL_UPDATED", {"fillLevelPercent": 96})
        elif choice == "3":
            item_id = input("Deposit item ID (kosongkan jika belum ada): ").strip() or None
            if item_id:
                os.environ["DEPOSIT_ITEM_ID"] = item_id
            run_full_deposit(base, secret, code, session_id, "botol")
        elif choice == "4":
            item_id = input("Deposit item ID: ").strip() or None
            if item_id:
                os.environ["DEPOSIT_ITEM_ID"] = item_id
            run_full_deposit(base, secret, code, session_id, "kaleng")
        elif choice == "5":
            run_full_deposit(base, secret, code, session_id, "botol", fraud=True)
        elif choice == "6":
            post_event(base, secret, code, "SAFE_STATE_ENTERED", {"reason": "panel_open"}, session_id=session_id)
        elif choice == "7":
            try:
                d = get_display(base, code)
                print(json.dumps(d, indent=2))
            except Exception as e:
                print(f"Error: {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="ReLoop machine simulator")
    parser.add_argument("--machine", "-m", required=True, help="Machine code e.g. RLP-001")
    parser.add_argument("--base-url", default=DEFAULT_BASE)
    parser.add_argument("--secret", default=DEFAULT_SECRET)
    parser.add_argument("--session", help="Deposit session ID")
    parser.add_argument("--item-id", help="Deposit item ID for acceptance event")
    parser.add_argument("--deposit", choices=["botol", "kaleng"], help="Run one dummy deposit")
    parser.add_argument("--heartbeat", action="store_true")
    parser.add_argument("--fraud", action="store_true")
    parser.add_argument("--interactive", "-i", action="store_true")
    args = parser.parse_args()

    if not args.secret:
        print(
            "ERROR: ingest secret wajib. Ambil dari dashboard superadmin "
            "(Detail Mesin → Keamanan Mesin) lalu jalankan:\n"
            f"  python simulator.py -m {args.machine} --secret <SECRET> ...\n"
            "atau set environment variable MACHINE_INGEST_SECRET."
        )
        sys.exit(1)

    if args.item_id:
        os.environ["DEPOSIT_ITEM_ID"] = args.item_id

    print(f"Target: {args.base_url} machine={args.machine}")

    if args.heartbeat:
        run_heartbeat(args.base_url, args.secret, args.machine)
        return

    if args.interactive:
        interactive_menu(args.base_url, args.secret, args.machine)
        return

    if args.deposit:
        if not args.session:
            print("--session required for deposit flow")
            sys.exit(1)
        run_full_deposit(
            args.base_url,
            args.secret,
            args.machine,
            args.session,
            args.deposit,
            fraud=args.fraud,
        )
        return

    # Default demo: heartbeat + display
    run_heartbeat(args.base_url, args.secret, args.machine)
    try:
        d = get_display(args.base_url, args.machine)
        print(f"QR token expires: {d.get('expiresAt')}")
        print(f"Scan URL: {d.get('scanUrl')}")
    except Exception as e:
        print(f"Display fetch failed: {e}")

    print("\nTip: login as user@reloop.id, scan QR, then run:")
    print(f"  python simulator.py -m {args.machine} --session <SESSION_ID> --deposit botol")


if __name__ == "__main__":
    main()
