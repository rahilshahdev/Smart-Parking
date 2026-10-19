# 🚗 Smart Parking Allocation System

<div align="center">

![C Engine](https://img.shields.io/badge/Language-C99-00599C?style=for-the-badge&logo=c&logoColor=white)
![Python](https://img.shields.io/badge/Backend-Python_3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Framework-Flask-000000?style=for-the-badge&logo=flask&logoColor=white)
![OpenCV](https://img.shields.io/badge/Computer_Vision-OpenCV-5C3EE8?style=for-the-badge&logo=opencv&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Vision_AI-Gemini_3.5_Flash--Lite-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Web Standards](https://img.shields.io/badge/Frontend-HTML5_|_CSS3_|_Vanilla_JS-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/Deployment-GitHub_Pages-222222?style=for-the-badge&logo=githubpages&logoColor=white)

**An intelligent, hybrid computer vision & AI-powered parking allocation and tracking system.**  
*Combines Google Gemini 3.5 Flash-Lite spatial intelligence, a compiled native 64-bit C allocation engine, real-time WebRTC camera telemetry, and an adaptive responsive dashboard for desktop and mobile.*

[Explore Features](#-key-features) • [Button & Control Guide](#-interactive-button--controls-guide) • [Setup & Usage](#-how-to-use) • [Architecture](#-system-architecture)

</div>

---

## 🌟 Overview

The **Smart Parking Allocation System** turns any ordinary paper drawing and standard USB webcam into an automated parking management cockpit. Draw parking bays with a pen or marker on a sheet of paper, point your camera from an overhead angle, and let Gemini 3.5 Flash-Lite automatically detect, calibrate, and label the slots with sub-pixel precision. When toy cars or objects enter a slot, the system detects occupancy in real time, turns the slot red, logs parking durations, and calculates billing revenue in INR.

The system features **dual-engine architecture**:
1. **Cloud / Standalone Web Mode (GitHub Pages):** Runs 100% inside your browser using WebRTC, direct Google AI Studio API calls, client-side diff tracking, and local storage. No installation needed!
2. **Local High-Performance Rig:** Pairs the web dashboard with a local Flask server linked to a native 64-bit C shared library (`parking_engine.dll`) for ultra-low latency duration tracking, ticket allocation, and binary state persistence.

---

## 🚀 Key Features

- **Google Gemini 3.5 Flash-Lite Spatial Vision:** Uses 2D normalized bounding boxes (`[ymin, xmin, ymax, xmax]`) to automatically recognize hand-drawn parking stalls on paper.
- **AI Camera Scene Insight:** If no parking spots are detected, Gemini analyzes the camera feed and describes what it sees instead (e.g., tabletop clutter, hand in frame, insufficient lighting).
- **Dynamic Real-Time AI Progress Bar:** Clicking the Auto-Detect button morphs it into a live progress bar showing request stages and elapsed seconds.
- **Native 64-Bit C Engine (`parking_engine.dll`):** Core allocation algorithm, slot lookup, ticket issuance, duration calculation, and binary file persistence implemented in pure C99.
- **Hardware-Probed WebRTC Camera Stream:** Automatically detects actual hardware capabilities (resolutions up to 4K and frame rates up to 60 FPS) directly from physical camera sensors.
- **Responsive Dual Layout:** Fully optimized for widescreen desktop monitors (cockpit layout) down to compact mobile phones (<380px) with 44px minimum tap targets.
- **CLAHE Contrast Enhancement:** Applied to snapshots to make faint pen strokes stand out crisply against paper surfaces.
- **Live Financial & Occupancy Telemetry:** Real-time metrics for total spots, available spots (green), occupied spots (red), and billable revenue (INR).

---

## 🎮 Interactive Button & Controls Guide

| Control / Button | Type | What It Does |
|---|---|---|
| **Select Webcam** | Dropdown | Enumerates all connected video devices with actual hardware labels. Switching cameras auto-refreshes stream settings. |
| **Mirror Feed** | Toggle Button | Flips camera horizontally. Perfect when using front-facing cameras or mirror-oriented desk mounts. |
| **Resolution** | Dropdown | Dynamically populated with resolutions supported by your physical camera sensor (e.g. 1080p, 720p, 480p). Existing slots proportionally rescale without drift. |
| **FPS** | Dropdown | Select negotiated frame rate (15 FPS, 24 FPS, 30 FPS, or 60 FPS) according to camera capabilities and system load. |
| **Google AI Key** | Password Input | Enter your Google AI Studio API key (`aistudio.google.com`). Saved securely in your browser's `localStorage` (never pushed to GitHub). |
| **Auto-Detect Paper Spots (Gemini 3.5 Flash-Lite)** | Primary CTA Button | Captures a snapshot, enhances pen contrast, and morphs into a live progress bar. Queries Gemini 3.5 Flash-Lite to discover all slots. Includes an automatic cooldown timer to prevent rate-limit spam. |
| **Set Empty Baseline** | Secondary Button | Takes an optical baseline of the empty paper surface. Any subsequent change (e.g. toy car parked in a slot) triggers immediate red occupancy. |
| **Draw / Adjust Boxes** | Toggle Mode | Enter interactive canvas editing mode. Click and drag to create new slots or drag corner handles to resize existing boxes manually. |
| **Save Boxes** | Success Button | Appears while in drawing mode. Confirms and saves manual slot coordinates to local storage and backend state. |
| **Clear All** | Danger Button | Clears all tracked parking slots, resets baseline buffers, and wipes active occupancy timers. |
| **Describe scene if no spots detected** | Checkbox Toggle | When enabled, if Gemini fails to locate drawn slots, it displays an AI Camera Scene Insight card explaining what the camera sees. |

---

## 📋 How to Use

### 1. Preparation
1. Take a plain white sheet of paper.
2. Draw 2 to 6 rectangular parking stalls with a dark pen or marker.
3. Position your webcam directly above or at an angle looking down onto the paper.

### 2. Running on GitHub Pages (Zero Install)
1. Open the hosted GitHub Pages link.
2. Click **Enable Camera** and allow browser camera permissions.
3. Paste your Google AI Studio API key into the key field (get a free key at [aistudio.google.com](https://aistudio.google.com)).
4. Click **Auto-Detect Paper Spots (Gemini 3.5 Flash-Lite)**.
5. Watch the progress bar calibrate your slots automatically!
6. Ensure no cars are in the bays, then click **Set Empty Baseline**.
7. Park a toy car or place an object in any box: the box turns **RED** and begins tracking time and revenue. Remove it to turn it back to **GREEN**.

### 3. Running Locally with Native C Engine & Flask
If you want to run the full stack locally with the native C shared library:

```bash
# 1. Clone repository
git clone https://github.com/rahilshahdev/Smart-Parking.git
cd Smart-Parking

# 2. Install Python dependencies
pip install flask opencv-python requests google-genai

# 3. Compile the C Engine DLL (if modifying C code; pre-compiled DLL included)
cd c_engine
gcc -shared -o parking_engine.dll parking_engine.c -O2
cd ..

# 4. Launch the application
python run.py
```

Open your browser at `http://localhost:5000` to access the full local cockpit.

---

## 🏗 System Architecture

```
 smart-parking-allocation-system/
 ├── c_engine/                    # Native C Core Engine
 │   ├── parking_engine.h         # C data structures (Slots, Lots, Tickets)
 │   ├── parking_engine.c         # Allocation algorithm & binary persistence
 │   ├── parking_engine.def       # Windows DLL export definitions
 │   └── parking_engine.dll       # Compiled native 64-bit Windows shared library
 ├── python_server/               # Python / Flask Application Server
 │   ├── app.py                   # REST API routes & MJPEG video feed
 │   ├── c_bridge.py              # ctypes bridge loading parking_engine.dll
 │   ├── cv_engine.py             # OpenCV webcam capture & optical diff engine
 │   ├── gemini_engine.py         # Google Gemini 3.5 Flash-Lite spatial vision
 │   └── config.py                # Server & model configuration
 ├── web_frontend/                # Standalone Web Application (GitHub Pages)
 │   ├── index.html               # Semantic HTML5 dashboard & video canvas
 │   ├── css/styles.css           # Glassmorphism, design tokens & responsive reflow
 │   └── js/app.js                # WebRTC, direct Gemini fallback & canvas renderer
 ├── .github/workflows/           # Automated deployment
 │   └── deploy.yml               # GitHub Actions workflow for GitHub Pages
 ├── data/                        # Local state storage (excluded from git)
 ├── run.py                       # Python server entry point
 └── README.md                    # Project documentation
```

---

## 🔒 Security & Privacy

- **API Keys:** Your Google AI Studio API key is kept locally in browser `localStorage` or local environment variables. It is never committed to GitHub.
- **Camera Streams:** WebRTC video processing happens directly in your browser or on your local machine. No video is ever sent to external cloud servers other than individual snapshot frames sent to Gemini for spot detection.

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
