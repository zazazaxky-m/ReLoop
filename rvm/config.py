from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any
from dataclasses import field


@dataclass(slots=True)
class RvmConfig:
    machine_code: str = "RLP-001"
    machine_name: str = "ReLoop RVM"
    server_url: str = "http://localhost:3000"
    machine_secret: str = ""
    database_path: str = "data/rvm.db"
    host: str = "127.0.0.1"
    port: int = 8765
    hardware_driver: str = "mock"
    gpio_pins: dict[str, int] = field(default_factory=dict)
    load_cell_enabled: bool = False
    hx711_data_pin: int = 17
    hx711_clock_pin: int = 27
    hx711_reference_unit: float = 1.0
    vibration_sensor_enabled: bool = False
    mpu6050_address: int = 0x68
    heartbeat_seconds: int = 60
    sync_interval_seconds: int = 5
    batch_size: int = 20
    session_lease_seconds: int = 300
    chamber_timeout_seconds: int = 20
    max_fill_percent: int = 95
    min_item_weight_grams: float = 5.0
    max_item_weight_grams: float = 500.0
    camera_enabled: bool = False
    camera_index: int = 0
    camera_evidence_dir: str = "data/evidence"
    camera_classifier_model: str = ""
    camera_classifier_labels: list[str] = field(
        default_factory=lambda: ["bottle_pet", "can_aluminium", "unknown"]
    )
    camera_classifier_input_size: int = 224
    camera_occlusion_brightness: float = 18.0
    camera_blur_threshold: float = 25.0
    vibration_threshold_g: float = 2.5
    maintenance_pin_hash: str = ""
    maintenance_token_ttl_seconds: int = 600

    @classmethod
    def load(cls, path: str | Path) -> "RvmConfig":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        allowed = {item.name for item in fields(cls)}
        config = cls(**{key: value for key, value in raw.items() if key in allowed})
        config.validate()
        return config

    def validate(self) -> None:
        if not self.machine_code.strip():
            raise ValueError("machine_code wajib")
        if not self.machine_secret or self.machine_secret == "CHANGE_ME":
            raise ValueError("machine_secret wajib diubah")
        if self.host not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Local API harus bind ke loopback")
        if not 1 <= self.batch_size <= 50:
            raise ValueError("batch_size harus 1..50")
        if not 1 <= self.max_fill_percent <= 100:
            raise ValueError("max_fill_percent harus 1..100")
        if not 0 < self.min_item_weight_grams < self.max_item_weight_grams:
            raise ValueError("Batas berat item tidak valid")
        if self.hardware_driver not in {"mock", "gpio"}:
            raise ValueError("hardware_driver harus mock atau gpio")
        if self.camera_classifier_input_size <= 0:
            raise ValueError("camera_classifier_input_size harus lebih dari 0")
        if not self.camera_classifier_labels:
            raise ValueError("camera_classifier_labels tidak boleh kosong")

    @staticmethod
    def hash_pin(pin: str) -> str:
        return hashlib.sha256(pin.encode("utf-8")).hexdigest()

    def verify_pin(self, pin: str) -> bool:
        if not self.maintenance_pin_hash:
            return False
        return hashlib.sha256(pin.encode("utf-8")).hexdigest() == self.maintenance_pin_hash

    def public_dict(self) -> dict[str, Any]:
        return {
            "machineCode": self.machine_code,
            "machineName": self.machine_name,
            "heartbeatSeconds": self.heartbeat_seconds,
            "maxFillPercent": self.max_fill_percent,
            "cameraEnabled": self.camera_enabled,
        }
