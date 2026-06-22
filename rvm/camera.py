from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


@dataclass(slots=True)
class CameraStatus:
    online: bool = False
    occluded: bool = False
    blurry: bool = False
    brightness: float = 0.0
    blur_score: float = 0.0
    last_frame_at: float | None = None
    evidence_path: str | None = None
    face_count: int = 0
    person_detected: bool = False


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
        *,
        face_detection_enabled: bool = True,
        person_detection_enabled: bool = True,
        jpeg_quality: int = 88,
        retention_days: int = 30,
        max_local_captures: int = 1000,
        startup_grace_seconds: float = 5.0,
        anomaly_frames: int = 5,
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
        self.face_detection_enabled = face_detection_enabled
        self.person_detection_enabled = person_detection_enabled
        self.jpeg_quality = max(50, min(95, jpeg_quality))
        self.retention_days = max(1, retention_days)
        self.max_local_captures = max(50, max_local_captures)
        self.startup_grace_seconds = max(0.0, startup_grace_seconds)
        self.anomaly_frames = max(1, anomaly_frames)
        self.status = CameraStatus()
        self.running = False
        self._thread: threading.Thread | None = None
        self._last_alert = 0.0
        self._started_at = 0.0
        self._occluded_frames = 0
        self._blurry_frames = 0
        self._frame_lock = threading.RLock()
        self._latest_frame = None
        self._net = None
        self._face_detector = None
        self._person_detector = None
        self._cv2 = None

    def start(self) -> None:
        if not self.enabled:
            return
        self.running = True
        self._started_at = time.time()
        self._occluded_frames = 0
        self._blurry_frames = 0
        self._thread = threading.Thread(target=self._run, daemon=True, name="rvm-camera")
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        if self._thread:
            self._thread.join(timeout=3)

    def _load_detectors(self, cv2) -> None:
        if self.face_detection_enabled:
            cascade = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
            detector = cv2.CascadeClassifier(str(cascade))
            if not detector.empty():
                self._face_detector = detector
            else:
                self.on_alert("FACE_MODEL_LOAD_FAILED", {"model": str(cascade)})
        if self.person_detection_enabled:
            detector = cv2.HOGDescriptor()
            detector.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
            self._person_detector = detector

    def _run(self) -> None:
        try:
            import cv2
        except ImportError:
            self.on_alert("CAMERA_DEPENDENCY_MISSING", {})
            return
        self._cv2 = cv2
        self._load_detectors(cv2)
        capture = cv2.VideoCapture(self.index)
        try:
            if self.classifier_model:
                try:
                    self._net = cv2.dnn.readNetFromONNX(self.classifier_model)
                except Exception as exc:
                    self.on_alert("CLASSIFIER_LOAD_FAILED", {"error": str(exc)})
            self.evidence_dir.mkdir(parents=True, exist_ok=True)
            self.cleanup_old_captures()
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
                    face_count=self.status.face_count,
                    person_detected=self.status.person_detected,
                )
                self._occluded_frames = self._occluded_frames + 1 if occluded else 0
                self._blurry_frames = self._blurry_frames + 1 if blurry else 0
                warmed_up = now - self._started_at >= self.startup_grace_seconds
                confirmed_occlusion = self._occluded_frames >= self.anomaly_frames
                confirmed_blur = self._blurry_frames >= self.anomaly_frames
                if (
                    warmed_up
                    and (confirmed_occlusion or confirmed_blur)
                    and now - self._last_alert > 30
                ):
                    self.on_alert(
                        "CAMERA_OCCLUDED" if confirmed_occlusion else "CAMERA_BLURRY",
                        {
                            "brightness": round(brightness, 2),
                            "blurScore": round(blur_score, 2),
                            "confirmedFrames": max(
                                self._occluded_frames, self._blurry_frames
                            ),
                        },
                    )
                    self._last_alert = now
                time.sleep(0.2)
        finally:
            capture.release()

    def _detect(self, frame) -> tuple[list[tuple[int, int, int, int]], bool]:
        cv2 = self._cv2
        if cv2 is None:
            return [], False
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces: list[tuple[int, int, int, int]] = []
        if self._face_detector is not None:
            found = self._face_detector.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(48, 48),
            )
            faces = [tuple(int(v) for v in rect) for rect in found]
        person_detected = bool(faces)
        if self._person_detector is not None:
            height, width = frame.shape[:2]
            scale = min(1.0, 640.0 / max(width, height))
            sample = cv2.resize(frame, None, fx=scale, fy=scale) if scale < 1 else frame
            people, _weights = self._person_detector.detectMultiScale(
                sample,
                winStride=(8, 8),
                padding=(8, 8),
                scale=1.05,
            )
            person_detected = person_detected or len(people) > 0
        return faces, person_detected

    def capture_evidence(
        self,
        kind: str,
        reason: str,
        session_id: str | None = None,
    ) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        with self._frame_lock:
            frame = None if self._latest_frame is None else self._latest_frame.copy()
        if frame is None or self._cv2 is None:
            return None

        cv2 = self._cv2
        faces, person_detected = self._detect(frame)
        now = datetime.now(timezone.utc)
        capture_id = str(uuid.uuid4())
        folder = self.evidence_dir / now.strftime("%Y-%m-%d")
        folder.mkdir(parents=True, exist_ok=True)
        full_path = folder / f"{capture_id}-scene.jpg"
        params = [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality]
        if not cv2.imwrite(str(full_path), frame, params):
            return None

        height, width = frame.shape[:2]
        face_paths: list[str] = []
        for index, (x, y, w, h) in enumerate(faces[:5]):
            margin_x = int(w * 0.28)
            margin_y = int(h * 0.35)
            x1, y1 = max(0, x - margin_x), max(0, y - margin_y)
            x2, y2 = min(width, x + w + margin_x), min(height, y + h + margin_y)
            crop = frame[y1:y2, x1:x2]
            if crop.size == 0:
                continue
            face_path = folder / f"{capture_id}-face-{index + 1}.jpg"
            if cv2.imwrite(str(face_path), crop, params):
                face_paths.append(str(face_path))

        self.status.face_count = len(face_paths)
        self.status.person_detected = person_detected
        self.status.evidence_path = str(full_path)
        self.cleanup_old_captures()
        return {
            "id": capture_id,
            "kind": kind,
            "reason": reason,
            "sessionId": session_id,
            "occurredAt": now.isoformat().replace("+00:00", "Z"),
            "imagePath": str(full_path),
            "facePaths": face_paths,
            "faceCount": len(face_paths),
            "personDetected": person_detected,
            "width": width,
            "height": height,
        }

    def cleanup_old_captures(self) -> None:
        if not self.evidence_dir.exists():
            return
        files = sorted(
            self.evidence_dir.rglob("*.jpg"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        cutoff = time.time() - self.retention_days * 86400
        for index, path in enumerate(files):
            try:
                if index >= self.max_local_captures or path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
            except OSError:
                continue

    def classify(self) -> dict:
        if not self.enabled:
            return {"detectedType": "unknown", "confidence": 0.0, "reason": "CAMERA_DISABLED"}
        with self._frame_lock:
            frame = None if self._latest_frame is None else self._latest_frame.copy()
        if frame is None:
            return {"detectedType": "unknown", "confidence": 0.0, "reason": "NO_FRAME"}
        if self._net is None:
            return {"detectedType": "unknown", "confidence": 0.0, "reason": "NO_MODEL"}
        cv2 = self._cv2
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
