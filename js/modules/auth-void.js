/**
 * Module Description: Manager Authorization & Line-Item Void Controller
 * Manages security clearance for voiding active cart items. Supports instant
 * administrative bypass for signed-in managers, live optical QR badge scanning
 * via ZXing, on-screen touch numpad input, and hardware barcode/keyboard entry.
 * Logs all void events to local IndexedDB audit tables.
 */

import { Bus } from "./bus.js";
import { Cart } from "./cart.js";
import { DB } from "./db.js";
import { Session } from "./session.js";

export const AuthVoid = {
  pendingProductId: null,
  modal: null,
  input: null,
  label: null,
  error: null,
  videoEl: null,
  statusEl: null,
  zxingReader: null,
  isScanning: false,
  initialized: false,

  /**
   * Initializes DOM bindings and attaches void request bus listeners
   * @param {HTMLDialogElement} modalEl 
   * @param {HTMLInputElement} inputEl 
   * @param {HTMLElement} labelEl 
   * @param {HTMLElement} errorEl 
   */
  init(modalEl, inputEl, labelEl, errorEl) {
    this.modal = modalEl || document.getElementById("modal-void");
    this.input = inputEl || document.getElementById("manager-qr-input");
    this.label = labelEl || document.getElementById("void-item-label");
    this.error = errorEl || document.getElementById("void-error-msg");

    this.videoEl = document.getElementById("void-camera-preview");
    this.statusEl = document.getElementById("void-camera-status");

    if (this.initialized) return;
    this.initialized = true;

    // 1. Listen for void requests originating from cart row buttons
    Bus.on("cart:request-void", async (item) => {
      if (!item || !item.id) return;
      this.pendingProductId = item.id;

      if (this.label) {
        this.label.textContent = `${item.name} (Qty: ${item.qty})`;
      }
      if (this.error) {
        this.error.textContent = "";
      }
      if (this.input) {
        this.input.value = "";
      }

      // Bypass verification if signed-in user is already an Admin or Manager
      if (Session.isAdmin()) {
        const activeUser = Session.get() || { id: "ADM-001", name: "Administrator", role: "admin" };
        console.info(`[Audit] Item void bypassed for administrator: ${activeUser.name}`);
        await DB.logVoid(item, activeUser);
        Cart.voidItem(this.pendingProductId);
        this.pendingProductId = null;
        return;
      }

      // Otherwise, open modal and activate camera scanner / touch numpad
      if (this.modal && typeof this.modal.showModal === "function") {
        this.modal.showModal();
        await this.startCamera();
        if (this.input) {
          this.input.focus();
        }
      }
    });

    // 2. Touch Numpad bindings
    const numpad = this.modal ? this.modal.querySelectorAll(".btn-num[data-val]") : [];
    numpad.forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        const val = btn.dataset.val;
        if (this.input && this.input.value.length < 6) {
          this.input.value += val;
          if (this.error) this.error.textContent = "";
        }
      };
    });

    const btnClear = document.getElementById("btn-void-clear");
    if (btnClear) {
      btnClear.onclick = (e) => {
        e.preventDefault();
        if (this.input) this.input.value = "";
        if (this.error) this.error.textContent = "";
      };
    }

    const btnSubmit = document.getElementById("btn-void-submit");
    if (btnSubmit) {
      btnSubmit.onclick = (e) => {
        e.preventDefault();
        if (this.input) {
          this.verify(this.input.value.trim());
        }
      };
    }

    // 3. Hardware scanner & physical keyboard listener (Enter-terminated)
    if (this.input) {
      this.input.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.verify(this.input.value.trim());
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.close();
        }
      };
    }

    // Modal dismiss actions
    const btnCancel = document.getElementById("btn-cancel-void");
    const btnCancelX = document.getElementById("btn-cancel-void-x");
    if (btnCancel) btnCancel.onclick = () => this.close();
    if (btnCancelX) btnCancelX.onclick = () => this.close();
  },

  /**
   * Activates device camera and binds video track to preview element
   */
  async startCamera() {
    this.isScanning = true;
    if (this.statusEl) this.statusEl.textContent = "Starting camera...";

    try {
      if (!window.ZXing || !window.ZXing.BrowserMultiFormatReader) {
        throw new Error("ZXing engine not loaded.");
      }

      if (!this.zxingReader) {
        this.zxingReader = new window.ZXing.BrowserMultiFormatReader();
      }

      if (this.statusEl) this.statusEl.textContent = "Point manager badge QR to camera";

      await this.zxingReader.decodeFromVideoDevice(
        undefined,
        this.videoEl,
        (result) => {
          if (result && this.isScanning) {
            const token = result.getText();
            if (token) {
              this.verify(token.trim());
            }
          }
        }
      );
    } catch (err) {
      console.warn("[AuthVoid] Optical camera scanner unavailable:", err.message);
      if (this.statusEl) this.statusEl.textContent = "Camera unavailable (use PIN pad)";
    }
  },

  /**
   * Authenticates PIN or Badge Token against IndexedDB manager credentials
   * @param {string} token 
   */
  async verify(token) {
    if (!token) {
      if (this.error) this.error.textContent = "Please enter PIN or scan badge.";
      return;
    }

    try {
      const manager = await DB.verifyManagerBadge(token);

      if (manager) {
        console.info(`[Audit] Item void authorized by manager: ${manager.name}`);
        const item = Cart.items.find((i) => i.id === this.pendingProductId);
        if (item) {
          await DB.logVoid(item, manager);
        }
        Cart.voidItem(this.pendingProductId);
        this.close();
      } else {
        if (this.error) this.error.textContent = "Invalid Manager PIN or Badge. Access Denied.";
        if (this.input) this.input.value = "";
      }
    } catch (err) {
      console.error("[AuthVoid] Verification database failure:", err);
      if (this.error) this.error.textContent = "Security verification error.";
      if (this.input) this.input.value = "";
    }
  },

  /**
   * Closes the authorization dialog and safely releases camera hardware
   */
  close() {
    this.isScanning = false;

    if (this.zxingReader) {
      try {
        this.zxingReader.reset();
      } catch (e) {
        // Ignore decoder reset exceptions
      }
    }

    if (this.videoEl && this.videoEl.srcObject) {
      const stream = this.videoEl.srcObject;
      if (typeof stream.getTracks === "function") {
        stream.getTracks().forEach((track) => track.stop());
      }
      this.videoEl.srcObject = null;
    }

    if (this.modal && this.modal.open) {
      this.modal.close();
    }

    this.pendingProductId = null;
  }
};

// REMARK: AUTH_VOID_JS_MODULARIZATION_COMPLETE