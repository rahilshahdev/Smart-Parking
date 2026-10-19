"""
Smart Parking Allocation System - CV Optical Tracking Engine
Pure OpenCV pipeline optimized for paper-drawn parking box detection and low latency.
"""

import cv2
import numpy as np
import threading
import time
import json
from pathlib import Path
from typing import Dict, List, Any, Optional

from python_server.c_bridge import c_engine
from python_server.config import (
    CALIBRATION_FILE, FRAME_WIDTH, FRAME_HEIGHT,
    DEFAULT_DIFF_THRESHOLD, DEFAULT_OCCUPANCY_RATIO
)

class CVEngine:
    def __init__(self, camera_index: int = 0):
        self.camera_index = camera_index
        self.cap = None
        self.is_running = False
        self.lock = threading.Lock()
        self.new_frame_event = threading.Event()

        self.current_raw_frame = None
        self.latest_jpeg_bytes = None

        # Clean state: Starts with zero spots. Nothing drawn until detected or calibrated.
        self.spots: List[Dict[str, Any]] = []
        self.empty_reference_frame = None
        self.diff_threshold = DEFAULT_DIFF_THRESHOLD
        self.occupancy_ratio = DEFAULT_OCCUPANCY_RATIO

        self._frame_count = 0
        self._cached_occupancy: Dict[int, int] = {}

        self.load_calibration()
        self._sync_with_c_engine()

    def get_available_cameras(self) -> List[int]:
        """Returns standard webcam index list for instant UI selection."""
        return [0, 1, 2]

    def switch_camera(self, new_index: int) -> bool:
        """Switches video input to another connected camera."""
        with self.lock:
            if self.cap and self.cap.isOpened():
                self.cap.release()
                self.cap = None

            self.camera_index = new_index
            self.cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW)
            if not self.cap.isOpened():
                self.cap = cv2.VideoCapture(self.camera_index)

            if self.cap.isOpened():
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
                self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
                self.cap.set(cv2.CAP_PROP_FPS, 30)
                print(f"[CV_ENGINE] Connected to camera index {new_index}")
                return True
            else:
                print(f"[CV_ENGINE] Unable to open camera index {new_index}, falling back to 0")
                if new_index != 0:
                    self.camera_index = 0
                    self.cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
                return False

    def start_camera(self) -> bool:
        with self.lock:
            if self.is_running:
                return True

            self.cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW)
            if not self.cap.isOpened():
                self.cap = cv2.VideoCapture(self.camera_index)

            if self.cap.isOpened():
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
                self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
                self.cap.set(cv2.CAP_PROP_FPS, 30)
                print(f"[CV_ENGINE] Connected to camera index {self.camera_index}")

            self.is_running = True
            self.thread = threading.Thread(target=self._capture_loop, daemon=True)
            self.thread.start()
            return True

    def stop_camera(self):
        with self.lock:
            self.is_running = False
            if self.cap and self.cap.isOpened():
                self.cap.release()
                self.cap = None

    def _capture_loop(self):
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 65]

        while self.is_running:
            raw = None
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret and frame is not None:
                    raw = frame
                    if frame.shape[1] != FRAME_WIDTH or frame.shape[0] != FRAME_HEIGHT:
                        raw = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT))

            if raw is None:
                raw = np.full((FRAME_HEIGHT, FRAME_WIDTH, 3), 18, dtype=np.uint8)
                cv2.putText(raw, f"Camera {self.camera_index} inactive", (160, 240),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (160, 160, 160), 2)
                time.sleep(0.04)

            self.current_raw_frame = raw
            self._frame_count += 1

            # Render overlay if spots are active
            processed = self._render_frame(raw)

            # Pre-encode JPEG once for zero-latency delivery
            ret, jpeg = cv2.imencode('.jpg', processed, encode_params)
            if ret:
                self.latest_jpeg_bytes = jpeg.tobytes()
                self.new_frame_event.set()

            time.sleep(0.012)

    def detect_paper_parking_boxes(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        """
        Detects rectangular parking slots drawn with pen or marker on paper.
        Returns a sorted list of bounding rectangles.
        """
        if frame is None:
            return []

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Adaptive thresholding extracts dark pen strokes against lighter paper
        thresh = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 15, 6
        )

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)

        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []

        for cnt in contours:
            area = cv2.contourArea(cnt)
            # Filter for plausible miniature parking spot sizes (1,800 to 150,000 px)
            if 1800 < area < 150000:
                peri = cv2.arcLength(cnt, True)
                approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)

                # Check if rectangular geometry
                if len(approx) == 4 or len(approx) <= 6:
                    x, y, w, h = cv2.boundingRect(cnt)
                    aspect = float(w) / float(h)
                    if 0.30 <= aspect <= 3.2 and w > 35 and h > 35:
                        candidates.append((x, y, w, h, area))

        if not candidates:
            return []

        # Sort top-to-bottom, left-to-right
        candidates.sort(key=lambda b: (b[1] // 80, b[0]))

        # Remove overlapping duplicates
        final_boxes = []
        for b in candidates:
            bx, by, bw, bh, _ = b
            overlap = False
            for fb in final_boxes:
                fx, fy, fw, fh = fb["x"], fb["y"], fb["width"], fb["height"]
                dx = min(bx + bw, fx + fw) - max(bx, fx)
                dy = min(by + bh, fy + fh) - max(by, fy)
                if dx > 0 and dy > 0:
                    inter_area = dx * dy
                    if inter_area > 0.35 * min(bw * bh, fw * fh):
                        overlap = True
                        break
            if not overlap and len(final_boxes) < 24:
                idx = len(final_boxes)
                final_boxes.append({
                    "id": idx,
                    "label": f"Slot {idx + 1}",
                    "x": int(bx),
                    "y": int(by),
                    "width": int(bw),
                    "height": int(bh)
                })

        return final_boxes

    def _render_frame(self, frame: np.ndarray) -> np.ndarray:
        """
        Overlays parking spot states on the video feed.
        If no spots are configured, returns the unmodified camera feed.
        """
        if not self.spots:
            return frame

        out = frame.copy()
        run_occupancy_check = (self._frame_count % 3 == 0)

        gray = None
        if run_occupancy_check:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        for spot in self.spots:
            sid = spot["id"]
            x, y, w, h = spot["x"], spot["y"], spot["width"], spot["height"]

            x = max(0, min(x, FRAME_WIDTH - 10))
            y = max(0, min(y, FRAME_HEIGHT - 10))
            w = max(10, min(w, FRAME_WIDTH - x))
            h = max(10, min(h, FRAME_HEIGHT - y))

            is_occupied = self._cached_occupancy.get(sid, 0)

            if run_occupancy_check and gray is not None:
                if self.empty_reference_frame is not None:
                    roi = gray[y:y+h, x:x+w]
                    ref = self.empty_reference_frame[y:y+h, x:x+w]
                    if roi.shape == ref.shape:
                        diff = cv2.absdiff(roi, ref)
                        _, th = cv2.threshold(diff, self.diff_threshold, 255, cv2.THRESH_BINARY)
                        changed = cv2.countNonZero(th)
                        ratio = changed / float(w * h)
                        is_occupied = 1 if ratio >= self.occupancy_ratio else 0
                else:
                    # Variance heuristic on desk paper
                    roi = gray[y:y+h, x:x+w]
                    std_dev = np.std(roi)
                    is_occupied = 1 if std_dev > 34.0 else 0

                self._cached_occupancy[sid] = is_occupied
                c_engine.update_slot_state(sid, is_occupied)

            slot_data = c_engine.get_slot(sid) or {}

            # Strict green (available) vs red (occupied)
            # BGR: Green = (0, 210, 80), Red = (40, 40, 240)
            if is_occupied:
                border_color = (40, 40, 240)
                status_label = "OCCUPIED"
            else:
                border_color = (0, 210, 80)
                status_label = "AVAILABLE"

            # Draw outer rectangle
            cv2.rectangle(out, (x, y), (x + w, y + h), border_color, 2, cv2.LINE_AA)

            # Header banner
            banner_h = 20
            cv2.rectangle(out, (x, y), (x + w, y + banner_h), border_color, -1)
            cv2.putText(out, f"{spot['label']}: {status_label}", (x + 5, y + 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)

            # If occupied, show live duration timer
            if is_occupied:
                cur_sec = int(slot_data.get("current_duration", 0))
                mins, secs = divmod(cur_sec, 60)
                cv2.putText(out, f"{mins:02d}:{secs:02d}", (x + 6, y + h - 8),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 2, cv2.LINE_AA)

        return out

    def capture_empty_reference(self) -> bool:
        if self.current_raw_frame is not None:
            gray = cv2.cvtColor(self.current_raw_frame, cv2.COLOR_BGR2GRAY)
            self.empty_reference_frame = cv2.GaussianBlur(gray, (5, 5), 0)
            return True
        return False

    def get_latest_jpeg(self) -> Optional[bytes]:
        return self.latest_jpeg_bytes

    def get_latest_raw_frame(self) -> Optional[np.ndarray]:
        if self.current_raw_frame is not None:
            return self.current_raw_frame.copy()
        return None

    def update_spots(self, new_spots: List[Dict[str, Any]]):
        with self.lock:
            self.spots = new_spots
            self._cached_occupancy.clear()
            self.save_calibration()
            self._sync_with_c_engine()

    def clear_all_spots(self):
        with self.lock:
            self.spots = []
            self._cached_occupancy.clear()
            self.save_calibration()
            self._sync_with_c_engine()

    def _sync_with_c_engine(self):
        c_engine.init_engine(len(self.spots))
        for spot in self.spots:
            c_engine.configure_slot(
                spot["id"], spot["label"],
                spot["x"], spot["y"], spot["width"], spot["height"]
            )

    def save_calibration(self) -> bool:
        try:
            with open(CALIBRATION_FILE, "w", encoding="utf-8") as f:
                json.dump({
                    "spots": self.spots,
                    "diff_threshold": self.diff_threshold,
                    "occupancy_ratio": self.occupancy_ratio
                }, f, indent=2)
            return True
        except Exception:
            return False

    def load_calibration(self) -> bool:
        if CALIBRATION_FILE.exists():
            try:
                with open(CALIBRATION_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.spots = data.get("spots", [])
                    self.diff_threshold = data.get("diff_threshold", DEFAULT_DIFF_THRESHOLD)
                    self.occupancy_ratio = data.get("occupancy_ratio", DEFAULT_OCCUPANCY_RATIO)
                return True
            except Exception:
                pass
        self.spots = []
        return False

cv_engine = CVEngine()
