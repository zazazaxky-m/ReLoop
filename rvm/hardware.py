from __future__ import annotations

import threading
import math
from dataclasses import asdict, dataclass
from typing import Protocol


@dataclass(slots=True)
class SensorSnapshot:
    chamber_open: bool = False
    item_present: bool = False
    acceptance_triggered: bool = False
    reverse_motion: bool = False
    weight_grams: float = 0.0
    weight_stable: bool = False
    fill_percent: int = 0
    service_panel_open: bool = False
    collection_door_open: bool = False
    vibration_g: float = 0.0
    camera_online: bool = False
    camera_occluded: bool = False
    camera_blurry: bool = False
    temperature_c: float = 28.0

    def to_dict(self) -> dict:
        return asdict(self)


class HardwareAdapter(Protocol):
    def read(self) -> SensorSnapshot: ...
    def set_input_gate(self, open_: bool) -> None: ...
    def set_conveyor(self, direction: str) -> None: ...
    def set_compactor(self, active: bool) -> None: ...
    def all_stop(self) -> None: ...
    def close(self) -> None: ...


class MockHardware:
    """Thread-safe adapter used by the trigger simulator and CI."""

    def __init__(self):
        self._lock = threading.RLock()
        self.snapshot = SensorSnapshot(camera_online=True)
        self.input_gate_open = False
        self.conveyor = "STOPPED"
        self.compactor = False

    def read(self) -> SensorSnapshot:
        with self._lock:
            return SensorSnapshot(**self.snapshot.to_dict())

    def patch(self, **values) -> None:
        with self._lock:
            for key, value in values.items():
                if not hasattr(self.snapshot, key):
                    raise ValueError(f"Unknown sensor: {key}")
                setattr(self.snapshot, key, value)

    def set_input_gate(self, open_: bool) -> None:
        self.input_gate_open = open_

    def set_conveyor(self, direction: str) -> None:
        self.conveyor = direction

    def set_compactor(self, active: bool) -> None:
        self.compactor = active

    def all_stop(self) -> None:
        self.input_gate_open = False
        self.conveyor = "STOPPED"
        self.compactor = False

    def close(self) -> None:
        self.all_stop()


class GpioHardware:
    """
    Raspberry Pi GPIO skeleton with fail-safe defaults.

    Pin mapping is intentionally supplied by deployment config. Import is lazy,
    so development machines do not require gpiozero.
    """

    def __init__(self, config):
        try:
            from gpiozero import Button, DigitalOutputDevice, DistanceSensor
        except ImportError as exc:
            raise RuntimeError("Install gpiozero untuk hardware_driver=gpio") from exc
        pins = config.gpio_pins
        required = {
            "chamber", "item_beam", "acceptance_beam", "service_panel",
            "collection_door", "input_gate", "conveyor_forward",
            "conveyor_reverse", "compactor",
        }
        missing = sorted(required - pins.keys())
        if missing:
            raise RuntimeError(f"GPIO pin belum dikonfigurasi: {', '.join(missing)}")
        self._Button = Button
        self.chamber = Button(pins["chamber"], pull_up=True)
        self.item = Button(pins["item_beam"], pull_up=True)
        self.acceptance = Button(pins["acceptance_beam"], pull_up=True)
        self.panel = Button(pins["service_panel"], pull_up=True)
        self.door = Button(pins["collection_door"], pull_up=True)
        self.reverse = (
            Button(pins["direction_reverse"], pull_up=True)
            if "direction_reverse" in pins
            else None
        )
        self.gate = DigitalOutputDevice(pins["input_gate"], active_high=True, initial_value=False)
        self.conveyor_fwd = DigitalOutputDevice(pins["conveyor_forward"], initial_value=False)
        self.conveyor_rev = DigitalOutputDevice(pins["conveyor_reverse"], initial_value=False)
        self.compactor = DigitalOutputDevice(pins["compactor"], initial_value=False)
        self.distance = (
            DistanceSensor(
                echo=pins["ultrasonic_echo"],
                trigger=pins["ultrasonic_trigger"],
                max_distance=1.0,
            )
            if {"ultrasonic_echo", "ultrasonic_trigger"}.issubset(pins)
            else None
        )
        self.hx711 = None
        if config.load_cell_enabled:
            try:
                from hx711 import HX711
            except ImportError as exc:
                raise RuntimeError("Install HX711 Python driver untuk load cell") from exc
            self.hx711 = HX711(config.hx711_data_pin, config.hx711_clock_pin)
            self.hx711.set_reference_unit(config.hx711_reference_unit)
            self.hx711.reset()
            self.hx711.tare()
        self.mpu = None
        if config.vibration_sensor_enabled:
            try:
                from mpu6050 import mpu6050
            except ImportError as exc:
                raise RuntimeError("Install mpu6050-raspberrypi untuk vibration sensor") from exc
            self.mpu = mpu6050(config.mpu6050_address)
        self._snapshot = SensorSnapshot()

    def read(self) -> SensorSnapshot:
        self._snapshot.chamber_open = self.chamber.is_pressed
        self._snapshot.item_present = self.item.is_pressed
        self._snapshot.acceptance_triggered = self.acceptance.is_pressed
        self._snapshot.service_panel_open = self.panel.is_pressed
        self._snapshot.collection_door_open = self.door.is_pressed
        self._snapshot.reverse_motion = bool(self.reverse and self.reverse.is_pressed)
        if self.distance:
            # DistanceSensor returns 0..1 of max_distance. Full bin means short distance.
            self._snapshot.fill_percent = max(0, min(100, round((1 - self.distance.distance) * 100)))
        if self.hx711:
            values = self.hx711.get_weight(5)
            self._snapshot.weight_grams = max(0.0, float(values))
            self._snapshot.weight_stable = True
            self.hx711.power_down()
            self.hx711.power_up()
        if self.mpu:
            accel = self.mpu.get_accel_data(g=True)
            magnitude = math.sqrt(accel["x"] ** 2 + accel["y"] ** 2 + accel["z"] ** 2)
            self._snapshot.vibration_g = abs(magnitude - 1.0)
        return SensorSnapshot(**self._snapshot.to_dict())

    def set_input_gate(self, open_: bool) -> None:
        self.gate.value = bool(open_)

    def set_conveyor(self, direction: str) -> None:
        self.conveyor_fwd.off()
        self.conveyor_rev.off()
        if direction == "FORWARD":
            self.conveyor_fwd.on()
        elif direction == "REVERSE":
            self.conveyor_rev.on()

    def set_compactor(self, active: bool) -> None:
        self.compactor.value = bool(active)

    def all_stop(self) -> None:
        self.set_input_gate(False)
        self.set_conveyor("STOPPED")
        self.set_compactor(False)

    def close(self) -> None:
        self.all_stop()
