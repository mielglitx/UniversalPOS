/**
 * Module Description: Terminal Login & Security Lock Screen Controller
 * Governs terminal authentication, physical keyboard and touch numpad input buffers,
 * non-blocking optical QR camera stream lifecycle, dual-engine QR decoding (native
 * BarcodeDetector with jsQR software fallback), graceful camera permission fallback,
 * and administrative control visibility.
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

    const screen = document.getElementById("login-screen");

    // Cache DOM selections with strict scoping to the login screen
    this.elements = {
      screen,
      pinInput: document.getElementById("login-pin-input"),
      errorMsg: document.getElementById("login-error-msg"),
      btnClear: screen ? screen.querySelector("#btn-pin-clear") : document.getElementById("btn-pin-clear"),
      btnSubmit: screen ? screen.querySelector("#btn-pin-submit") : document.getElementById("btn-pin-submit"),
      txtActiveCashier: document.getElementById("txt-active-cashier"),
      btnLockTerminal: document.getElementById("btn-lock-terminal"),
      btnOpenAdmin: document.getElementById("btn-open-admin"),
      numButtons: screen ? screen.querySelectorAll(".btn-num[data-val]") : document.querySelectorAll("#login-screen .btn-num[data-val]"),

      // Optical Scanner Viewport
      cameraWrap: document.getElementById("camera-scanner-wrap"),
      videoPreview: document.getElementById("login-camera-preview"),
      cameraLaser: screen ? screen.querySelector(".camera-laser") : null,
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

    // Attach virtual numpad click listeners immediately so touch input is instantly available
    if (this.elements.numButtons && this.elements.numButtons.length > 0) {
      this.elements.numButtons.forEach((btn) => {
        btn.onclick = (e) => {
          if (e) e.preventDefault();
          this.appendDigit(btn.dataset.val);
        };
      });
    }

    // Attach action button listeners
    if (this.elements.btnClear) {
      this.elements.btnClear.onclick = (e) => {
        if (e) e.preventDefault();
        this.clearPin();
      };
    }

    if (this.elements.btnSubmit) {
      this.elements.btnSubmit.onclick = (e) => {
        if (e) e.preventDefault();
        this.submitLogin();
      };
    }

    if (this.elements.btnLockTerminal) {
      this.elements.btnLockTerminal.onclick = () => this.lockTerminal();
    }

    // Allow user to tap the camera scanner area to manually retry or initiate camera scan
    if (this.elements.cameraWrap) {
      this.elements.cameraWrap.onclick = () => {
        if (!this.isScanningActive) {
          this.startCameraScanner();
        }
      };
    }

    // Bind physical keyboard events cleanly without stacking duplicate listeners
    if (this.boundKeyDownHandler) {
      window.removeEventListener("keydown", this.boundKeyDownHandler);
    }
    this.boundKeyDownHandler = (e) => this.handleKeyDown(e);
    window.addEventListener("keydown", this.boundKeyDownHandler);

    // Initial focus on PIN field
    if (this.elements.pinInput) {
      this.elements.pinInput.focus();
    }

    // Start background optical QR scanner in an isolated asynchronous thread
    this.startCameraScanner();
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
   * Activates device camera safely with a timeout guard to prevent deadlocking input on permission rejection
   */
  async startCameraScanner() {
    if (!this.elements.videoPreview || this.isScanningActive) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.updateCameraStatus("Camera unsupported • Use PIN", "#f59e0b");
      this.setLaserActive(false);
      return;
    }

    this.updateCameraStatus("Starting camera...", "#cbd5e1");

    try {
      const constraints = {
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      };

      // Guard getUserMedia with a 3-second timeout so pending native dialogs never freeze the app
      const streamPromise = navigator.mediaDevices.getUserMedia(constraints);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Camera permission request timed out")), 3000)
      );

      this.mediaStream = await Promise.race([streamPromise, timeoutPromise]);
      this.elements.videoPreview.srcObject = this.mediaStream;
      
      try {
        await this.elements.videoPreview.play();
      } catch (playErr) {
        console.warn("[LoginUI] Autoplay blocked or deferred:", playErr.message);
      }

      this.isScanningActive = true;
      this.setLaserActive(true);
      this.updateCameraStatus("Point badge QR to camera", "#cbd5e1");
      this.runScannerLoop();
    } catch (err) {
      console.warn("[LoginUI] Camera hardware not active:", err.message);
      this.stopCameraScanner();
      this.setLaserActive(false);
      this.updateCameraStatus("Camera off • Use PIN (Tap to retry)", "#f59e0b");
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
        this.updateCameraStatus("QR engine missing • Use PIN", "#f59e0b");
        this.setLaserActive(false);
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
          if (this.isScanningActive) {
            this.updateCameraStatus("Point badge QR to camera", "#cbd5e1");
          }
          this.isProcessingScan = false;
        }, 2000);
      }
    } catch (err) {
      console.error("[LoginUI] Badge authentication failed:", err);
      this.isProcessingScan = false;
      if (this.isScanningActive) {
        this.updateCameraStatus("Point badge QR to camera", "#cbd5e1");
      }
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

    this.setLaserActive(false);
  },

  /**
   * Toggles scanning laser line visibility
   * @param {boolean} active
   */
  setLaserActive(active) {
    if (this.elements.cameraLaser) {
      this.elements.cameraLaser.style.display = active ? "block" : "none";
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

    if (this.elements.pinInput) {
      this.elements.pinInput.focus();
    }

    // Reactivate optical badge scanner safely
    this.startCameraScanner();

    if (typeof this.callbacks.onLock === "function") {
      this.callbacks.onLock();
    }
  }
};

// REMARK: LOGIN_UI_JS_CAMERA_PERM_DECOUPLED_COMPLETE