"""
Smart Parking Allocation System — Launcher
Starts the CV Engine, C Core Library Bridge, and Flask Web Server.
"""

import os
import sys
from pathlib import Path

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from python_server.app import start_server

if __name__ == "__main__":
    start_server()
