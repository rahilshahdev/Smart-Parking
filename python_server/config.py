"""
Configuration Settings for Smart Parking Allocation System
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

CALIBRATION_FILE = DATA_DIR / "calibration.json"
STATE_FILE = DATA_DIR / "parking_state.dat"
KEY_FILE = DATA_DIR / "gemini_key.txt"

# Server configuration
HOST = "0.0.0.0"
PORT = 5000

# CV Detection Configuration
FRAME_WIDTH = 640
FRAME_HEIGHT = 480
DEFAULT_DIFF_THRESHOLD = 28          # Pixel color difference threshold
DEFAULT_OCCUPANCY_RATIO = 0.14       # Ratio of changed pixels to trigger occupied
DEFAULT_HOURLY_RATE = 20.0           # INR per hour

# Gemini Configuration
GEMINI_MODEL_NAME = "gemini-3.5-flash-lite"
GEMINI_VERIFY_INTERVAL = 3.0         # seconds between AI verification calls

def get_gemini_api_key() -> str:
    # 1. Check environment variable
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    # 2. Check local key file
    if KEY_FILE.exists():
        try:
            return KEY_FILE.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    return ""

def save_gemini_api_key(key: str) -> bool:
    try:
        KEY_FILE.write_text(key.strip(), encoding="utf-8")
        os.environ["GEMINI_API_KEY"] = key.strip()
        return True
    except Exception as e:
        print(f"[CONFIG] Error saving Gemini key: {e}")
        return False
