"""
C Bridge for Smart Parking Allocation System
Loads the native C shared library (parking_engine.dll) via ctypes,
with exact C struct layouts, function prototypes, and an embedded pure-C logic fallback
if the DLL binary is being compiled.
"""

import os
import sys
import ctypes
from ctypes import (
    c_int, c_double, c_char, c_char_p, c_longlong,
    Structure, POINTER, byref
)
import time
from typing import Dict, Any, List, Optional

MAX_SLOTS = 64
MAX_LOG_ENTRIES = 256
LABEL_LEN = 16

class ParkingSlot(Structure):
    _fields_ = [
        ("id", c_int),
        ("label", c_char * LABEL_LEN),
        ("is_occupied", c_int),
        ("occupied_since", c_longlong),  # time_t on 64-bit Windows
        ("current_duration", c_double),
        ("accumulated_duration", c_double),
        ("occupancy_count", c_int),
        ("accrued_fee", c_double),
        ("x", c_int),
        ("y", c_int),
        ("width", c_int),
        ("height", c_int),
    ]

class ParkingEventLog(Structure):
    _fields_ = [
        ("timestamp", c_char * 32),
        ("slot_id", c_int),
        ("slot_label", c_char * LABEL_LEN),
        ("event_type", c_char * 16),
        ("duration_sec", c_double),
        ("fee", c_double),
    ]

