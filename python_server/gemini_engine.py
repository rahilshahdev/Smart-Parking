"""
Google Gemini Vision & Multimodal Spatial Tracking Engine
Utilizes Google 2D Bounding Box spatial grounding [ymin, xmin, ymax, xmax] (0-1000 scale)
for sub-pixel accurate discovery of paper-drawn parking spots across any camera resolution.
"""

import os
import cv2
import json
import base64
import requests
import re
import time
import numpy as np
from typing import Dict, List, Any, Optional

from python_server.config import get_gemini_api_key

class GeminiEngine:
    def __init__(self):
        # Priority models that are active and fast on Google AI Studio
        self.models_to_try = [
            "gemini-3.5-flash-lite",
            "gemini-3.5-flash",
            "gemini-flash-latest"
        ]
        self.last_request_time = 0
        self.min_cooldown_sec = 8.0

    def _get_api_key(self) -> str:
        return get_gemini_api_key()

    def enhance_frame_contrast(self, frame_bgr):
        """Enhances contrast so faint pen or marker lines on paper stand out sharply."""
        try:
            lab = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
            cl = clahe.apply(l)
            merged = cv2.merge((cl, a, b))
            return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)
        except Exception:
            return frame_bgr

    def _frame_to_base64_jpeg(self, frame_bgr) -> str:
        # Optimize frame size to max 720p for fast 5-10s network transfer and tokenization
        h, w = frame_bgr.shape[:2]
        if w > 720:
            scale = 720.0 / w
            frame_bgr = cv2.resize(frame_bgr, (720, int(h * scale)), interpolation=cv2.INTER_AREA)

        enhanced = self.enhance_frame_contrast(frame_bgr)
        ret, buffer = cv2.imencode('.jpg', enhanced, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if not ret:
            raise ValueError("Failed to encode frame to JPEG")
        return base64.b64encode(buffer).decode('utf-8')

    def _call_gemini_vision(self, prompt: str, image_b64: str) -> str:
        api_key = self._get_api_key()
        if not api_key:
            raise ValueError("Google AI Studio API key not found. Please provide your key in settings.")

        # Respect cooldown to protect 3.8 Flash from 503 capacity spikes
        now = time.time()
        time_since_last = now - self.last_request_time
        if time_since_last < 2.0:
            time.sleep(2.0 - time_since_last)

        payload = {
            "contents": [{
                "parts": [
                    {"inline_data": {"mime_type": "image/jpeg", "data": image_b64}},
                    {"text": prompt}
                ]
            }],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 450,
                "response_mime_type": "application/json",
                "thinkingConfig": {
                    "thinkingBudget": 0
                }
            }
        }

        last_error = ""

        # Try models in priority order with fast retry on temporary 503 spikes
        for model in self.models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            
            for attempt in range(2):
                try:
                    resp = requests.post(url, json=payload, timeout=22)
                    if resp.status_code == 200:
                        self.last_request_time = time.time()
                        data = resp.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            text_parts = candidates[0].get("content", {}).get("parts", [])
                            result_text = "".join([p.get("text", "") for p in text_parts])
                            print(f"[GEMINI] Success using model {model} (Attempt {attempt+1})", flush=True)
                            return result_text
                    elif resp.status_code == 503:
                        time.sleep(1.0)
                        continue
                    else:
                        last_error = f"{model} returned HTTP {resp.status_code}: {resp.text[:180]}"
                        break
                except Exception as e:
                    last_error = f"{model} error: {e}"
                    break

        raise RuntimeError(f"Gemini API request failed across all models: {last_error}")

    def auto_calibrate_spots(self, frame_bgr, target_w: Optional[int] = None, target_h: Optional[int] = None) -> Dict[str, Any]:
        """
        Uses Google Gemini spatial 2D bounding boxes [ymin, xmin, ymax, xmax] (0-1000 scale)
        to discover paper-drawn parking spots across any camera resolution.
        Also returns a scene_description explaining what is visible if no spots are detected.
        """
        h_img, w_img = frame_bgr.shape[:2]
        b64 = self._frame_to_base64_jpeg(frame_bgr)

        prompt = (
            "You are an expert computer vision model specialized in overhead camera analysis of paper drawings and tabletop environments.\n"
            "Task 1: Detect drawn parking slots, stalls, or rectangular parking bays drawn on paper.\n"
            "Task 2: If parking spots are found, provide their normalized 2D bounding boxes.\n"
            "Task 3: Always provide a concise 1-2 sentence description of what is actually visible in the camera scene. If no parking spots are detected, clearly explain what the camera is seeing instead (e.g. tabletop objects, blank paper, laptop, keyboard, hand, poor lighting) and why no parking boxes could be identified.\n\n"
            "Return a JSON object with this exact structure:\n"
            "{\n"
            "  \"spots\": [\n"
            "    {\"label\": \"Slot 1\", \"box_2d\": [ymin, xmin, ymax, xmax]}\n"
            "  ],\n"
            "  \"scene_description\": \"1-2 sentence explanation of what is visible in the scene\"\n"
            "}\n"
            "Note: 'box_2d' coordinates must be integers normalized from 0 to 1000. If no parking spots are drawn or visible, 'spots' must be an empty array []. Return valid JSON only."
        )

        response_text = self._call_gemini_vision(prompt, b64)

        try:
            raw_data = json.loads(response_text.strip())
        except Exception:
            cleaned = re.sub(r"^```json\s*", "", response_text.strip(), flags=re.MULTILINE)
            cleaned = re.sub(r"^```\s*", "", cleaned, flags=re.MULTILINE)
            raw_data = json.loads(cleaned.strip())

        spots_list = []
        scene_description = ""

        if isinstance(raw_data, dict):
            scene_description = str(raw_data.get("scene_description", "")).strip()
            if "spots" in raw_data and isinstance(raw_data["spots"], list):
                spots_list = raw_data["spots"]
            else:
                for k, v in raw_data.items():
                    if isinstance(v, list) and k != "scene_description":
                        spots_list = v
                        break
        elif isinstance(raw_data, list):
            spots_list = raw_data

        w_out = target_w if (target_w and target_w > 0) else w_img
        h_out = target_h if (target_h and target_h > 0) else h_img

        valid_spots = []
        for idx, item in enumerate(spots_list):
            if not isinstance(item, dict):
                continue
            label = str(item.get("label", f"Slot {idx + 1}"))
            box = item.get("box_2d", [])

            if len(box) == 4:
                try:
                    ymin, xmin, ymax, xmax = [float(c) for c in box]
                except (ValueError, TypeError):
                    continue

                # Rescale from 0-1000 normalized to target camera resolution
                x = int((xmin / 1000.0) * w_out)
                y = int((ymin / 1000.0) * h_out)
                w = int(((xmax - xmin) / 1000.0) * w_out)
                h = int(((ymax - ymin) / 1000.0) * h_out)

                if w >= 15 and h >= 15:
                    valid_spots.append({
                        "id": idx,
                        "label": label,
                        "x": max(0, x),
                        "y": max(0, y),
                        "width": min(w_out - x, w),
                        "height": min(h_out - y, h),
                        "box_2d": [ymin, xmin, ymax, xmax],
                        "norm_x": round(xmin / 1000.0, 4),
                        "norm_y": round(ymin / 1000.0, 4),
                        "norm_w": round((xmax - xmin) / 1000.0, 4),
                        "norm_h": round((ymax - ymin) / 1000.0, 4)
                    })

        # Sort spots logically from top-to-bottom, left-to-right
        valid_spots.sort(key=lambda s: (s["y"] // 80, s["x"]))
        for i, s in enumerate(valid_spots):
            s["id"] = i
            s["label"] = f"Slot {i + 1}"

        if not valid_spots and not scene_description:
            scene_description = "No paper parking slots identified. Ensure boxes are clearly drawn with pen or marker."

        return {
            "spots": valid_spots,
            "scene_description": scene_description
        }

gemini_engine = GeminiEngine()
