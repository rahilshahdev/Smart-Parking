"""
Flask Web Server and REST API for Smart Parking Allocation System
"""

import os
import sys
import time
import json
import base64
import numpy as np
import cv2
from pathlib import Path
from flask import Flask, Response, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from python_server.c_bridge import c_engine
from python_server.gemini_engine import gemini_engine
from python_server.config import (
    HOST, PORT, CALIBRATION_FILE,
    get_gemini_api_key, save_gemini_api_key
)

FRONTEND_DIR = BASE_DIR / "web_frontend"

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")

# ----------------- Frontend Static Routes -----------------
@app.route("/")
def index():
    return send_from_directory(str(FRONTEND_DIR), "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(str(FRONTEND_DIR), path)

# ----------------- Gemini API Key Endpoints -----------------
@app.route("/api/key", methods=["GET"])
def get_key_status():
    key = get_gemini_api_key()
    has_key = bool(key and len(key) > 5)
    masked = f"{key[:4]}...{key[-4:]}" if has_key else ""
    return jsonify({
        "success": True,
        "has_key": has_key,
        "masked_key": masked
    })

@app.route("/api/key", methods=["POST"])
def set_key():
    data = request.get_json() or {}
    key = str(data.get("key", "")).strip()
    if not key:
        return jsonify({"success": False, "error": "Empty key provided"}), 400
    ok = save_gemini_api_key(key)
    return jsonify({"success": ok, "message": "Gemini API key saved." if ok else "Failed to save key."})

# ----------------- C Engine Telemetry & Slot Status -----------------
@app.route("/api/status", methods=["GET"])
def get_status():
    slots = c_engine.get_all_slots()
    return jsonify({
        "success": True,
        "total_slots": c_engine.get_total_slots(),
        "occupied_count": c_engine.get_occupied_count(),
        "available_count": c_engine.get_available_count(),
        "occupancy_rate": c_engine.get_occupancy_rate(),
        "hourly_rate": c_engine.get_hourly_rate(),
        "total_revenue": c_engine.get_total_revenue(),
        "nearest_slot": c_engine.find_nearest_available_slot(),
        "using_native_c": c_engine.using_native_c,
        "slots": slots,
    })

# ----------------- Live Slot Occupancy Update from Browser -----------------
@app.route("/api/spots/update_states", methods=["POST"])
def update_spot_states():
    data = request.get_json() or {}
    states = data.get("states", [])
    
    # Update each slot in the native C engine
    for s in states:
        slot_id = int(s.get("id", -1))
        is_occ = int(bool(s.get("is_occupied", False)))
        if slot_id >= 0:
            c_engine.update_slot_state(slot_id, is_occ)
            
    slots = c_engine.get_all_slots()
    return jsonify({
        "success": True,
        "total_slots": c_engine.get_total_slots(),
        "occupied_count": c_engine.get_occupied_count(),
        "available_count": c_engine.get_available_count(),
        "occupancy_rate": c_engine.get_occupancy_rate(),
        "total_revenue": c_engine.get_total_revenue(),
        "nearest_slot": c_engine.find_nearest_available_slot(),
        "slots": slots,
    })

# ----------------- Spot Calibration & Persistence -----------------
def load_saved_spots():
    if CALIBRATION_FILE.exists():
        try:
            with open(CALIBRATION_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("spots", [])
        except Exception:
            pass
    return []

def save_spots_to_disk(spots):
    data = {
        "spots": spots,
        "diff_threshold": 28,
        "occupancy_ratio": 0.14
    }
    with open(CALIBRATION_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

@app.route("/api/spots", methods=["GET"])
def get_spots():
    spots = load_saved_spots()
    return jsonify({"success": True, "spots": spots})

@app.route("/api/spots/save", methods=["POST"])
def save_spots():
    data = request.get_json() or {}
    spots = data.get("spots", [])
    
    # Reconfigure C engine slots
    c_engine.init_engine(total_slots=len(spots), hourly_rate=5.0)
    for s in spots:
        slot_id = int(s.get("id", 0))
        label = str(s.get("label", f"P{slot_id+1}"))
        x = int(s.get("x", 0))
        y = int(s.get("y", 0))
        w = int(s.get("width", 100))
        h = int(s.get("height", 120))
        c_engine.configure_slot(slot_id, label, x, y, w, h)
        
    save_spots_to_disk(spots)
    return jsonify({"success": True, "spots": spots})

@app.route("/api/spots/clear", methods=["POST"])
def clear_spots():
    save_spots_to_disk([])
    c_engine.init_engine(total_slots=0, hourly_rate=5.0)
    return jsonify({"success": True, "message": "All spots cleared."})

# ----------------- Paper Detection (Gemini Vision or Local CV) -----------------
def decode_base64_image(b64_str: str):
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    img_data = base64.b64decode(b64_str)
    nparr = np.frombuffer(img_data, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def detect_boxes_locally(frame_bgr, target_w=None, target_h=None):
    """Fallback local contour detector for hand-drawn paper parking boxes"""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 25, 7
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    cleaned = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    detected = []
    h_img, w_img = frame_bgr.shape[:2]
    w_out = target_w if (target_w and target_w > 0) else w_img
    h_out = target_h if (target_h and target_h > 0) else h_img
    scale_x = w_out / float(w_img)
    scale_y = h_out / float(h_img)

    min_area = (w_img * h_img) * 0.012
    max_area = (w_img * h_img) * 0.40

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if min_area < area < max_area:
            x, y, w, h = cv2.boundingRect(cnt)
            aspect = float(w) / float(h)
            rect_fill = area / float(w * h)
            # Hand-drawn rectangles on paper have fill ratio > 0.55 and sensible aspect ratios
            if 0.35 <= aspect <= 2.8 and rect_fill >= 0.52:
                detected.append({"x": int(x), "y": int(y), "width": int(w), "height": int(h)})

    detected = sorted(detected, key=lambda s: (s["y"] // 90, s["x"]))
    spots = []
    for idx, d in enumerate(detected):
        sx = int(d["x"] * scale_x)
        sy = int(d["y"] * scale_y)
        sw = int(d["width"] * scale_x)
        sh = int(d["height"] * scale_y)
        spots.append({
            "id": idx,
            "label": f"Slot {idx + 1}",
            "x": sx,
            "y": sy,
            "width": sw,
            "height": sh,
            "box_2d": [
                round((sy / h_out) * 1000.0, 1),
                round((sx / w_out) * 1000.0, 1),
                round(((sy + sh) / h_out) * 1000.0, 1),
                round(((sx + sw) / w_out) * 1000.0, 1)
            ],
            "norm_x": round(sx / float(w_out), 4),
            "norm_y": round(sy / float(h_out), 4),
            "norm_w": round(sw / float(w_out), 4),
            "norm_h": round(sh / float(h_out), 4)
        })
    return spots

@app.route("/api/spots/detect_gemini", methods=["POST"])
def detect_gemini():
    start_time = time.time()
    data = request.get_json() or {}
    image_b64 = data.get("image", "")
    cam_w = int(data.get("camera_width") or 0)
    cam_h = int(data.get("camera_height") or 0)

    if not image_b64:
        return jsonify({"success": False, "error": "No image data provided"}), 400

    try:
        frame_bgr = decode_base64_image(image_b64)
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to decode image: {e}"}), 400

    api_key = get_gemini_api_key()
    spots = []
    scene_description = ""
    used_gemini = False

    if api_key and len(api_key) > 5:
        try:
            print(f"[SERVER] Requesting Gemini Vision paper spot detection (camera res: {cam_w}x{cam_h})...", flush=True)
            gemini_res = gemini_engine.auto_calibrate_spots(frame_bgr, target_w=cam_w, target_h=cam_h)
            spots = gemini_res.get("spots", [])
            scene_description = gemini_res.get("scene_description", "")
            used_gemini = True
        except Exception as e:
            print(f"[SERVER] Gemini vision error: {e}. Falling back to OpenCV contour detection.", flush=True)
            spots = detect_boxes_locally(frame_bgr, target_w=cam_w, target_h=cam_h)
            scene_description = f"Local CV fallback activated: {str(e)[:120]}"
    else:
        print("[SERVER] No Gemini API key provided. Using local OpenCV contour detection.", flush=True)
        spots = detect_boxes_locally(frame_bgr, target_w=cam_w, target_h=cam_h)
        scene_description = "Using local contour detection (No Google AI Studio key configured)."

    elapsed = round(time.time() - start_time, 2)

    if spots:
        # Re-initialize C engine with detected spots
        c_engine.init_engine(total_slots=len(spots), hourly_rate=5.0)
        for s in spots:
            c_engine.configure_slot(s["id"], s["label"], s["x"], s["y"], s["width"], s["height"])
        save_spots_to_disk(spots)
        return jsonify({
            "success": True,
            "count": len(spots),
            "spots": spots,
            "used_gemini": used_gemini,
            "latency_sec": elapsed,
            "scene_description": scene_description,
            "message": f"Detected {len(spots)} slot(s) {'via Gemini Vision' if used_gemini else 'via Computer Vision'} in {elapsed}s."
        })
    else:
        return jsonify({
            "success": False,
            "count": 0,
            "latency_sec": elapsed,
            "scene_description": scene_description or f"No paper parking slots found in {elapsed}s. Ensure boxes are clearly drawn on paper.",
            "message": scene_description or f"No paper parking slots found in {elapsed}s. Ensure boxes are clearly drawn on paper."
        })

def start_server():
    # Initialize C engine with previously saved spots if any
    saved = load_saved_spots()
    c_engine.init_engine(total_slots=len(saved), hourly_rate=5.0)
    for s in saved:
        c_engine.configure_slot(
            int(s.get("id", 0)),
            str(s.get("label", f"Slot {int(s.get('id', 0)) + 1}")),
            int(s.get("x", 0)),
            int(s.get("y", 0)),
            int(s.get("width", 100)),
            int(s.get("height", 120))
        )

    print("\n========================================================")
    print("  Smart Parking Allocation System Server")
    print(f"  URL: http://localhost:{PORT}")
    print(f"  Native C Engine: {'Active (parking_engine.dll)' if c_engine.using_native_c else 'Mirrored'}")
    print("========================================================\n")
    app.run(host=HOST, port=PORT, debug=False, threaded=True)

if __name__ == "__main__":
    start_server()