class CParkingEngine:
    def __init__(self, dll_path: Optional[str] = None):
        self.dll = None
        self.using_native_c = False
        
        # Determine DLL location
        if dll_path is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            dll_path = os.path.join(base_dir, "c_engine", "parking_engine.dll")
        
        self.dll_path = dll_path
        self._try_load_dll()
        
        # Pure C-logic fallback state if DLL is pending compilation
        self._fallback_slots: List[Dict[str, Any]] = []
        self._fallback_logs: List[Dict[str, Any]] = []
        self._hourly_rate = 5.0
        self._total_revenue = 0.0

    def _try_load_dll(self) -> bool:
        if os.path.exists(self.dll_path):
            try:
                self.dll = ctypes.CDLL(self.dll_path)
                self._setup_c_signatures()
                self.using_native_c = True
                print(f"[C_BRIDGE] Successfully loaded native C engine DLL: {self.dll_path}")
                return True
            except Exception as e:
                print(f"[C_BRIDGE] Failed to load DLL ({self.dll_path}): {e}")
                self.dll = None
                self.using_native_c = False
        else:
            print(f"[C_BRIDGE] C DLL not found at {self.dll_path}. Running with mirrored C logic engine.")
            self.using_native_c = False
        return False

    def _setup_c_signatures(self):
        if not self.dll:
            return
        
        self.dll.engine_init.argtypes = [c_int, c_double]
        self.dll.engine_init.restype = c_int

        self.dll.engine_configure_slot.argtypes = [c_int, c_char_p, c_int, c_int, c_int, c_int]
        self.dll.engine_configure_slot.restype = c_int

        self.dll.engine_update_slot_state.argtypes = [c_int, c_int]
        self.dll.engine_update_slot_state.restype = c_int

        self.dll.engine_get_slot.argtypes = [c_int, POINTER(ParkingSlot)]
        self.dll.engine_get_slot.restype = c_int

        self.dll.engine_get_total_slots.argtypes = []
        self.dll.engine_get_total_slots.restype = c_int

        self.dll.engine_get_occupied_count.argtypes = []
        self.dll.engine_get_occupied_count.restype = c_int

        self.dll.engine_get_available_count.argtypes = []
        self.dll.engine_get_available_count.restype = c_int

        self.dll.engine_get_occupancy_rate.argtypes = []
        self.dll.engine_get_occupancy_rate.restype = c_double

        self.dll.engine_get_total_revenue.argtypes = []
        self.dll.engine_get_total_revenue.restype = c_double

        self.dll.engine_find_nearest_available_slot.argtypes = []
        self.dll.engine_find_nearest_available_slot.restype = c_int

        self.dll.engine_set_hourly_rate.argtypes = [c_double]
        self.dll.engine_set_hourly_rate.restype = c_int

        self.dll.engine_get_hourly_rate.argtypes = []
        self.dll.engine_get_hourly_rate.restype = c_double

        self.dll.engine_save_state.argtypes = [c_char_p]
        self.dll.engine_save_state.restype = c_int

        self.dll.engine_load_state.argtypes = [c_char_p]
        self.dll.engine_load_state.restype = c_int

        self.dll.engine_get_log_count.argtypes = []
        self.dll.engine_get_log_count.restype = c_int

        self.dll.engine_get_log.argtypes = [c_int, POINTER(ParkingEventLog)]
        self.dll.engine_get_log.restype = c_int

    def init_engine(self, total_slots: int = 6, hourly_rate: float = 5.0) -> bool:
        if self.using_native_c and self.dll:
            res = self.dll.engine_init(c_int(total_slots), c_double(hourly_rate))
            return bool(res)
        
        # Mirror C engine_init
        self._hourly_rate = hourly_rate
        self._total_revenue = 0.0
        self._fallback_slots = []
        self._fallback_logs = []
        
        for i in range(total_slots):
            self._fallback_slots.append({
                "id": i,
                "label": f"P{i+1}",
                "is_occupied": 0,
                "occupied_since": 0,
                "current_duration": 0.0,
                "accumulated_duration": 0.0,
                "occupancy_count": 0,
                "accrued_fee": 0.0,
                "x": 60 + (i % 3) * 160,
                "y": 60 + (i // 3) * 200,
                "width": 130,
                "height": 170
            })
        self._add_fallback_log(-1, "SYSTEM", "INITIALIZED", 0.0, 0.0)
        return True

    def configure_slot(self, slot_id: int, label: str, x: int, y: int, w: int, h: int) -> bool:
        if self.using_native_c and self.dll:
            return bool(self.dll.engine_configure_slot(
                c_int(slot_id),
                label.encode('utf-8'),
                c_int(x), c_int(y), c_int(w), c_int(h)
            ))
        
        while len(self._fallback_slots) <= slot_id:
            idx = len(self._fallback_slots)
            self._fallback_slots.append({
                "id": idx, "label": f"P{idx+1}", "is_occupied": 0, "occupied_since": 0,
                "current_duration": 0.0, "accumulated_duration": 0.0, "occupancy_count": 0,
                "accrued_fee": 0.0, "x": x, "y": y, "width": w, "height": h
            })
        
        s = self._fallback_slots[slot_id]
        s["label"] = label
        s["x"] = x
        s["y"] = y
        s["width"] = w
        s["height"] = h
        return True

    def update_slot_state(self, slot_id: int, is_occupied: int) -> bool:
        if self.using_native_c and self.dll:
            return bool(self.dll.engine_update_slot_state(c_int(slot_id), c_int(is_occupied)))
        
        if slot_id < 0 or slot_id >= len(self._fallback_slots):
            return False
        
        s = self._fallback_slots[slot_id]
        prev_occupied = s["is_occupied"]
        now = time.time()
        
        if not prev_occupied and is_occupied:
            s["is_occupied"] = 1
            s["occupied_since"] = now
            s["current_duration"] = 0.0
            s["accrued_fee"] = 0.0
            s["occupancy_count"] += 1
            self._add_fallback_log(s["id"], s["label"], "PARKED", 0.0, 0.0)
        elif prev_occupied and not is_occupied:
            duration = max(0.0, now - s["occupied_since"]) if s["occupied_since"] > 0 else 0.0
            fee = (duration / 3600.0) * self._hourly_rate
            if duration > 5.0 and fee < 0.10:
                fee = 0.10
            s["is_occupied"] = 0
            s["accumulated_duration"] += duration
            s["current_duration"] = 0.0
            s["accrued_fee"] = 0.0
            s["occupied_since"] = 0
            self._total_revenue += fee
            self._add_fallback_log(s["id"], s["label"], "UNPARKED", duration, fee)
        elif prev_occupied and is_occupied:
            if s["occupied_since"] > 0:
                s["current_duration"] = now - s["occupied_since"]
                s["accrued_fee"] = (s["current_duration"] / 3600.0) * self._hourly_rate
        return True

    def get_slot(self, slot_id: int) -> Optional[Dict[str, Any]]:
        if self.using_native_c and self.dll:
            c_slot = ParkingSlot()
            if self.dll.engine_get_slot(c_int(slot_id), byref(c_slot)):
                return {
                    "id": c_slot.id,
                    "label": c_slot.label.decode('utf-8', errors='ignore'),
                    "is_occupied": bool(c_slot.is_occupied),
                    "occupied_since": c_slot.occupied_since,
                    "current_duration": round(c_slot.current_duration, 1),
                    "accumulated_duration": round(c_slot.accumulated_duration, 1),
                    "occupancy_count": c_slot.occupancy_count,
                    "accrued_fee": round(c_slot.accrued_fee, 2),
                    "x": c_slot.x,
                    "y": c_slot.y,
                    "width": c_slot.width,
                    "height": c_slot.height,
                }
            return None
        
        if 0 <= slot_id < len(self._fallback_slots):
            s = dict(self._fallback_slots[slot_id])
            if s["is_occupied"] and s["occupied_since"] > 0:
                s["current_duration"] = round(time.time() - s["occupied_since"], 1)
                s["accrued_fee"] = round((s["current_duration"] / 3600.0) * self._hourly_rate, 2)
            return s
        return None

    def get_all_slots(self) -> List[Dict[str, Any]]:
        total = self.get_total_slots()
        return [self.get_slot(i) for i in range(total) if self.get_slot(i) is not None]

    def get_total_slots(self) -> int:
        if self.using_native_c and self.dll:
            return self.dll.engine_get_total_slots()
        return len(self._fallback_slots)

    def get_occupied_count(self) -> int:
        if self.using_native_c and self.dll:
            return self.dll.engine_get_occupied_count()
        return sum(1 for s in self._fallback_slots if s["is_occupied"])

    def get_available_count(self) -> int:
        if self.using_native_c and self.dll:
            return self.dll.engine_get_available_count()
        return self.get_total_slots() - self.get_occupied_count()

    def get_occupancy_rate(self) -> float:
        if self.using_native_c and self.dll:
            return round(self.dll.engine_get_occupancy_rate(), 1)
        tot = self.get_total_slots()
        return round((self.get_occupied_count() / tot * 100.0), 1) if tot > 0 else 0.0

    def get_total_revenue(self) -> float:
        if self.using_native_c and self.dll:
            return round(self.dll.engine_get_total_revenue(), 2)
        return round(self._total_revenue, 2)

    def find_nearest_available_slot(self) -> int:
        if self.using_native_c and self.dll:
            return self.dll.engine_find_nearest_available_slot()
        for s in self._fallback_slots:
            if not s["is_occupied"]:
                return s["id"]
        return -1

    def set_hourly_rate(self, rate: float) -> bool:
        if self.using_native_c and self.dll:
            return bool(self.dll.engine_set_hourly_rate(c_double(rate)))
        self._hourly_rate = rate
        return True

    def get_hourly_rate(self) -> float:
        if self.using_native_c and self.dll:
            return round(self.dll.engine_get_hourly_rate(), 2)
        return round(self._hourly_rate, 2)

    def get_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        logs = []
        if self.using_native_c and self.dll:
            count = self.dll.engine_get_log_count()
            start = max(0, count - limit)
            for i in range(start, count):
                entry = ParkingEventLog()
                if self.dll.engine_get_log(c_int(i), byref(entry)):
                    logs.append({
                        "timestamp": entry.timestamp.decode('utf-8', errors='ignore'),
                        "slot_id": entry.slot_id,
                        "slot_label": entry.slot_label.decode('utf-8', errors='ignore'),
                        "event_type": entry.event_type.decode('utf-8', errors='ignore'),
                        "duration_sec": round(entry.duration_sec, 1),
                        "fee": round(entry.fee, 2)
                    })
            return logs[::-1]
        
        return self._fallback_logs[-limit:][::-1]

    def _add_fallback_log(self, slot_id: int, label: str, event_type: str, duration: float, fee: float):
        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        self._fallback_logs.append({
            "timestamp": ts,
            "slot_id": slot_id,
            "slot_label": label,
            "event_type": event_type,
            "duration_sec": round(duration, 1),
            "fee": round(fee, 2)
        })
        if len(self._fallback_logs) > MAX_LOG_ENTRIES:
            self._fallback_logs.pop(0)

# Global engine instance
c_engine = CParkingEngine()
