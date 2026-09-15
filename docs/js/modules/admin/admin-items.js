/**
 * Module Description: Admin Product Catalog & Camera Barcode Scanner Sub-Module
 * Manages Product Item CRUD, pricing, barcode association, category assignments,
 * image uploads via FileReader (Base64), inventory tracking flags, and live
 * real-time video barcode recognition via ZXing library with defensive camera
 * hardware track cleanup.
 */

import { DB } from "../db.js";
import { Bus } from "../bus.js";
import { Sync } from "../sync.js";

const FALLBACK_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2394a3b8'><path d='M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'/></svg>";

export const AdminItems = {
  elements: {},
  callbacks: {},
  currentItemImageBase64: "",
  zxingCodeReader: null,
  isBarcodeScanning: false,
  initialized: false,

  /**
   * Initializes DOM selections and binds form, modal, and camera barcode scanner events
   * @param {Object} callbacks - External hooks
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    this.elements = {
      itemsAdminTbody: document.getElementById("items-admin-tbody"),
      btnAddNewItem: document.getElementById("btn-add-new-item"),
      modalItemForm: document.getElementById("modal-item-form"),
      itemModalTitle: document.getElementById("item-modal-title"),
      editItemId: document.getElementById("edit-item-id"),
      itemNameInput: document.getElementById("item-name-input"),
      itemCatSelect: document.getElementById("item-cat-select"),
      itemPriceInput: document.getElementById("item-price-input"),
      itemBcInput: document.getElementById("item-bc-input"),
      btnScanItemBarcode: document.getElementById("btn-scan-item-barcode"),
      itemPicInput: document.getElementById("item-pic-input"),
      itemPicPreview: document.getElementById("item-pic-preview"),
      itemMonitoredCheckbox: document.getElementById("item-monitored-checkbox"),
      itemStockFieldsWrap: document.getElementById("item-stock-fields-wrap"),
      itemStockInput: document.getElementById("item-stock-input"),
      itemThresholdInput: document.getElementById("item-threshold-input"),
      itemUnmonitoredFieldsWrap: document.getElementById("item-unmonitored-fields-wrap"),
      itemAvailableCheckbox: document.getElementById("item-available-checkbox"),
      btnCancelItem: document.getElementById("btn-cancel-item"),
      btnSaveItem: document.getElementById("btn-save-item"),

      // Barcode Camera Scanner Modal Elements
      modalBarcodeScanner: document.getElementById("modal-barcode-scanner"),
      itemBarcodeVideo: document.getElementById("item-barcode-video"),
      itemBarcodeStatus: document.getElementById("item-barcode-status"),
      btnCloseBarcodeScanner: document.getElementById("btn-close-barcode-scanner"),
      btnCancelBarcodeCamera: document.getElementById("btn-cancel-barcode-camera")
    };

    if (this.initialized) return;
    this.initialized = true;

    if (this.elements.btnAddNewItem) {
      this.elements.btnAddNewItem.onclick = () => this.openItemEditor(null);
    }

    if (this.elements.btnCancelItem) {
      this.elements.btnCancelItem.onclick = () => {
        if (this.elements.modalItemForm && this.elements.modalItemForm.open) {
          this.elements.modalItemForm.close();
        }
      };
    }

    // Barcode Scanner Modal Controls
    if (this.elements.btnScanItemBarcode) {
      this.elements.btnScanItemBarcode.onclick = () => this.openBarcodeCameraScanner();
    }

    if (this.elements.btnCloseBarcodeScanner) {
      this.elements.btnCloseBarcodeScanner.onclick = () => this.closeBarcodeCameraScanner();
    }

    if (this.elements.btnCancelBarcodeCamera) {
      this.elements.btnCancelBarcodeCamera.onclick = () => this.closeBarcodeCameraScanner();
    }

    // Inventory Monitoring Toggle
    if (this.elements.itemMonitoredCheckbox) {
      this.elements.itemMonitoredCheckbox.onchange = () => {
        const isMon = this.elements.itemMonitoredCheckbox.checked;
        if (this.elements.itemStockFieldsWrap) {
          this.elements.itemStockFieldsWrap.classList.toggle("hidden", !isMon);
        }
        if (this.elements.itemUnmonitoredFieldsWrap) {
          this.elements.itemUnmonitoredFieldsWrap.classList.toggle("hidden", isMon);
        }
      };
    }

    // Picture File Reader
    if (this.elements.itemPicInput) {
      this.elements.itemPicInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            this.currentItemImageBase64 = evt.target.result;
            if (this.elements.itemPicPreview) {
              this.elements.itemPicPreview.src = this.currentItemImageBase64;
              this.elements.itemPicPreview.classList.remove("hidden");
            }
          };
          reader.readAsDataURL(file);
        }
      };
    }

    // Save Item Action
    if (this.elements.btnSaveItem) {
      this.elements.btnSaveItem.onclick = async () => {
        const name = this.elements.itemNameInput.value.trim();
        const price = Math.max(0, parseFloat(this.elements.itemPriceInput.value) || 0);
        const cat = this.elements.itemCatSelect.value;
        const bc = this.elements.itemBcInput.value.trim();
        const id = this.elements.editItemId.value;

        if (!name || isNaN(price)) {
          alert("Please provide a valid item name and price.");
          return;
        }

        const isMonitored = this.elements.itemMonitoredCheckbox.checked;
        const stockQty = isMonitored ? Math.max(0, parseInt(this.elements.itemStockInput.value, 10) || 0) : 0;
        const customThresholdVal = this.elements.itemThresholdInput.value.trim();
        const customThreshold = (isMonitored && customThresholdVal !== "") ? Math.max(0, parseInt(customThresholdVal, 10) || 0) : null;
        const isAvailable = isMonitored ? (stockQty > 0) : this.elements.itemAvailableCheckbox.checked;

        const payload = {
          name,
          price,
          cat,
          bc,
          image: this.currentItemImageBase64 || FALLBACK_IMG,
          isMonitored,
          stock: stockQty,
          threshold: customThreshold,
          isAvailable
        };

        if (id) {
          await DB.updateProduct(id, payload);
        } else {
          await DB.addProduct(payload);
        }

        if (this.elements.modalItemForm && this.elements.modalItemForm.open) {
          this.elements.modalItemForm.close();
        }

        await this.loadAdminItems();
        Bus.emit("inventory:updated");

        if (typeof this.callbacks.onCatalogModified === "function") {
          this.callbacks.onCatalogModified();
        }

        Sync.pushPendingOrders({ silent: true }).catch(() => {});
      };
    }
  },

  /**
   * Launches ZXing video scanner stream
   */
  async openBarcodeCameraScanner() {
    if (this.elements.modalBarcodeScanner && typeof this.elements.modalBarcodeScanner.showModal === "function") {
      this.elements.modalBarcodeScanner.showModal();
    }

    this.isBarcodeScanning = true;
    const statusPill = this.elements.itemBarcodeStatus;
    if (statusPill) statusPill.textContent = "Initializing camera reader...";

    try {
      if (!window.ZXing || !window.ZXing.BrowserMultiFormatReader) {
        throw new Error("ZXing library failed to load.");
      }

      if (!this.zxingCodeReader) {
        this.zxingCodeReader = new window.ZXing.BrowserMultiFormatReader();
      }

      const videoElement = this.elements.itemBarcodeVideo;
      if (statusPill) statusPill.textContent = "Align product barcode within reticle";

      await this.zxingCodeReader.decodeFromVideoDevice(
        undefined,
        videoElement,
        (result) => {
          if (result && this.isBarcodeScanning) {
            const scannedText = result.getText();
            if (scannedText) {
              this.applyScannedBarcode(scannedText);
            }
          }
        }
      );
    } catch (err) {
      console.error("[ZXing Barcode Error]:", err);
      if (statusPill) statusPill.textContent = "Camera access denied or unavailable";
      alert(`Could not start barcode scanner: ${err.message}`);
    }
  },

  applyScannedBarcode(code) {
    this.closeBarcodeCameraScanner();

    const input = this.elements.itemBcInput;
    if (input) {
      input.value = code;
      input.classList.add("input-barcode-success");
      setTimeout(() => {
        input.classList.remove("input-barcode-success");
      }, 1200);
    }
  },

  closeBarcodeCameraScanner() {
    this.isBarcodeScanning = false;

    if (this.zxingCodeReader) {
      try {
        this.zxingCodeReader.reset();
      } catch (e) {
        // Suppress reader reset exceptions
      }
    }

    if (this.elements.itemBarcodeVideo && this.elements.itemBarcodeVideo.srcObject) {
      const stream = this.elements.itemBarcodeVideo.srcObject;
      if (typeof stream.getTracks === "function") {
        stream.getTracks().forEach((track) => track.stop());
      }
      this.elements.itemBarcodeVideo.srcObject = null;
    }

    if (this.elements.modalBarcodeScanner && this.elements.modalBarcodeScanner.open) {
      this.elements.modalBarcodeScanner.close();
    }
  },

  /**
   * Loads product catalog table records
   */
  async loadAdminItems() {
    if (!this.elements.itemsAdminTbody) return;

    const products = await DB.getProducts("all");
    this.elements.itemsAdminTbody.innerHTML = products.map((prod) => {
      const isMon = Boolean(prod.isMonitored);
      const typeBadge = isMon
        ? `<span class="badge badge-monitored">MONITORED</span>`
        : `<span class="badge badge-unmonitored">UNMONITORED</span>`;

      let stockSummary = "";
      if (isMon) {
        stockSummary = prod.stock > 0
          ? `<b>${prod.stock}</b> in stock`
          : `<span style="color:#dc2626; font-weight:bold;">Out of Stock</span>`;
      } else {
        stockSummary = prod.isAvailable !== false
          ? `<span style="color:#15803d; font-weight:bold;">Available</span>`
          : `<span style="color:#64748b;">Unavailable</span>`;
      }

      return `
        <tr>
          <td>
            <img 
              src="${prod.image || FALLBACK_IMG}" 
              alt="${prod.name}" 
              class="admin-table-thumb" 
              onerror="this.onerror=null;this.src='${FALLBACK_IMG}';" 
            />
          </td>
          <td><b>${prod.name}</b></td>
          <td>${prod.cat.toUpperCase()}</td>
          <td>${typeBadge}</td>
          <td>${stockSummary}</td>
          <td class="text-right">₱${Number(prod.price || 0).toFixed(2)}</td>
          <td class="text-center">
            <button class="btn-action-sm btn-edit-item" data-id="${prod.id}">Edit</button>
            <button class="btn-action-sm btn-action-del btn-del-item" data-id="${prod.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join("");

    this.elements.itemsAdminTbody.querySelectorAll(".btn-edit-item").forEach((btn) => {
      btn.onclick = async () => {
        const prod = await DB.getProductById(btn.dataset.id);
        if (prod) this.openItemEditor(prod);
      };
    });

    this.elements.itemsAdminTbody.querySelectorAll(".btn-del-item").forEach((btn) => {
      btn.onclick = async () => {
        if (confirm("Are you sure you want to delete this menu item?")) {
          await DB.deleteProduct(btn.dataset.id);
          await this.loadAdminItems();
          Bus.emit("inventory:updated");

          if (typeof this.callbacks.onCatalogModified === "function") {
            this.callbacks.onCatalogModified();
          }
        }
      };
    });
  },

  /**
   * Opens the item editor modal form
   * @param {Object|null} item - Existing item to edit or null for new
   */
  async openItemEditor(item = null) {
    const categories = await DB.getCategories();
    if (this.elements.itemCatSelect) {
      this.elements.itemCatSelect.innerHTML = categories.map((c) => `
        <option value="${c.id}">${c.name}${c.isAddon ? " (Add-on)" : ""}</option>
      `).join("");
    }

    if (item) {
      if (this.elements.itemModalTitle) this.elements.itemModalTitle.textContent = "Edit Menu Item";
      if (this.elements.editItemId) this.elements.editItemId.value = item.id;
      if (this.elements.itemNameInput) this.elements.itemNameInput.value = item.name;
      if (this.elements.itemCatSelect) this.elements.itemCatSelect.value = item.cat;
      if (this.elements.itemPriceInput) this.elements.itemPriceInput.value = item.price;
      if (this.elements.itemBcInput) this.elements.itemBcInput.value = item.bc || "";
      this.currentItemImageBase64 = item.image || "";

      const isMon = Boolean(item.isMonitored);
      if (this.elements.itemMonitoredCheckbox) this.elements.itemMonitoredCheckbox.checked = isMon;
      if (this.elements.itemStockFieldsWrap) this.elements.itemStockFieldsWrap.classList.toggle("hidden", !isMon);
      if (this.elements.itemUnmonitoredFieldsWrap) this.elements.itemUnmonitoredFieldsWrap.classList.toggle("hidden", isMon);

      if (this.elements.itemStockInput) this.elements.itemStockInput.value = item.stock !== undefined ? item.stock : 0;
      if (this.elements.itemThresholdInput) {
        this.elements.itemThresholdInput.value = (item.threshold !== null && item.threshold !== undefined) ? item.threshold : "";
      }
      if (this.elements.itemAvailableCheckbox) {
        this.elements.itemAvailableCheckbox.checked = item.isAvailable !== false;
      }

      if (this.elements.itemPicPreview) {
        if (item.image) {
          this.elements.itemPicPreview.src = item.image;
          this.elements.itemPicPreview.classList.remove("hidden");
        } else {
          this.elements.itemPicPreview.classList.add("hidden");
        }
      }
    } else {
      if (this.elements.itemModalTitle) this.elements.itemModalTitle.textContent = "Add New Menu Item";
      if (this.elements.editItemId) this.elements.editItemId.value = "";
      if (this.elements.itemNameInput) this.elements.itemNameInput.value = "";
      if (this.elements.itemPriceInput) this.elements.itemPriceInput.value = "";
      if (this.elements.itemBcInput) this.elements.itemBcInput.value = "";
      this.currentItemImageBase64 = "";
      if (this.elements.itemPicInput) this.elements.itemPicInput.value = "";
      if (this.elements.itemPicPreview) this.elements.itemPicPreview.classList.add("hidden");

      if (this.elements.itemMonitoredCheckbox) this.elements.itemMonitoredCheckbox.checked = false;
      if (this.elements.itemStockFieldsWrap) this.elements.itemStockFieldsWrap.classList.add("hidden");
      if (this.elements.itemUnmonitoredFieldsWrap) this.elements.itemUnmonitoredFieldsWrap.classList.remove("hidden");
      if (this.elements.itemStockInput) this.elements.itemStockInput.value = 0;
      if (this.elements.itemThresholdInput) this.elements.itemThresholdInput.value = "";
      if (this.elements.itemAvailableCheckbox) this.elements.itemAvailableCheckbox.checked = true;
    }

    if (this.elements.modalItemForm && typeof this.elements.modalItemForm.showModal === "function") {
      this.elements.modalItemForm.showModal();
    }
  }
};

// REMARK: ADMIN_ITEMS_JS_MODULARIZATION_COMPLETE