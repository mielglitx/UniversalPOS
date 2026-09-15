/**
 * Module Description: Admin Cloud Sync & Remote Database Sub-Module
 * Manages configuration for remote cloud data sources (Firebase Realtime Database REST
 * vs Google Apps Script Web App endpoints), tracks pending offline order counts,
 * triggers manual push/pull synchronization routines, and dynamically generates
 * ready-to-paste backend scripts (Google Apps Script Code.gs with buzzer column mapping
 * or Firebase Realtime Database Security Rules) directly to the system clipboard.
 */

import { DB } from "../db.js";
import { Sync } from "../sync.js";

export const AdminSync = {
  elements: {},
  callbacks: {},
  initialized: false,

  /**
   * Initializes DOM selections and binds cloud sync settings and trigger events
   * @param {Object} callbacks - External hooks
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    this.elements = {
      syncSourceSelect: document.getElementById("sync-source-select"),
      syncFieldsFirebase: document.getElementById("sync-fields-firebase"),
      syncFirebaseUrl: document.getElementById("sync-firebase-url"),
      syncFirebaseAuth: document.getElementById("sync-firebase-auth"),
      syncFieldsGas: document.getElementById("sync-fields-gas"),
      syncGasUrl: document.getElementById("sync-gas-url"),
      syncGasSecret: document.getElementById("sync-gas-secret"),
      statUnsyncedOrders: document.getElementById("stat-unsynced-orders"),
      btnSaveSyncConfig: document.getElementById("btn-save-sync-config"),
      btnCopyBackendConfig: document.getElementById("btn-copy-backend-config"),
      btnPushOrders: document.getElementById("btn-push-orders"),
      btnPullCatalog: document.getElementById("btn-pull-catalog")
    };

    if (this.initialized) return;
    this.initialized = true;

    // Toggle conditional fields based on provider selection
    if (this.elements.syncSourceSelect) {
      this.elements.syncSourceSelect.onchange = () => {
        const source = this.elements.syncSourceSelect.value;
        if (this.elements.syncFieldsFirebase) {
          this.elements.syncFieldsFirebase.classList.toggle("hidden", source !== "firebase");
        }
        if (this.elements.syncFieldsGas) {
          this.elements.syncFieldsGas.classList.toggle("hidden", source !== "gas");
        }
      };
    }

    // Save Cloud Sync Credentials
    if (this.elements.btnSaveSyncConfig) {
      this.elements.btnSaveSyncConfig.onclick = async () => {
        const source = this.elements.syncSourceSelect ? this.elements.syncSourceSelect.value : "firebase";
        const payload = {
          source,
          firebaseUrl: this.elements.syncFirebaseUrl ? this.elements.syncFirebaseUrl.value.trim() : "",
          firebaseAuth: this.elements.syncFirebaseAuth ? this.elements.syncFirebaseAuth.value.trim() : "",
          gasUrl: this.elements.syncGasUrl ? this.elements.syncGasUrl.value.trim() : "",
          gasSecret: this.elements.syncGasSecret ? this.elements.syncGasSecret.value.trim() : ""
        };

        await DB.saveSyncConfig(payload);
        Sync.log(`Cloud database target updated to: ${source.toUpperCase()}`);
        alert("Cloud database settings saved successfully.");
      };
    }

    // Copy Backend Config Code (Code.gs for GAS or database.rules.json for Firebase)
    if (this.elements.btnCopyBackendConfig) {
      this.elements.btnCopyBackendConfig.onclick = async () => {
        const source = this.elements.syncSourceSelect ? this.elements.syncSourceSelect.value : "firebase";
        await this.handleCopyConfig(source);
      };
    }

    // Manual Push Pending Orders
    if (this.elements.btnPushOrders) {
      this.elements.btnPushOrders.onclick = async () => {
        await Sync.pushPendingOrders({ silent: false });
        await this.loadSyncSettings();
      };
    }

    // Manual Pull Remote Catalog
    if (this.elements.btnPullCatalog) {
      this.elements.btnPullCatalog.onclick = async () => {
        const result = await Sync.pullRemoteCatalog();
        if (result && result.success) {
          if (typeof this.callbacks.onCatalogModified === "function") {
            this.callbacks.onCatalogModified();
          }
          if (typeof this.callbacks.onCategoriesModified === "function") {
            this.callbacks.onCategoriesModified();
          }
        }
      };
    }
  },

  /**
   * Generates and copies provider-specific backend code to clipboard
   * @param {string} source - 'gas' or 'firebase'
   */
  async handleCopyConfig(source) {
    let snippet = "";
    let label = "";

    if (source === "gas") {
      label = "Google Apps Script (Code.gs)";
      snippet = `/**
 * Google Apps Script Web App - Standalone POS Cloud Synchronization Endpoint
 * Automatically appends orders to the "Orders" sheet with buzzer/pager mapping
 * and serves catalog categories and products for remote synchronization.
 *
 * INSTRUCTIONS:
 * 1. Open your Google Spreadsheet.
 * 2. Go to Extensions > Apps Script.
 * 3. Replace all existing text in Code.gs with this complete code.
 * 4. Click "Deploy" > "Manage deployments" > Edit (pencil) > New version > Deploy.
 * 5. Ensure access is set to: "Anyone" (or "Anyone with Google Account").
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  
  try {
    var rawData = e.postData ? e.postData.contents : null;
    if (!rawData) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "No POST body received"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var payload = JSON.parse(rawData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Orders") || ss.insertSheet("Orders");

    // Initialize 15 standard column headers if table is blank
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Order #",
        "Timestamp",
        "Cashier ID",
        "Cashier Name",
        "Payment Mode",
        "Pager / Buzzer #",
        "VATable Sales",
        "VAT (12%)",
        "Total Amount",
        "Cash Tendered",
        "Change Due",
        "GCash Ref No",
        "GCash Date",
        "Order Status",
        "Item Breakdown (JSON)"
      ]);
      sheet.getRange(1, 1, 1, 15).setFontWeight("bold").setBackground("#f1f5f9");
    }

    // Support single order object or batch array of orders
    var orders = Array.isArray(payload.orders)
      ? payload.orders
      : (Array.isArray(payload) ? payload : [payload]);

    orders.forEach(function(order) {
      sheet.appendRow([
        order.orderNumber || "",
        order.timestamp || new Date().toISOString(),
        order.cashierId || "",
        order.cashierName || "",
        order.paymentType || "CASH",
        order.pagerNumber || "N/A",
        order.vatableSales || 0,
        order.vatAmount || 0,
        order.total || 0,
        order.amountTendered || "",
        order.changeAmount || "",
        order.gcashRefNo || "",
        order.gcashPaymentDate || "",
        order.status || "COMPLETED",
        JSON.stringify(order.items || [])
      ]);
    });

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: "Synced " + orders.length + " order(s) successfully",
      count: orders.length
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var catSheet = ss.getSheetByName("Categories");
  var prodSheet = ss.getSheetByName("Products");

  var categories = [];
  var products = [];

  // Read Categories if sheet exists
  if (catSheet && catSheet.getLastRow() > 1) {
    var catData = catSheet.getDataRange().getValues();
    for (var i = 1; i < catData.length; i++) {
      categories.push({
        id: String(catData[i][0]),
        name: String(catData[i][1]),
        order: Number(catData[i][2]) || (i + 1),
        image: String(catData[i][3] || ""),
        isAddon: Boolean(catData[i][4])
      });
    }
  }

  // Read Products if sheet exists
  if (prodSheet && prodSheet.getLastRow() > 1) {
    var prodData = prodSheet.getDataRange().getValues();
    for (var j = 1; j < prodData.length; j++) {
      products.push({
        id: String(prodData[j][0]),
        name: String(prodData[j][1]),
        price: Number(prodData[j][2]) || 0,
        cat: String(prodData[j][3] || "all"),
        bc: String(prodData[j][4] || ""),
        image: String(prodData[j][5] || ""),
        isMonitored: Boolean(prodData[j][6]),
        stock: Number(prodData[j][7]) || 0,
        threshold: prodData[j][8] ? Number(prodData[j][8]) : null,
        isAvailable: prodData[j][9] !== false
      });
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    categories: categories,
    products: products
  })).setMimeType(ContentService.MimeType.JSON);
}`;
    } else {
      label = "Firebase Realtime Database Security Rules";
      snippet = `// Firebase Realtime Database Security & Indexing Rules (database.rules.json)
// Paste into: Firebase Console > Realtime Database > Rules tab > Publish
{
  "rules": {
    ".read": true,
    ".write": true,
    "orders": {
      ".indexOn": ["timestamp", "orderNumber", "status", "synced", "pagerNumber"]
    },
    "products": {
      ".indexOn": ["cat", "bc", "isMonitored", "isAvailable"]
    },
    "categories": {
      ".indexOn": ["order", "isAddon"]
    },
    "stockQueue": {
      ".indexOn": ["id"]
    }
  }
}`;
    }

    const copied = await this.copyToClipboard(snippet);
    if (copied) {
      Sync.log(`[Config Copied] ${label} template copied to clipboard.`);
      alert(`${label} copied to clipboard!\n\nYou can now paste this directly into your ${source === "gas" ? "Apps Script Code.gs editor" : "Firebase Realtime Database Rules console"}.`);
    } else {
      prompt(`Copy your ${label} below:`, snippet);
    }
  },

  /**
   * Universal clipboard write helper compatible across desktop & mobile WebViews
   * @param {string} text - Text to place in clipboard
   * @returns {Promise<boolean>}
   */
  async copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn("[Clipboard API failed, trying fallback]", err);
      }
    }

    // Fallback using temporary textarea
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      return Boolean(successful);
    } catch (e) {
      console.error("[Clipboard Fallback Error]", e);
      return false;
    }
  },

  /**
   * Loads persisted cloud sync credentials and pending offline queue metrics
   */
  async loadSyncSettings() {
    const config = await DB.getSyncConfig();
    const unsynced = await DB.getUnsyncedOrders();

    if (this.elements.syncSourceSelect) {
      this.elements.syncSourceSelect.value = config.source || "firebase";
      if (this.elements.syncFieldsFirebase) {
        this.elements.syncFieldsFirebase.classList.toggle("hidden", config.source !== "firebase");
      }
      if (this.elements.syncFieldsGas) {
        this.elements.syncFieldsGas.classList.toggle("hidden", config.source !== "gas");
      }
    }

    if (this.elements.syncFirebaseUrl) this.elements.syncFirebaseUrl.value = config.firebaseUrl || "";
    if (this.elements.syncFirebaseAuth) this.elements.syncFirebaseAuth.value = config.firebaseAuth || "";
    if (this.elements.syncGasUrl) this.elements.syncGasUrl.value = config.gasUrl || "";
    if (this.elements.syncGasSecret) this.elements.syncGasSecret.value = config.gasSecret || "";

    if (this.elements.statUnsyncedOrders) {
      this.elements.statUnsyncedOrders.textContent = `${unsynced.length} Orders Pending Sync`;
      this.elements.statUnsyncedOrders.style.color = unsynced.length > 0 ? "#e11d48" : "#16a34a";
    }
  }
};

// REMARK: ADMIN_SYNC_JS_CONFIG_CODE_GENERATOR_COMPLETE