"""Fraud / vandalism alerting and camera-evidence capture for the RVM
controller. Split out of controller.py as a mixin; every method operates on
the live `RvmController` instance (`self`) and relies on attributes set in
`RvmController.__init__` (hardware, db, config, camera, _active_alert)."""

from __future__ import annotations

import threading
from typing import Any

from .states import iso_now


class RvmFraudMixin:
    def report_fraud(self, reason: str, payload: dict[str, Any]) -> None:
        self.hardware.all_stop()
        self._set_alert("FRAUD", reason, "WARNING", payload)
        if self.config.camera_capture_security_events:
            self._capture_camera_evidence("FRAUD", reason, self.session_id())
        self.emit("FRAUD_DETECTED", {"reason": reason, **payload}, self.session_id())

    def _set_alert(
        self,
        category: str,
        reason: str,
        severity: str,
        payload: dict[str, Any],
    ) -> None:
        alert = {
            "category": category,
            "reason": reason,
            "severity": severity,
            "payload": payload,
            "occurredAt": iso_now(),
        }
        self._active_alert = alert
        self.db.set_json("active_alert", alert)

    def _clear_alert(self) -> None:
        self._active_alert = None
        self.db.set_json("active_alert", None)

    def _capture_camera_evidence(
        self,
        kind: str,
        reason: str,
        session_id: str | None,
    ) -> None:
        if not self.config.camera_enabled:
            return

        def capture() -> None:
            evidence = self.camera.capture_evidence(kind, reason, session_id)
            if not evidence:
                self.db.audit(
                    "CAMERA_CAPTURE_SKIPPED",
                    {"kind": kind, "reason": reason, "sessionId": session_id},
                )
                return
            self.db.enqueue_capture(evidence)
            self.db.audit(
                "CAMERA_CAPTURE_QUEUED",
                {
                    "id": evidence["id"],
                    "kind": kind,
                    "reason": reason,
                    "sessionId": session_id,
                    "faceCount": evidence["faceCount"],
                    "personDetected": evidence["personDetected"],
                },
            )

        threading.Thread(
            target=capture,
            daemon=True,
            name=f"rvm-capture-{kind.lower()}",
        ).start()

    def _camera_alert(self, reason: str, payload: dict[str, Any]) -> None:
        if reason in {"CAMERA_OCCLUDED", "CAMERA_OFFLINE"}:
            self.enter_safe_state(reason, payload)
        else:
            self.emit("ERROR", {"reason": reason, **payload})
