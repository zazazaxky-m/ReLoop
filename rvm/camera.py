from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass(slots=True)
class CameraStatus:
    online: bool = False
    occluded: bool = False
    blurry: bool = False
    brightness: float = 0.0
    blur_score: float = 0.0
    last_frame_at: float | None = None
    evidence_path: str | None = None


class CameraWorker:
    def __init__(
        self,
        enabled: bool,
        index: int,
        evidence_dir: str,
        occlusion_brightness: float,
        blur_threshold: float,
        classifier_model: str,
        classifier_labels: list[str],
        classifier_input_size: int,
        on_alert: Callable[[str, dict], None],
    ):
        self.enabled = enabled
        self.index = index
        self.evidence_dir = Path(evidence_dir)
        self.occlusion_brightness = occlusion_brightness
        self.blur_threshold = blur_threshold
        self.classifier_model = classifier_model
        self.classifier_labels = classifier_labels
        self.classifier_input_size = classifier_input_size
        self.on_alert = on_alert
        self.status = CameraStatus()
        self.running = False
        self._thread: threading.Thread | None = None
        self._last_alert = 0.0
        self._frame_lock = threading.RLock()
        self._latest_frame = None
        self._net = None

    def start(self) -> None:
        if not self.enabled:
            return
        self.running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="rvm-camera")
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        if self._thread:
            self._thread.join(timeout=3)

    def _run(self) -> None:
        try:
            import cv2
        except ImportError:
            self.on_alert("CAMERA_DEPENDENCY_MISSING", {})
            return
        capture = cv2.VideoCapture(self.index)
        try:
            if self.classifier_model:
                try:
                    self._net = cv2.dnn.readNetFromONNX(self.classifier_model)
                except Exception as exc:
                    self.on_alert("CLASSIFIER_LOAD_FAILED", {"error": str(exc)})
            self.evidence_dir.mkdir(parents=True, exist_ok=True)
            while self.running:
                ok, frame = capture.read()
                now = time.time()
                if not ok:
                    self.status.online = False
                    if now - self._last_alert > 30:
                        self.on_alert("CAMERA_OFFLINE", {})
                        self._last_alert = now
                    time.sleep(1)
                    continue
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                with self._frame_lock:
                    self._latest_frame = frame.copy()
                brightness = float(gray.mean())
                blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                occluded = brightness < self.occlusion_brightness
                blurry = blur_score < self.blur_threshold
                self.status = CameraStatus(
                    online=True,
                    occluded=occluded,
                    blurry=blurry,
                    brightness=brightness,
                    blur_score=blur_score,
                    last_frame_at=now,
                )
                if (occluded or blurry) and now - self._last_alert > 30:
                    filename = self.evidence_dir / f"camera-{int(now)}.jpg"
                    cv2.imwrite(str(filename), frame)
                    self.status.evidence_path = str(filename)
                    self.on_alert(
                        "CAMERA_OCCLUDED" if occluded else "CAMERA_BLURRY",
                        {
                            "brightness": round(brightness, 2),
                            "blurScore": round(blur_score, 2),
                            "evidencePath": str(filename),
                        },
                    )
                    self._last_alert = now
                time.sleep(0.2)
        finally:
            capture.release()

    def classify(self) -> dict:
        if not self.enabled:
            return {"detectedType": "unknown", "confidence": 0.0, "reason": "CAMERA_DISABLED"}
        with self._frame_lock:
            frame = None if self._latest_frame is None else self._latest_frame.copy()
        if frame is None:
            return {"detectedType": "unknown", "confidence": 0.0, "reason": "NO_FRAME"}
        if self._net is None:
            return {"detectedType": "unknown", "confidence": 0.0, "reason": "NO_MODEL"}
        import cv2
        blob = cv2.dnn.blobFromImage(
            frame,
            scalefactor=1.0 / 255.0,
            size=(self.classifier_input_size, self.classifier_input_size),
            swapRB=True,
            crop=True,
        )
        self._net.setInput(blob)
        scores = self._net.forward().reshape(-1)
        index = int(scores.argmax())
        label = self.classifier_labels[index] if index < len(self.classifier_labels) else "unknown"
        return {
            "detectedType": label,
            "confidence": round(float(scores[index]), 4),
            "model": self.classifier_model,
        }
