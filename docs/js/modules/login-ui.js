/**
 * Module Description: Terminal Login & Security Lock Screen Controller
 * Governs terminal authentication, physical and touch numpad input buffers,
 * optical QR camera stream lifecycle, dual-engine QR decoding (native BarcodeDetector
 * with jsQR software fallback), and administrative control visibility.
 */

import { DB } from "./db.js";
import { Session } from "./session.js";

export const LoginUI = {
  pinBuffer: "",
  elements: {},
  callbacks: {},
  mediaStream: null,
  scanTimer: null,
  isScanningActive: false,
  isProcessingScan: false,
  barcodeDetector: null,
  captureCanvas: null,
  captureCtx: null,
  boundKeyDownHandler: null,

  /**
   * Initializes DOM elements, binds input events, and starts camera scanner
   * @param {Object} callbacks - Hook methods { onLoginSuccess, onLock }
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    // Cache DOM selections
    this.elements = {
      screen: document.getElementById("login-screen"),
      pinInput: document.getElementById("login-pin-input"),
      errorMsg: document.getElementById("login-error-msg"),
      btnClear: document.getElementById("btn-pin-clear"),
      btnSubmit: document.getElementById("btn-pin-submit"),
      txtActiveCashier: document.getElementById("txt-active-cashier"),
      btnLockTerminal: document.getElementById("btn-lock-terminal"),
      btnOpenAdmin: document.getElementById("btn-open-admin"),
      numButtons: document.querySelectorAll(".btn-num[data-val]"),

      // Optical Scanner Viewport
      cameraWrap: document.getElementById("camera-scanner-wrap"),
      videoPreview: document.getElementById("login-camera-preview"),
      cameraStatus: document.getElementById("camera-status-pill")
    };

    // Prepare offscreen canvas for frame capture and software decoding
    this.captureCanvas = document.createElement("canvas");
    this.captureCtx = this.captureCanvas.getContext("2d", { willReadFrequently: true });

    // Initialize native offline BarcodeDetector if supported by the browser engine
    if ("BarcodeDetector" in window) {
      try {
        this.barcodeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch (err) {
        console.warn("[LoginUI] Native BarcodeDetector initialization warning:", err);
        this.barcodeDetector = null;
      }
    }

    // Attach virtual numpad click listeners
    if (this.elements.numButtons) {
      this.elements.numButtons.forEach((btn) => {
        btn.onclick = () => this.appendDigit(btn.dataset.val);
      });
    }

    // Attach action button listeners
    if (this.elements.btnClear) {
      this.elements.btnClear.onclick = () => this.clearPin();
    }

    if (this.elements.btnSubmit) {
      this.elements.btnSubmit.onclick = () => this.submitLogin();
    }

    if (this.elements.btnLockTerminal) {
      this.elements.btnLockTerminal.onclick = () => this.lockTerminal();
    }

    // Bind physical keyboard events cleanly without stacking duplicate listeners
    if (this.boundKeyDownHandler) {
      window.removeEventListener("keydown", this.boundKeyDownHandler);
    }
    this.boundKeyDownHandler = (e) => this.handleKeyDown(e);
    window.addEventListener("keydown", this.boundKeyDownHandler);

    // Start background optical QR scanner loop
    this.startCameraScanner();

    // Initial focus on PIN field
    if (this.elements.pinInput) {
      this.elements.pinInput.focus();
    }
  },

  /**
   * Handles keyboard keystrokes when terminal is locked
   * @param {KeyboardEvent} e
   */
  handleKeyDown(e) {
    if (this.elements.screen && !this.elements.screen.classList.contains("hidden")) {
      if (e.key >= "0" && e.key <= "9") {
        this.appendDigit(e.key);
      } else if (e.key === "Backspace") {
        this.pinBuffer = this.pinBuffer.slice(0, -1);
        this.updateDisplay();
      } else if (e.key === "Enter") {
        this.submitLogin();
      } else if (e.key === "Escape") {
        this.clearPin();
      }
    }
  },

  /**
   * Activates device camera and binds video track to preview element
   */
  async startCameraScanner() {
    if (!this.elements.videoPreview || this.isScanningActive) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.updateCameraStatus("Camera unsupported (use PIN)", "#f59e0b");
      return;
    }

    try {
      const constraints = {
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.elements.videoPreview.srcObject = this.mediaStream;
      
      try {
        await this.elements.videoPreview.play();
      } catch (playErr) {
        console.warn("[LoginUI] Autoplay blocked or deferred:", playErr.message);
      }

      this.isScanningActive = true;
      this.updateCameraStatus("Point badge QR to camera", "#cbd5e1");
      this.runScannerLoop();
    } catch (err) {
      console.warn("[LoginUI] Unable to access camera hardware:", err.message);
      this.updateCameraStatus("Camera unavailable (use PIN)", "#f59e0b");
    }
  },

  /**
   * Continuous frame analysis loop with dual-engine fallback (Native -> jsQR)
   */
  runScannerLoop() {
    if (!this.isScanningActive) return;

    this.scanTimer = setInterval(async () => {
      if (this.isProcessingScan) return;
      const video = this.elements.videoPreview;
      if (!video || video.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) {
        return;
      }

      let detectedCode = null;

      // 1. Attempt native hardware-accelerated BarcodeDetector
      if (this.barcodeDetector) {
        try {
          const barcodes = await this.barcodeDetector.detect(video);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            detectedCode = barcodes[0].rawValue.trim();
          }
        } catch (detectorErr) {
          // Fall through to jsQR software decoder
        }
      }

      // 2. Fallback to jsQR software decoder if native detection yielded nothing
      if (!detectedCode && typeof window.jsQR === "function") {
        try {
          const videoWidth = video.videoWidth;
          const videoHeight = video.videoHeight;

          if (videoWidth > 0 && videoHeight > 0) {
            if (this.captureCanvas.width !== videoWidth || this.captureCanvas.height !== videoHeight) {
              this.captureCanvas.width = videoWidth;
              this.captureCanvas.height = videoHeight;
            }

            this.captureCtx.drawImage(video, 0, 0, videoWidth, videoHeight);
            const imgData = this.captureCtx.getImageData(0, 0, videoWidth, videoHeight);

            const qrResult = window.jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: "attemptBoth"
            });

            if (qrResult && qrResult.data) {
              detectedCode = qrResult.data.trim();
            }
          }
        } catch (jsQrErr) {
          // Frame skip during rapid movement
        }
      }

      // 3. Inform user if neither scanner engine is present
      if (!this.barcodeDetector && typeof window.jsQR !== "function") {
        this.updateCameraStatus("QR engine missing (use PIN)", "#f59e0b");
        return;
      }

      // 4. Dispatch detected code to verification pipeline
      if (detectedCode) {
        this.handleDetectedCode(detectedCode);
      }
    }, 180); // ~5.5 FPS polling rate balances responsiveness with low CPU usage
  },

  /**
   * Authenticates badge QR payloads against IndexedDB staff table
   * @param {string} code
   */
  async handleDetectedCode(code) {
    this.isProcessingScan = true;
    this.updateCameraStatus("Verifying badge...", "#38bdf8");

    try {
      const user = await DB.authenticateUser(code);
      if (user) {
        this.updateCameraStatus(`Welcome, ${user.name}!`, "#22c55e");
        setTimeout(() => {
          this.authenticateSuccess(user);
          this.isProcessingScan = false;
        }, 350);
      } else {
        if (this.elements.errorMsg) {
          this.elements.errorMsg.textContent = "Unrecognized employee badge QR.";
        }
        this.updateCameraStatus("Unrecognized badge", "#ef4444");

        // Cooldown period before resuming scanner to prevent rapid alert churn
        setTimeout(() => {
          this.updateCameraStatus("Point badge QR to camera", "#cbd5e1");
          this.isProcessingScan = false;
        }, 2000);
      }
    } catch (err) {
      console.error("[LoginUI] Badge authentication failed:", err);
      this.isProcessingScan = false;
      this.updateCameraStatus("Point badge QR to camera", "#cbd5e1");
    }
  },

  /**
   * Stops camera streams and frees device video hardware
   */
  stopCameraScanner() {
    this.isScanningActive = false;
    this.isProcessingScan = false;

    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.elements.videoPreview) {
      this.elements.videoPreview.srcObject = null;
    }
  },

  /**
   * Helper to set scanner status label text and visual indicator color
   * @param {string} text
   * @param {string} color
   */
  updateCameraStatus(text, color) {
    if (this.elements.cameraStatus) {
      this.elements.cameraStatus.textContent = text;
      this.elements.cameraStatus.style.color = color || "#cbd5e1";
    }
  },

  /**
   * Updates masked PIN display input
   */
  updateDisplay() {
    if (this.elements.pinInput) {
      this.elements.pinInput.value = this.pinBuffer ? "•".repeat(this.pinBuffer.length) : "";
    }
  },

  /**
   * Appends numeric digit to buffer (up to 6 digits)
   * @param {string} digit
   */
  appendDigit(digit) {
    if (this.pinBuffer.length < 6) {
      this.pinBuffer += digit;
      this.updateDisplay();
      if (this.elements.errorMsg) {
        this.elements.errorMsg.textContent = "";
      }
    }
  },

  /**
   * Clears current PIN buffer
   */
  clearPin() {
    this.pinBuffer = "";
    this.updateDisplay();
    if (this.elements.errorMsg) {
      this.elements.errorMsg.textContent = "";
    }
  },

  /**
   * Authenticates PIN buffer against IndexedDB
   */
  async submitLogin() {
    if (!this.pinBuffer) {
      if (this.elements.errorMsg) {
        this.elements.errorMsg.textContent = "Please enter your numeric PIN.";
      }
      return;
    }

    try {
      const user = await DB.authenticateUser(this.pinBuffer);
      if (user) {
        this.authenticateSuccess(user);
      } else {
        if (this.elements.errorMsg) {
          this.elements.errorMsg.textContent = "Invalid PIN or Badge. Please try again.";
        }
        this.clearPin();
      }
    } catch (err) {
      console.error("[LoginUI] PIN authentication error:", err);
      if (this.elements.errorMsg) {
        this.elements.errorMsg.textContent = "Database error during login.";
      }
      this.clearPin();
    }
  },

  /**
   * Common authentication success handler for PIN and Badge logins
   * @param {Object} user
   */
  authenticateSuccess(user) {
    Session.set(user);

    // Stop hardware optical capture to conserve device battery and CPU
    this.stopCameraScanner();

    if (this.elements.txtActiveCashier) {
      this.elements.txtActiveCashier.textContent = `${user.name} (${String(user.role).toUpperCase()})`;
    }

    if (this.elements.screen) {
      this.elements.screen.classList.add("hidden");
    }

    this.clearPin();

    // Toggle Admin button visibility based on session role
    if (this.elements.btnOpenAdmin) {
      if (Session.isAdmin()) {
        this.elements.btnOpenAdmin.classList.remove("hidden");
      } else {
        this.elements.btnOpenAdmin.classList.add("hidden");
      }
    }

    if (typeof this.callbacks.onLoginSuccess === "function") {
      this.callbacks.onLoginSuccess(user);
    }
  },

  /**
   * Locks POS terminal, returns to login screen, and restarts camera scanner
   */
  lockTerminal() {
    Session.clear();

    if (this.elements.txtActiveCashier) {
      this.elements.txtActiveCashier.textContent = "Not Signed In";
    }

    if (this.elements.btnOpenAdmin) {
      this.elements.btnOpenAdmin.classList.add("hidden");
    }

    if (this.elements.screen) {
      this.elements.screen.classList.remove("hidden");
    }

    this.clearPin();

    // Reactivate optical badge scanner
    this.startCameraScanner();

    if (this.elements.pinInput) {
      this.elements.pinInput.focus();
    }

    if (typeof this.callbacks.onLock === "function") {
      this.callbacks.onLock();
    }
  }
};

// REMARK: LOGIN_UI_JS_MODULARIZATION_COMPLETE