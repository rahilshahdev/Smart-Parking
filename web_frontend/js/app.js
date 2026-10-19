/**
 * Smart Parking Allocation System - Client Controller
 * Pure Browser-side WebRTC Video Capture, Real-time USB Webcam Detection,
 * Dynamic Resolution & FPS Selection, Canvas Overlay Tracking,
 * and Gemini 3.8 Flash Vision with Progress Bar & Cooldown.
 */

class SmartParkingApp {
  constructor() {
    this.spots = [];
    this.currentStream = null;
    this.isEditing = false;
    this.activeDrag = null;
    this.dragStart = null;
    this.newBoxStart = null;
    this.baselineData = null;
    this.detectCooldownUntil = 0;
    this.engineMode = 'detecting';
    this.clientRevenue = 0.0;
    this.clientOccupancyDurations = {};

    this.initElements();
    this.initEvents();
    this.initCanvas();
    this.initWebcamSystem();
    this.loadSavedSpots();
    this.startTrackingLoop();
  }

  initElements() {
    // Camera controls
    this.cameraSelect = document.getElementById('camera-select');
    this.btnRefreshCams = document.getElementById('btn-refresh-cams');
    this.btnFlipCam = document.getElementById('btn-flip-cam');
    this.resSelect = document.getElementById('resolution-select');
    this.fpsSelect = document.getElementById('fps-select');
    this.streamInfoBadge = document.getElementById('stream-info-badge');

    // Engine indicators
    this.txtEngine = document.getElementById('txt-engine');
    this.statusMarker = document.getElementById('status-marker');

    // Video & Canvas
    this.videoElement = document.getElementById('webcam-video');
    this.canvas = document.getElementById('overlay-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.videoContainer = document.getElementById('video-container');
    this.cameraTapPrompt = document.getElementById('camera-tap-prompt');
    this.btnTapStart = document.getElementById('btn-tap-start');

    // Device capability detection
    const ua = navigator.userAgent || '';
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
    this.isIOS = /iPhone|iPad|iPod/i.test(ua);

    // Stats
    this.valTotal = document.getElementById('val-total');
    this.valAvailable = document.getElementById('val-available');
    this.valOccupied = document.getElementById('val-occupied');
    this.valRevenue = document.getElementById('val-revenue');
    this.valPct = document.getElementById('val-pct');
    this.occupancyFill = document.getElementById('occupancy-fill');
    this.badgeNearest = document.getElementById('badge-nearest');
    this.slotsList = document.getElementById('slots-list');

    // Action Toolbar
    this.btnAutoDetect = document.getElementById('btn-auto-detect');
    this.detectProgressFill = document.getElementById('detect-progress-fill');
    this.detectProgressText = document.getElementById('detect-progress-text');

    this.btnEmptyBaseline = document.getElementById('btn-empty-baseline');
    this.btnToggleEdit = document.getElementById('btn-toggle-edit');
    this.btnSaveBoxes = document.getElementById('btn-save-boxes');
    this.btnClearSpots = document.getElementById('btn-clear-spots');

    // Gemini Key
    this.inputGeminiKey = document.getElementById('input-gemini-key');
    this.btnSaveKey = document.getElementById('btn-save-key');

    // AI Camera Scene Insight UI
    this.chkSceneDescribe = document.getElementById('chk-scene-describe');
    this.aiSceneBox = document.getElementById('ai-scene-box');
    this.aiSceneText = document.getElementById('ai-scene-text');
    this.btnCloseScene = document.getElementById('btn-close-scene');

    this.toast = document.getElementById('toast');
  }

  initEvents() {
    // Camera selection & constraints
    this.cameraSelect.addEventListener('change', (e) => this.switchCamera(e.target.value));
    this.btnRefreshCams.addEventListener('click', () => this.refreshCameras(true));
    if (this.btnFlipCam) this.btnFlipCam.addEventListener('click', () => this.flipCamera());
    if (this.btnTapStart) this.btnTapStart.addEventListener('click', () => this.resumeVideoPlayback());
    if (this.cameraTapPrompt) this.cameraTapPrompt.addEventListener('click', () => this.resumeVideoPlayback());
    this.resSelect.addEventListener('change', () => this.onConstraintChange());
    this.fpsSelect.addEventListener('change', () => this.onConstraintChange());

    // Toolbar buttons
    this.btnAutoDetect.addEventListener('click', () => this.autoDetectPaperSpots());
    this.btnEmptyBaseline.addEventListener('click', () => this.captureBaseline(true));
    this.btnToggleEdit.addEventListener('click', () => this.toggleEditMode());
    this.btnSaveBoxes.addEventListener('click', () => this.saveBoxes());
    this.btnClearSpots.addEventListener('click', () => this.clearAllSpots());

    // AI Scene Insight controls
    if (this.btnCloseScene) {
      this.btnCloseScene.addEventListener('click', () => this.hideSceneInsight());
    }
    if (this.chkSceneDescribe) {
      const savedPref = localStorage.getItem('ai_scene_describe_pref');
      if (savedPref !== null) {
        this.chkSceneDescribe.checked = (savedPref === 'true');
      }
      this.chkSceneDescribe.addEventListener('change', (e) => {
        localStorage.setItem('ai_scene_describe_pref', String(e.target.checked));
      });
    }

    // Gemini Key save
    this.btnSaveKey.addEventListener('click', () => this.saveGeminiKey());

    // Hardware hot-plug listener
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        this.showToast('Hardware change detected (camera plugged or unplugged). Refreshing list...');
        await this.refreshCameras(false);
      });
    }

    this.checkKeyStatus();
  }

  /* ----------------- Real-time Universal Webcam Detection & Multi-Device Controls ----------------- */
  async initWebcamSystem() {
    // 1. Secure context check (mandatory for mobile WebRTC)
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      this.showToast('Note: Mobile browsers require HTTPS for camera access. If accessing via Wi-Fi IP, use HTTPS or tunnel.');
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.showToast('Camera API not accessible. Open via HTTPS or localhost in Chrome/Safari/Edge.');
      return;
    }

    // Load saved preferences
    const savedRes = localStorage.getItem('camera_res_pref');
    if (savedRes && this.resSelect) this.resSelect.value = savedRes;
    const savedFps = localStorage.getItem('camera_fps_pref');
    if (savedFps && this.fpsSelect) this.fpsSelect.value = savedFps;

    await this.refreshCameras(true);
  }

  async onConstraintChange() {
    const res = this.resSelect.value;
    const fps = this.fpsSelect.value;
    localStorage.setItem('camera_res_pref', res);
    localStorage.setItem('camera_fps_pref', fps);
    this.showToast(`Applying ${res} @ ${fps} FPS...`);

    if (this.currentStream) {
      const track = this.currentStream.getVideoTracks()[0];
      if (track && typeof track.applyConstraints === 'function') {
        const [w, h] = res.split('x').map(Number);
        const fpsVal = parseInt(fps, 10);
        try {
          await track.applyConstraints({
            width: { ideal: w },
            height: { ideal: h },
            frameRate: { ideal: fpsVal }
          });
          this.updateActiveStreamMetadata();
          return;
        } catch (e) {
          console.warn('applyConstraints failed, falling back to camera reactivation:', e);
        }
      }
    }
    await this.switchCamera(this.cameraSelect.value);
  }

  getRequestedConstraints(deviceId, preferFacingMode) {
    const resVal = this.resSelect ? this.resSelect.value : '1280x720';
    const fpsVal = this.fpsSelect ? parseInt(this.fpsSelect.value, 10) : 30;
    const [w, h] = resVal.split('x').map(Number);

    const videoConstraints = {
      width: { ideal: w || 1280 },
      height: { ideal: h || 720 },
      frameRate: { ideal: fpsVal || 30 }
    };

    if (deviceId) {
      videoConstraints.deviceId = { ideal: deviceId };
    } else if (this.isMobile) {
      videoConstraints.facingMode = { ideal: preferFacingMode || 'environment' };
    }

    return { video: videoConstraints, audio: false };
  }

  formatCameraLabel(dev, idx) {
    const raw = (dev.label || '').toLowerCase();
    let type = 'Camera';
    if (raw.includes('back') || raw.includes('rear') || raw.includes('environment')) {
      type = 'Rear / Back Camera (Paper View)';
    } else if (raw.includes('front') || raw.includes('user') || raw.includes('selfie') || raw.includes('facetime')) {
      type = 'Front / Selfie Camera';
    } else if (raw.includes('usb')) {
      type = 'USB Wired Webcam';
    } else if (raw.includes('integrated') || raw.includes('internal') || raw.includes('built-in')) {
      type = 'Built-in Webcam';
    } else if (raw.includes('obs') || raw.includes('virtual') || raw.includes('camo') || raw.includes('droidcam')) {
      type = 'Virtual Camera';
    } else {
      type = this.isMobile ? (idx === 0 ? 'Rear Camera' : 'Front Camera') : `Webcam ${idx + 1}`;
    }
    const cleanName = dev.label ? dev.label : `Device ${idx + 1}`;
    return `${type}: ${cleanName}`;
  }

  async refreshCameras(forcePermissionPrompt = false) {
    this.btnRefreshCams.disabled = true;
    this.btnRefreshCams.textContent = 'Scanning...';

    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let videoDevices = devices.filter(d => d.kind === 'videoinput');

      const needsPermission = videoDevices.length === 0 || videoDevices.every(d => !d.label || d.label.trim() === '');

      if ((needsPermission || forcePermissionPrompt) && !this.currentStream) {
        try {
          const defaultFacing = this.isMobile ? 'environment' : 'user';
          const constraints = this.getRequestedConstraints(null, defaultFacing);
          const tempStream = await navigator.mediaDevices.getUserMedia(constraints);
          this.currentStream = tempStream;
          this.attachStreamToVideo(tempStream);
          devices = await navigator.mediaDevices.enumerateDevices();
          videoDevices = devices.filter(d => d.kind === 'videoinput');
        } catch (permErr) {
          console.warn('Camera permission prompt notification:', permErr);
          this.showToast('Please tap or click "Allow" on the camera prompt to enable detection.');
        }
      }

      this.cameraSelect.innerHTML = '';
      if (videoDevices.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No camera found. Connect webcam or enable permissions.';
        this.cameraSelect.appendChild(opt);
        this.showToast('No cameras detected. Check permissions or cable.');
        return;
      }

      const savedDeviceId = localStorage.getItem('selected_webcam_id');
      let matchedId = null;
      let preferredRearId = null;
      let preferredUsbId = null;

      videoDevices.forEach((dev, idx) => {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        const rawLabel = (dev.label || '').toLowerCase();

        opt.textContent = this.formatCameraLabel(dev, idx);

        if (savedDeviceId && dev.deviceId === savedDeviceId) {
          opt.selected = true;
          matchedId = dev.deviceId;
        }

        if (rawLabel.includes('back') || rawLabel.includes('rear') || rawLabel.includes('environment')) {
          preferredRearId = dev.deviceId;
        }
        if (rawLabel.includes('usb')) {
          preferredUsbId = dev.deviceId;
        }

        this.cameraSelect.appendChild(opt);
      });

      if (this.currentStream) {
        const track = this.currentStream.getVideoTracks()[0];
        const settings = track ? track.getSettings() : null;
        if (settings && settings.deviceId) {
          this.cameraSelect.value = settings.deviceId;
        }
      } else {
        // Smart Default Selection:
        // 1. Saved selection
        // 2. On mobile: rear/back camera (for pointing down at paper)
        // 3. On desktop: external USB webcam if present
        // 4. First available device
        const targetId = matchedId ||
          (this.isMobile && preferredRearId ? preferredRearId :
            (!this.isMobile && preferredUsbId ? preferredUsbId : videoDevices[0].deviceId));

        this.cameraSelect.value = targetId;
        await this.switchCamera(targetId);
      }

      this.showToast(`Detected ${videoDevices.length} camera(s) ready.`);
    } catch (err) {
      console.error('Error discovering webcams:', err);
      this.showToast(`Camera scan error: ${err.message}`);
    } finally {
      this.btnRefreshCams.disabled = false;
      this.btnRefreshCams.textContent = 'Refresh';
    }
  }

  async switchCamera(deviceId) {
    if (!deviceId && !this.isMobile) return;
    this.showToast('Activating camera...');

    // 1. Always stop existing tracks first to release hardware lock
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
      this.currentStream = null;
    }

    const constraints = this.getRequestedConstraints(deviceId);

    // Cascading Multi-Device Fallback Sequence (Zero-Crash Guarantee across all phones/laptops)
    try {
      // Tier 1: Targeted deviceId with requested ideal resolution & fps
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.currentStream = stream;
      this.attachStreamToVideo(stream);
      if (deviceId) localStorage.setItem('selected_webcam_id', deviceId);
      this.showToast('Camera feed online.');
      return;
    } catch (tier1Err) {
      console.warn('Tier 1 constraint failed, trying Tier 2 (ideal resolution only):', tier1Err);
      try {
        // Tier 2: Target deviceId without strict fps
        const tier2Constraints = {
          video: {
            deviceId: { ideal: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        };
        const stream = await navigator.mediaDevices.getUserMedia(tier2Constraints);
        this.currentStream = stream;
        this.attachStreamToVideo(stream);
        if (deviceId) localStorage.setItem('selected_webcam_id', deviceId);
        this.showToast('Camera feed online.');
        return;
      } catch (tier2Err) {
        console.warn('Tier 2 failed, trying Tier 3 (bare deviceId):', tier2Err);
        try {
          // Tier 3: Bare deviceId without resolution constraints
          const tier3Constraints = {
            video: deviceId ? { deviceId: { exact: deviceId } } : true,
            audio: false
          };
          const stream = await navigator.mediaDevices.getUserMedia(tier3Constraints);
          this.currentStream = stream;
          this.attachStreamToVideo(stream);
          if (deviceId) localStorage.setItem('selected_webcam_id', deviceId);
          this.showToast('Camera feed online.');
          return;
        } catch (tier3Err) {
          console.warn('Tier 3 failed, trying Tier 4 (facingMode ideal):', tier3Err);
          try {
            // Tier 4: FacingMode fallback for mobile devices
            const tier4Constraints = {
              video: { facingMode: { ideal: this.isMobile ? 'environment' : 'user' } },
              audio: false
            };
            const stream = await navigator.mediaDevices.getUserMedia(tier4Constraints);
            this.currentStream = stream;
            this.attachStreamToVideo(stream);
            this.showToast('Camera feed online (fallback mode).');
            return;
          } catch (tier4Err) {
            console.warn('Tier 4 failed, attempting Tier 5 universal video fallback:', tier4Err);
            try {
              // Tier 5: Absolute fallback
              const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
              this.currentStream = stream;
              this.attachStreamToVideo(stream);
              this.showToast('Camera feed online.');
            } catch (finalErr) {
              this.showToast(`Unable to activate camera: ${finalErr.message}`);
            }
          }
        }
      }
    }
  }

  async flipCamera() {
    if (!this.cameraSelect || this.cameraSelect.options.length <= 1) {
      const curFacing = localStorage.getItem('camera_facing_pref') === 'user' ? 'environment' : 'user';
      localStorage.setItem('camera_facing_pref', curFacing);
      this.showToast(`Flipping to ${curFacing === 'environment' ? 'Rear' : 'Front'} camera...`);
      await this.switchCamera(null);
      return;
    }

    const currentIdx = this.cameraSelect.selectedIndex;
    const nextIdx = (currentIdx + 1) % this.cameraSelect.options.length;
    this.cameraSelect.selectedIndex = nextIdx;
    const nextDeviceId = this.cameraSelect.options[nextIdx].value;
    const labelTitle = this.cameraSelect.options[nextIdx].textContent.split(':')[0];
    this.showToast(`Switched to: ${labelTitle}`);
    await this.switchCamera(nextDeviceId);
  }

  attachStreamToVideo(stream) {
    // Mobile WebKit / Safari video autoplay compliance
    this.videoElement.setAttribute('playsinline', 'true');
    this.videoElement.setAttribute('webkit-playsinline', 'true');
    this.videoElement.muted = true;
    this.videoElement.srcObject = stream;

    const playPromise = this.videoElement.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          if (this.cameraTapPrompt) this.cameraTapPrompt.style.display = 'none';
        })
        .catch(err => {
          console.warn('Autoplay blocked by browser policy:', err);
          if (this.cameraTapPrompt) this.cameraTapPrompt.style.display = 'flex';
        });
    }

    const track = stream.getVideoTracks()[0];
    this.updateSupportedOptions(track);

    this.videoElement.onloadedmetadata = () => {
      this.updateActiveStreamMetadata();
    };
  }

  resumeVideoPlayback() {
    if (this.videoElement) {
      this.videoElement.muted = true;
      this.videoElement.play()
        .then(() => {
          if (this.cameraTapPrompt) this.cameraTapPrompt.style.display = 'none';
          this.showToast('Camera feed active.');
        })
        .catch(e => this.showToast(`Play error: ${e.message}`));
    }
  }

  /* Query actual hardware capabilities and populate ONLY supported resolutions & FPS */
  updateSupportedOptions(track) {
    if (!track) return;

    const caps = (typeof track.getCapabilities === 'function') ? track.getCapabilities() : {};
    const settings = (typeof track.getSettings === 'function') ? track.getSettings() : {};

    const maxW = (caps.width && caps.width.max) ? caps.width.max : (settings.width || 1920);
    const minW = (caps.width && caps.width.min) ? caps.width.min : 320;
    const maxH = (caps.height && caps.height.max) ? caps.height.max : (settings.height || 1080);
    const minH = (caps.height && caps.height.min) ? caps.height.min : 240;
    const maxFps = (caps.frameRate && caps.frameRate.max) ? Math.round(caps.frameRate.max) : (settings.frameRate ? Math.round(settings.frameRate) : 30);

    // List of candidate standard resolutions
    const CANDIDATES = [
      { label: '3840x2160 (4K UHD 16:9)', w: 3840, h: 2160, val: '3840x2160' },
      { label: '2560x1440 (2K QHD 16:9)', w: 2560, h: 1440, val: '2560x1440' },
      { label: '1920x1080 (1080p FHD 16:9)', w: 1920, h: 1080, val: '1920x1080' },
      { label: '1280x720 (720p HD 16:9)', w: 1280, h: 720, val: '1280x720' },
      { label: '1024x768 (XGA 4:3)', w: 1024, h: 768, val: '1024x768' },
      { label: '800x600 (SVGA 4:3)', w: 800, h: 600, val: '800x600' },
      { label: '640x480 (VGA 4:3)', w: 640, h: 480, val: '640x480' }
    ];

    // Filter to only what the camera sensor actually supports
    const supportedRes = CANDIDATES.filter(c => c.w <= maxW && c.h <= maxH && c.w >= minW && c.h >= minH);

    if (supportedRes.length === 0) {
      supportedRes.push({
        label: `${maxW}x${maxH} (Native Hardware)`,
        w: maxW,
        h: maxH,
        val: `${maxW}x${maxH}`
      });
    }

    const savedRes = localStorage.getItem('camera_res_pref');
    const curResVal = this.resSelect.value || savedRes;
    this.resSelect.innerHTML = '';
    let resMatched = false;

    supportedRes.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.val;
      opt.textContent = r.label;
      if (r.val === curResVal) {
        opt.selected = true;
        resMatched = true;
      }
      this.resSelect.appendChild(opt);
    });

    if (!resMatched) {
      const activeSettingVal = `${settings.width || supportedRes[0].w}x${settings.height || supportedRes[0].h}`;
      const found = Array.from(this.resSelect.options).find(o => o.value === activeSettingVal);
      if (found) {
        found.selected = true;
      } else if (this.resSelect.options.length > 0) {
        this.resSelect.options[0].selected = true;
      }
    }

    // Filter FPS candidates to what sensor actually supports
    const FPS_CANDIDATES = [
      { label: '60 FPS (High Speed)', fps: 60 },
      { label: '30 FPS (Standard)', fps: 30 },
      { label: '24 FPS (Cinematic)', fps: 24 },
      { label: '15 FPS (Low Light)', fps: 15 }
    ];

    const supportedFps = FPS_CANDIDATES.filter(f => f.fps <= maxFps);
    if (supportedFps.length === 0) {
      supportedFps.push({ label: `${maxFps} FPS (Hardware Max)`, fps: maxFps });
    }

    const savedFps = localStorage.getItem('camera_fps_pref');
    const curFpsVal = parseInt(this.fpsSelect.value || savedFps || '30', 10);
    this.fpsSelect.innerHTML = '';
    let fpsMatched = false;

    supportedFps.forEach(f => {
      const opt = document.createElement('option');
      opt.value = String(f.fps);
      opt.textContent = f.label;
      if (f.fps === curFpsVal) {
        opt.selected = true;
        fpsMatched = true;
      }
      this.fpsSelect.appendChild(opt);
    });

    if (!fpsMatched && this.fpsSelect.options.length > 0) {
      const opt30 = Array.from(this.fpsSelect.options).find(o => o.value === '30');
      if (opt30) opt30.selected = true;
      else this.fpsSelect.options[0].selected = true;
    }
  }

  updateActiveStreamMetadata() {
    if (!this.videoElement) return;
    const track = this.currentStream ? this.currentStream.getVideoTracks()[0] : null;
    const settings = (track && typeof track.getSettings === 'function') ? track.getSettings() : {};

    const actualW = this.videoElement.videoWidth || settings.width || 1280;
    const actualH = this.videoElement.videoHeight || settings.height || 720;
    const actualFps = settings.frameRate ? Math.round(settings.frameRate) : (parseInt(this.fpsSelect.value, 10) || 30);

    if (this.streamInfoBadge) {
      this.streamInfoBadge.textContent = `Feed: ${actualW}x${actualH} @ ${actualFps} FPS`;
      this.streamInfoBadge.classList.add('active-stream');
    }

    if (this.videoContainer) {
      this.videoContainer.style.aspectRatio = `${actualW} / ${actualH}`;
    }

    const prevW = this.canvas.width;
    const prevH = this.canvas.height;

    // Rescale existing spots proportionally to match new camera resolution
    if (this.spots.length > 0 && prevW > 0 && prevH > 0 && (prevW !== actualW || prevH !== actualH)) {
      const scaleX = actualW / prevW;
      const scaleY = actualH / prevH;
      this.spots.forEach(s => {
        if (s.box_2d && s.box_2d.length === 4) {
          const [ymin, xmin, ymax, xmax] = s.box_2d;
          s.x = Math.round((xmin / 1000.0) * actualW);
          s.y = Math.round((ymin / 1000.0) * actualH);
          s.width = Math.round(((xmax - xmin) / 1000.0) * actualW);
          s.height = Math.round(((ymax - ymin) / 1000.0) * actualH);
        } else {
          s.x = Math.round(s.x * scaleX);
          s.y = Math.round(s.y * scaleY);
          s.width = Math.round(s.width * scaleX);
          s.height = Math.round(s.height * scaleY);
          s.box_2d = [
            Math.round((s.y / actualH) * 1000),
            Math.round((s.x / actualW) * 1000),
            Math.round(((s.y + s.height) / actualH) * 1000),
            Math.round(((s.x + s.width) / actualW) * 1000)
          ];
        }
      });
    }

    this.canvas.width = actualW;
    this.canvas.height = actualH;

    // Reset baseline buffer so dimensions match
    this.baselineData = null;
    this.drawCanvas();

    setTimeout(() => {
      if (this.videoElement.videoWidth && (!this.baselineData || this.baselineData.width !== actualW)) {
        this.captureBaseline(false);
      }
    }, 800);
  }

  /* ----------------- Engine Mode & Spot Management ----------------- */
  setEngineMode(mode) {
    this.engineMode = mode;
    if (!this.txtEngine || !this.statusMarker) return;
    if (mode === 'c_dll') {
      this.txtEngine.textContent = 'C Engine: DLL Active';
      this.statusMarker.className = 'status-marker status-online';
    } else {
      this.txtEngine.textContent = 'Engine: Client Web Active';
      this.statusMarker.className = 'status-marker status-web';
    }
  }

  applySpotsData(rawSpots) {
    const curW = this.canvas.width || 1280;
    const curH = this.canvas.height || 720;
    this.spots = rawSpots.map((s, idx) => {
      if (s.box_2d && s.box_2d.length === 4) {
        const [ymin, xmin, ymax, xmax] = s.box_2d;
        return {
          id: s.id !== undefined ? s.id : idx,
          label: s.label || `Slot ${idx + 1}`,
          x: Math.round((xmin / 1000.0) * curW),
          y: Math.round((ymin / 1000.0) * curH),
          width: Math.round(((xmax - xmin) / 1000.0) * curW),
          height: Math.round(((ymax - ymin) / 1000.0) * curH),
          box_2d: s.box_2d,
          norm_x: xmin / 1000.0,
          norm_y: ymin / 1000.0,
          norm_w: (xmax - xmin) / 1000.0,
          norm_h: (ymax - ymin) / 1000.0
        };
      }
      if (s.norm_x !== undefined) {
        return {
          id: s.id !== undefined ? s.id : idx,
          label: s.label || `Slot ${idx + 1}`,
          x: Math.round(s.norm_x * curW),
          y: Math.round(s.norm_y * curH),
          width: Math.round(s.norm_w * curW),
          height: Math.round(s.norm_h * curH),
          box_2d: [
            Math.round(s.norm_y * 1000),
            Math.round(s.norm_x * 1000),
            Math.round((s.norm_y + s.norm_h) * 1000),
            Math.round((s.norm_x + s.norm_w) * 1000)
          ],
          norm_x: s.norm_x,
          norm_y: s.norm_y,
          norm_w: s.norm_w,
          norm_h: s.norm_h
        };
      }
      return {
        id: s.id !== undefined ? s.id : idx,
        label: s.label || `Slot ${idx + 1}`,
        x: s.x || 0,
        y: s.y || 0,
        width: s.width || 100,
        height: s.height || 100,
        box_2d: s.box_2d || [0, 0, 100, 100]
      };
    });
    this.drawCanvas();
    if (this.videoElement && this.videoElement.videoWidth && !this.baselineData) {
      setTimeout(() => this.captureBaseline(false), 800);
    }
  }

  /* ----------------- Load & Save Spots ----------------- */
  async loadSavedSpots() {
    try {
      const res = await fetch('/api/spots', { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      if (data.success && data.spots && data.spots.length > 0) {
        this.applySpotsData(data.spots);
        this.setEngineMode('c_dll');
        return;
      }
    } catch (e) {
      console.log('Local API /api/spots unreachable, using localStorage fallback.');
    }

    // LocalStorage Fallback (Standalone / Vercel Web Mode)
    const localSpots = localStorage.getItem('smart_parking_spots');
    if (localSpots) {
      try {
        const parsed = JSON.parse(localSpots);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.applySpotsData(parsed);
          this.setEngineMode('standalone');
        }
      } catch (err) {
        console.warn('Error reading local spots:', err);
      }
    }
  }

  /* ----------------- Google AI Studio Vision with Real-time Progress Bar & Scene Insight ----------------- */
  showSceneInsight(text) {
    if (this.aiSceneBox && this.aiSceneText && text) {
      this.aiSceneText.textContent = text;
      this.aiSceneBox.style.display = 'block';
    }
  }

  hideSceneInsight() {
    if (this.aiSceneBox) {
      this.aiSceneBox.style.display = 'none';
    }
  }

  startAIProgress() {
    this.hideSceneInsight();
    this.btnAutoDetect.disabled = true;
    this.btnAutoDetect.classList.remove('cooldown', 'success-flash');
    this.btnAutoDetect.classList.add('in-progress');

    const startTime = Date.now();
    let currentPct = 12;

    if (this.detectProgressFill) {
      this.detectProgressFill.style.transition = 'width 0.15s ease-out';
      this.detectProgressFill.style.width = '12%';
    }
    if (this.detectProgressText) {
      this.detectProgressText.textContent = 'Capturing snapshot... 12% (0.0s)';
    }

    clearInterval(this.progressInterval);
    this.progressInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // Smooth progress advancement curve
      if (currentPct < 32) {
        currentPct += 4;
      } else if (currentPct < 68) {
        currentPct += 1.8;
      } else if (currentPct < 92) {
        currentPct += 0.4;
      }

      const displayPct = Math.min(94, Math.round(currentPct));
      let stageText = 'Analyzing paper spots...';
      if (displayPct < 25) {
        stageText = 'Capturing snapshot...';
      } else if (displayPct < 45) {
        stageText = 'Enhancing pen strokes...';
      } else if (displayPct < 85) {
        stageText = 'AI COMPUTER VISION';
      } else {
        stageText = 'Calibrating parking slots...';
      }

      if (this.detectProgressFill) {
        this.detectProgressFill.style.width = `${displayPct}%`;
      }
      if (this.detectProgressText) {
        this.detectProgressText.textContent = `${stageText} ${displayPct}% (${elapsed}s)`;
      }
    }, 100);

    return startTime;
  }

  finishAIProgressSuccess(count, elapsedSec) {
    clearInterval(this.progressInterval);
    if (this.detectProgressFill) {
      this.detectProgressFill.style.transition = 'width 0.2s ease-out';
      this.detectProgressFill.style.width = '100%';
    }
    this.btnAutoDetect.classList.remove('in-progress');
    this.btnAutoDetect.classList.add('success-flash');

    if (this.detectProgressText) {
      this.detectProgressText.textContent = `✓ Found ${count} Spots! 100% (${elapsedSec}s)`;
    }

    setTimeout(() => {
      this.startCooldown(4);
    }, 850);
  }

  finishAIProgressError(msg) {
    clearInterval(this.progressInterval);
    if (this.detectProgressFill) {
      this.detectProgressFill.style.transition = 'width 0.15s ease-out';
      this.detectProgressFill.style.width = '100%';
    }
    this.btnAutoDetect.classList.remove('in-progress');
    if (this.detectProgressText) {
      this.detectProgressText.textContent = msg || 'Scan Finished';
    }

    setTimeout(() => {
      this.startCooldown(3);
    }, 1200);
  }

  async autoDetectPaperSpots() {
    if (!this.videoElement || !this.videoElement.videoWidth) {
      this.showToast('Webcam not active yet. Select webcam or click Refresh.');
      return;
    }

    const reqStart = this.startAIProgress();
    const camW = this.canvas.width || 1280;
    const camH = this.canvas.height || 720;
    const aspect = (this.videoElement.videoWidth && this.videoElement.videoHeight)
      ? (this.videoElement.videoWidth / this.videoElement.videoHeight)
      : (camW / camH);

    let targetW = 960;
    if (camW <= 640) targetW = 640;
    else if (camW >= 1920) targetW = 1024;
    const targetH = Math.round(targetW / aspect);

    const snap = document.createElement('canvas');
    snap.width = targetW;
    snap.height = targetH;
    const snapCtx = snap.getContext('2d');
    snapCtx.drawImage(this.videoElement, 0, 0, targetW, targetH);
    const base64Img = snap.toDataURL('image/jpeg', 0.85);

    try {
      const res = await fetch('/api/spots/detect_gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Img,
          camera_width: camW,
          camera_height: camH
        }),
        signal: AbortSignal.timeout(24000)
      });
      const data = await res.json();
      if (data.success && data.spots && data.spots.length > 0) {
        const totalElapsed = ((Date.now() - reqStart) / 1000).toFixed(1);
        this.hideSceneInsight();
        this.applySpotsData(data.spots);
        localStorage.setItem('smart_parking_spots', JSON.stringify(this.spots));
        this.setEngineMode('c_dll');

        this.drawCanvas();
        this.showToast(`Gemini 3.5 Flash-Lite detected ${this.spots.length} slots in ${data.latency_sec || totalElapsed}s.`);
        setTimeout(() => this.captureBaseline(false), 500);
        this.finishAIProgressSuccess(this.spots.length, data.latency_sec || totalElapsed);
        return;
      } else {
        const sceneMsg = data.scene_description || data.message || '';
        if (sceneMsg && (!this.chkSceneDescribe || this.chkSceneDescribe.checked)) {
          this.showSceneInsight(sceneMsg);
          this.showToast(sceneMsg);
        } else {
          this.showToast('No paper parking slots identified. Ensure boxes are clearly drawn.');
        }
        this.finishAIProgressError('No Spots Detected');
        return;
      }
    } catch (backendErr) {
      console.log('Local backend not answering, falling back to direct Google AI Studio API:', backendErr.message);
    }

    // Direct Client-Side Fallback for Standalone Web & Vercel
    await this.detectSpotsViaGoogleAIStudio(base64Img, camW, camH, reqStart);
  }

  async detectSpotsViaGoogleAIStudio(base64Img, camW, camH, reqStart) {
    const rawB64 = base64Img.replace(/^data:image\/[a-z]+;base64,/, '');
    const apiKey = localStorage.getItem('google_ai_studio_api_key') || (this.inputGeminiKey ? this.inputGeminiKey.value.trim() : '');

    if (!apiKey) {
      this.finishAIProgressError('API Key Required');
      this.showToast('Please enter your Google AI Studio API key (from aistudio.google.com) to auto-detect.');
      return;
    }

    const prompt = `You are an expert computer vision model specialized in overhead camera analysis of paper drawings and tabletop environments.
Task 1: Detect drawn parking slots, stalls, or rectangular parking bays drawn on paper.
Task 2: If parking spots are found, provide their normalized 2D bounding boxes.
Task 3: Always provide a concise 1-2 sentence description of what is actually visible in the camera scene. If no parking spots are detected, clearly explain what the camera is seeing instead (e.g. tabletop objects, blank paper, laptop, keyboard, hand, poor lighting) and why no parking boxes could be identified.

Return a JSON object with this exact structure:
{
  "spots": [
    {"label": "Slot 1", "box_2d": [ymin, xmin, ymax, xmax]}
  ],
  "scene_description": "1-2 sentence explanation of what is visible in the scene"
}
Note: 'box_2d' coordinates must be integers normalized from 0 to 1000. If no parking spots are drawn or visible, 'spots' must be an empty array []. Return valid JSON only.`;

    const payload = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: rawB64 } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 600,
        response_mime_type: 'application/json'
      }
    };

    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'];
    let lastErr = '';
    let detectedSceneDesc = '';

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(22000)
        });

        if (resp.ok) {
          const resData = await resp.json();
          const candidate = resData.candidates && resData.candidates[0];
          const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] ? candidate.content.parts[0].text : '';
          if (text) {
            let parsed = null;
            try {
              parsed = JSON.parse(text.trim());
            } catch (jsonErr) {
              const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
              parsed = JSON.parse(cleaned);
            }

            let spotsArray = [];
            if (parsed && typeof parsed === 'object') {
              if (parsed.scene_description) {
                detectedSceneDesc = String(parsed.scene_description).trim();
              }
              if (Array.isArray(parsed.spots)) {
                spotsArray = parsed.spots;
              } else if (Array.isArray(parsed)) {
                spotsArray = parsed;
              } else {
                for (const [k, v] of Object.entries(parsed)) {
                  if (Array.isArray(v) && k !== 'scene_description') {
                    spotsArray = v;
                    break;
                  }
                }
              }
            }

            if (spotsArray && spotsArray.length > 0) {
              const elapsed = ((Date.now() - reqStart) / 1000).toFixed(1);
              this.hideSceneInsight();
              this.applySpotsData(spotsArray);
              localStorage.setItem('smart_parking_spots', JSON.stringify(this.spots));
              this.setEngineMode('standalone');

              this.drawCanvas();
              this.showToast(`Gemini 3.5 Flash-Lite detected ${this.spots.length} slots in ${elapsed}s.`);
              setTimeout(() => this.captureBaseline(false), 500);
              this.finishAIProgressSuccess(this.spots.length, elapsed);
              return;
            }
          }
        } else {
          const errText = await resp.text();
          lastErr = `${model}: HTTP ${resp.status} - ${errText.slice(0, 100)}`;
        }
      } catch (err) {
        lastErr = `${model}: ${err.message}`;
      }
    }

    const finalSceneMsg = detectedSceneDesc || lastErr || 'No parking slots identified. Ensure pen boxes are clear.';
    if (detectedSceneDesc && (!this.chkSceneDescribe || this.chkSceneDescribe.checked)) {
      this.showSceneInsight(detectedSceneDesc);
      this.showToast(detectedSceneDesc);
    } else {
      this.showToast(`Google AI Studio scan finished: ${finalSceneMsg}`);
    }
    this.finishAIProgressError('No Spots Detected');
  }

  startCooldown(seconds = 4) {
    clearInterval(this.progressInterval);
    let remaining = seconds;
    this.btnAutoDetect.disabled = true;
    this.btnAutoDetect.classList.remove('in-progress', 'success-flash');
    this.btnAutoDetect.classList.add('cooldown');

    if (this.detectProgressFill) {
      this.detectProgressFill.style.transition = 'none';
      this.detectProgressFill.style.width = '0%';
    }
    if (this.detectProgressText) {
      this.detectProgressText.textContent = `Cooldown (${remaining}s)...`;
    }

    const timer = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        if (this.detectProgressText) {
          this.detectProgressText.textContent = `Cooldown (${remaining}s)...`;
        }
      } else {
        clearInterval(timer);
        this.btnAutoDetect.disabled = false;
        this.btnAutoDetect.classList.remove('cooldown');
        if (this.detectProgressFill) {
          this.detectProgressFill.style.width = '0%';
        }
        if (this.detectProgressText) {
          this.detectProgressText.textContent = 'Auto-Detect Paper Spots (Gemini 3.5 Flash-Lite)';
        }
      }
    }, 1000);
  }

  captureBaseline(notifyUser = true) {
    if (!this.videoElement || !this.videoElement.videoWidth) {
      if (notifyUser) this.showToast('Webcam feed unavailable.');
      return;
    }

    const baselineCanvas = document.createElement('canvas');
    baselineCanvas.width = this.videoElement.videoWidth;
    baselineCanvas.height = this.videoElement.videoHeight;
    const bCtx = baselineCanvas.getContext('2d');
    bCtx.drawImage(this.videoElement, 0, 0, baselineCanvas.width, baselineCanvas.height);
    this.baselineData = bCtx.getImageData(0, 0, baselineCanvas.width, baselineCanvas.height);

    if (notifyUser) {
      this.showToast('Empty paper baseline captured. Covering any slot will now turn it red.');
    } else {
      console.log('Auto-baseline captured successfully.');
    }
  }

  async clearAllSpots() {
    this.spots = [];
    this.baselineData = null;
    this.clientOccupancyDurations = {};
    this.clientRevenue = 0.0;
    localStorage.removeItem('smart_parking_spots');
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    try {
      await fetch('/api/spots/clear', { method: 'POST', signal: AbortSignal.timeout(1500) });
    } catch (e) { }

    this.showToast('All parking spots cleared. Feed is clean.');
    this.pollTelemetry();
  }

  /* ----------------- High-Accuracy Optical Occupancy Detection ----------------- */
  startTrackingLoop() {
    const render = () => {
      if (!this.isEditing) {
        this.drawCanvas();
      }
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    setInterval(() => this.processOccupancy(), 380);
  }

  processOccupancy() {
    if (this.spots.length === 0 || !this.videoElement || !this.videoElement.videoWidth) {
      this.pollTelemetry();
      return;
    }

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = this.videoElement.videoWidth;
    sampleCanvas.height = this.videoElement.videoHeight;
    const sCtx = sampleCanvas.getContext('2d');
    sCtx.drawImage(this.videoElement, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const currData = sCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);

    if (!this.baselineData) {
      this.baselineData = currData;
    }

    const states = [];

    this.spots.forEach(slot => {
      const result = this.calculateSpotOccupancy(currData, slot);
      slot.is_occupied = result.isOccupied;
      slot.changePct = result.changePct;
      states.push({ id: slot.id, is_occupied: result.isOccupied });
    });

    fetch('/api/spots/update_states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ states: states }),
      signal: AbortSignal.timeout(1500)
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          this.setEngineMode('c_dll');
          this.updateTelemetryUI(data);
        } else {
          this.updateClientSideTelemetry(states);
        }
      })
      .catch(() => {
        this.updateClientSideTelemetry(states);
      });
  }

  updateClientSideTelemetry(states) {
    this.setEngineMode('standalone');
    const now = Date.now();
    let occupiedCount = 0;
    let nearestSlotId = -1;

    const slotsData = this.spots.map((slot) => {
      const isOcc = Boolean(slot.is_occupied);
      if (isOcc) {
        occupiedCount++;
        if (!this.clientOccupancyDurations[slot.id]) {
          this.clientOccupancyDurations[slot.id] = { start: now };
        }
      } else {
        if (nearestSlotId === -1) nearestSlotId = slot.id;
        if (this.clientOccupancyDurations[slot.id]) {
          const sessionSec = (now - this.clientOccupancyDurations[slot.id].start) / 1000;
          this.clientRevenue += (sessionSec / 60) * 0.0833;
          delete this.clientOccupancyDurations[slot.id];
        }
      }

      const activeDur = (isOcc && this.clientOccupancyDurations[slot.id])
        ? (now - this.clientOccupancyDurations[slot.id].start) / 1000
        : 0;

      return {
        id: slot.id,
        label: slot.label,
        is_occupied: isOcc,
        current_duration: activeDur
      };
    });

    let activeOngoingRevenue = 0;
    Object.values(this.clientOccupancyDurations).forEach(item => {
      const sec = (now - item.start) / 1000;
      activeOngoingRevenue += (sec / 60) * 0.0833;
    });

    const totalSlots = this.spots.length;
    const availableCount = totalSlots - occupiedCount;
    const pct = totalSlots > 0 ? (occupiedCount / totalSlots) * 100 : 0;

    this.updateTelemetryUI({
      total_slots: totalSlots,
      occupied_count: occupiedCount,
      available_count: availableCount,
      occupancy_rate: pct,
      total_revenue: this.clientRevenue + activeOngoingRevenue,
      nearest_slot: nearestSlotId,
      slots: slotsData
    });
  }

  calculateSpotOccupancy(currData, slot) {
    const scaleX = currData.width / (this.canvas.width || currData.width);
    const scaleY = currData.height / (this.canvas.height || currData.height);

    const insetX = slot.width * 0.10;
    const insetY = slot.height * 0.10;

    const startX = Math.max(0, Math.min(currData.width - 1, Math.round((slot.x + insetX) * scaleX)));
    const startY = Math.max(0, Math.min(currData.height - 1, Math.round((slot.y + insetY) * scaleY)));
    const endX = Math.max(0, Math.min(currData.width, Math.round((slot.x + slot.width - insetX) * scaleX)));
    const endY = Math.max(0, Math.min(currData.height, Math.round((slot.y + slot.height - insetY) * scaleY)));

    const areaW = endX - startX;
    const areaH = endY - startY;
    if (areaW <= 4 || areaH <= 4) return { isOccupied: false, changePct: 0 };

    let diffPixels = 0;
    let totalSampled = 0;
    let currLumaSum = 0;
    let baseLumaSum = 0;

    const step = 2;
    const hasBaseline = this.baselineData && this.baselineData.data.length === currData.data.length;

    for (let y = startY; y < endY; y += step) {
      for (let x = startX; x < endX; x += step) {
        const idx = (y * currData.width + x) * 4;
        const cr = currData.data[idx];
        const cg = currData.data[idx + 1];
        const cb = currData.data[idx + 2];
        const cLuma = 0.299 * cr + 0.587 * cg + 0.114 * cb;
        currLumaSum += cLuma;

        if (hasBaseline) {
          const br = this.baselineData.data[idx];
          const bg = this.baselineData.data[idx + 1];
          const bb = this.baselineData.data[idx + 2];
          const bLuma = 0.299 * br + 0.587 * bg + 0.114 * bb;
          baseLumaSum += bLuma;

          const dr = Math.abs(cr - br);
          const dg = Math.abs(cg - bg);
          const db = Math.abs(cb - bb);
          const delta = (dr + dg + db) / 3;

          if (delta > 18) {
            diffPixels++;
          }
        }
        totalSampled++;
      }
    }

    if (totalSampled === 0) return { isOccupied: false, changePct: 0 };

    const diffRatio = diffPixels / totalSampled;
    const changePct = Math.round(diffRatio * 100);

    let isOccupied = false;

    if (hasBaseline) {
      const avgCurrLuma = currLumaSum / totalSampled;
      const avgBaseLuma = baseLumaSum / totalSampled;
      const lumaDrop = avgBaseLuma - avgCurrLuma;
      isOccupied = (diffRatio >= 0.08) || (lumaDrop > 15);
    } else {
      const avgCurrLuma = currLumaSum / totalSampled;
      isOccupied = avgCurrLuma < 125;
    }

    return { isOccupied, changePct };
  }

  async pollTelemetry() {
    try {
      const res = await fetch('/api/status', { signal: AbortSignal.timeout(1500) });
      if (!res.ok) throw new Error('Status not ok');
      const data = await res.json();
      this.setEngineMode('c_dll');
      this.updateTelemetryUI(data);
    } catch (e) {
      if (this.spots.length === 0) {
        this.updateTelemetryUI({
          total_slots: 0,
          available_count: 0,
          occupied_count: 0,
          total_revenue: 0,
          occupancy_rate: 0,
          nearest_slot: -1,
          slots: []
        });
      }
    }
  }

  updateTelemetryUI(data) {
    this.valTotal.textContent = data.total_slots || 0;
    this.valAvailable.textContent = data.available_count || 0;
    this.valOccupied.textContent = data.occupied_count || 0;
    this.valRevenue.textContent = `INR ${(data.total_revenue || 0).toFixed(2)}`;

    const pct = data.occupancy_rate || 0;
    this.valPct.textContent = `${pct.toFixed(0)}%`;
    this.occupancyFill.style.width = `${pct}%`;

    if (data.nearest_slot !== -1 && data.slots && data.slots.length > 0) {
      const slot = data.slots.find(s => s.id === data.nearest_slot);
      this.badgeNearest.textContent = slot ? slot.label : `Slot ${data.nearest_slot + 1}`;
    } else {
      this.badgeNearest.textContent = (data.total_slots === 0) ? 'None' : 'Full';
    }

    this.renderSlotsList(data.slots || []);
  }

  renderSlotsList(slots) {
    if (!slots || slots.length === 0) {
      this.slotsList.innerHTML = '<div class="empty-state">No parking spots active on screen. Point camera at drawn paper boxes and click "Auto-Detect Paper Spots".</div>';
      return;
    }

    this.slotsList.innerHTML = '';
    slots.forEach(s => {
      const row = document.createElement('div');
      row.className = 'slot-item';
      const isOcc = s.is_occupied;

      const mins = Math.floor((s.current_duration || 0) / 60);
      const secs = Math.floor((s.current_duration || 0) % 60);
      const timeStr = isOcc ? `${mins}m ${secs}s` : 'Available';

      row.innerHTML = `
        <strong>${s.label}</strong>
        <span>${timeStr}</span>
        <span class="slot-pill ${isOcc ? 'pill-red' : 'pill-green'}">
          ${isOcc ? 'OCCUPIED' : 'AVAILABLE'}
        </span>
      `;
      this.slotsList.appendChild(row);
    });
  }

  /* ----------------- Canvas Rendering & Box Editing ----------------- */
  initCanvas() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));

    // Universal Mobile Touch Support (iOS Safari, Android Chrome, Tablets)
    this.canvas.addEventListener('touchstart', (e) => {
      if (this.isEditing) e.preventDefault();
      this.onMouseDown(e);
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (this.isEditing) e.preventDefault();
      this.onMouseMove(e);
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      if (this.isEditing) e.preventDefault();
      this.onMouseUp(e);
    }, { passive: false });

    this.canvas.addEventListener('touchcancel', (e) => {
      if (this.isEditing) e.preventDefault();
      this.onMouseUp(e);
    }, { passive: false });
  }

  drawCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.spots.forEach(s => {
      const isOcc = Boolean(s.is_occupied);

      if (this.isEditing) {
        this.ctx.strokeStyle = '#388bfd';
        this.ctx.fillStyle = 'rgba(56, 139, 253, 0.2)';
      } else if (isOcc) {
        this.ctx.strokeStyle = '#f85149';
        this.ctx.fillStyle = 'rgba(248, 81, 73, 0.25)';
      } else {
        this.ctx.strokeStyle = '#3fb950';
        this.ctx.fillStyle = 'rgba(63, 185, 80, 0.15)';
      }

      this.ctx.lineWidth = 3;
      this.ctx.fillRect(s.x, s.y, s.width, s.height);
      this.ctx.strokeRect(s.x, s.y, s.width, s.height);

      const pctText = s.changePct !== undefined ? ` (${s.changePct}%)` : '';
      const badgeText = `${s.label}${pctText}`;

      this.ctx.fillStyle = '#0d1117';
      this.ctx.fillRect(s.x, s.y - 22, 105, 22);

      this.ctx.fillStyle = isOcc ? '#f85149' : (this.isEditing ? '#58a6ff' : '#3fb950');
      this.ctx.font = 'bold 12px "JetBrains Mono", monospace';
      this.ctx.fillText(badgeText, s.x + 6, s.y - 6);
    });
  }

  toggleEditMode() {
    this.isEditing = !this.isEditing;
    if (this.isEditing) {
      this.videoContainer.classList.add('editing');
      this.btnToggleEdit.classList.add('active');
      this.btnToggleEdit.textContent = 'Done Editing';
      this.btnSaveBoxes.style.display = 'inline-block';
      this.drawCanvas();
      this.showToast('Click and drag on the camera feed to reposition or draw new parking spots.');
    } else {
      this.videoContainer.classList.remove('editing');
      this.btnToggleEdit.classList.remove('active');
      this.btnToggleEdit.textContent = 'Draw / Adjust Boxes';
      this.btnSaveBoxes.style.display = 'none';
      this.drawCanvas();
      setTimeout(() => this.captureBaseline(false), 500);
    }
  }

  getCoords(e) {
    const r = this.canvas.getBoundingClientRect();
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    const clientX = touch ? touch.clientX : (e.clientX !== undefined ? e.clientX : 0);
    const clientY = touch ? touch.clientY : (e.clientY !== undefined ? e.clientY : 0);
    return {
      x: Math.round((clientX - r.left) * (this.canvas.width / r.width)),
      y: Math.round((clientY - r.top) * (this.canvas.height / r.height))
    };
  }

  onMouseDown(e) {
    if (!this.isEditing) return;
    const { x, y } = this.getCoords(e);

    for (let i = this.spots.length - 1; i >= 0; i--) {
      const s = this.spots[i];
      if (x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height) {
        this.activeDrag = s;
        this.dragStart = { ox: x - s.x, oy: y - s.y };
        return;
      }
    }
    this.newBoxStart = { x, y };
  }

  onMouseMove(e) {
    if (!this.isEditing) return;
    const { x, y } = this.getCoords(e);

    if (this.activeDrag && this.dragStart) {
      this.activeDrag.x = Math.max(0, Math.min(this.canvas.width - this.activeDrag.width, x - this.dragStart.ox));
      this.activeDrag.y = Math.max(0, Math.min(this.canvas.height - this.activeDrag.height, y - this.dragStart.oy));
      this.drawCanvas();
    } else if (this.newBoxStart) {
      this.drawCanvas();
      this.ctx.strokeStyle = '#388bfd';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(this.newBoxStart.x, this.newBoxStart.y, x - this.newBoxStart.x, y - this.newBoxStart.y);
    }
  }

  onMouseUp(e) {
    if (!this.isEditing) return;
    const { x, y } = this.getCoords(e);

    if (this.newBoxStart) {
      const rw = Math.abs(x - this.newBoxStart.x);
      const rh = Math.abs(y - this.newBoxStart.y);
      if (rw > 35 && rh > 35) {
        const id = this.spots.length;
        this.spots.push({
          id: id,
          label: `Slot ${id + 1}`,
          x: Math.min(this.newBoxStart.x, x),
          y: Math.min(this.newBoxStart.y, y),
          width: rw,
          height: rh
        });
        this.showToast(`Created Slot ${id + 1}`);
      }
      this.newBoxStart = null;
      this.drawCanvas();
    }
    this.activeDrag = null;
    this.dragStart = null;
  }

  async saveBoxes() {
    const curW = this.canvas.width || 1280;
    const curH = this.canvas.height || 720;
    const spotsToSave = this.spots.map(s => ({
      id: s.id,
      label: s.label,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      box_2d: s.box_2d || [
        Math.round((s.y / curH) * 1000),
        Math.round((s.x / curW) * 1000),
        Math.round(((s.y + s.height) / curH) * 1000),
        Math.round(((s.x + s.width) / curW) * 1000)
      ],
      norm_x: Number((s.x / curW).toFixed(4)),
      norm_y: Number((s.y / curH).toFixed(4)),
      norm_w: Number((s.width / curW).toFixed(4)),
      norm_h: Number((s.height / curH).toFixed(4))
    }));

    // Always persist to localStorage for standalone and Vercel hosting
    localStorage.setItem('smart_parking_spots', JSON.stringify(spotsToSave));

    try {
      await fetch('/api/spots/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spots: spotsToSave }),
        signal: AbortSignal.timeout(2000)
      });
    } catch (e) {
      console.log('Saved to browser localStorage.');
    }

    this.showToast('Parking box adjustments saved.');
    this.toggleEditMode();
  }

  /* ----------------- Google AI Studio API Key ----------------- */
  async checkKeyStatus() {
    const localKey = localStorage.getItem('google_ai_studio_api_key');
    if (localKey && localKey.length > 8) {
      this.inputGeminiKey.placeholder = `Active (${localKey.slice(0, 4)}...${localKey.slice(-4)})`;
    }

    try {
      const res = await fetch('/api/key', { signal: AbortSignal.timeout(1500) });
      const data = await res.json();
      if (data.has_key) {
        this.inputGeminiKey.placeholder = `Active (${data.masked_key})`;
      }
    } catch (e) { }
  }

  async saveGeminiKey() {
    const key = this.inputGeminiKey.value.trim();
    if (!key) {
      this.showToast('Please enter your Google AI Studio API key.');
      return;
    }

    localStorage.setItem('google_ai_studio_api_key', key);

    try {
      await fetch('/api/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key }),
        signal: AbortSignal.timeout(2000)
      });
    } catch (e) { }

    this.showToast('Google AI Studio API key saved.');
    this.inputGeminiKey.value = '';
    this.checkKeyStatus();
  }

  showToast(msg) {
    this.toast.textContent = msg;
    this.toast.style.display = 'block';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.style.display = 'none';
    }, 3200);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SmartParkingApp();
});
