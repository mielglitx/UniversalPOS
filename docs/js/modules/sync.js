/**
 * Module Description: Offline-First Low-Bandwidth Synchronization Engine
 * Monitors device connectivity transitions, drives opportunistic background sync,
 * compresses batched multi-path payloads (stripping images to minimize cellular bandwidth),
 * and handles bi-directional delta synchronization to Firebase Realtime Database
 * and Google Apps Script Web App endpoints.
 */

import { DB } from "./db.js";
import { Bus } from "./bus.js";

export const Sync = {
  isOnline: navigator.onLine,
  isSyncing: false,
  elements: {},
  initialized: false,

  /**
   * Initializes network state listeners, connectivity badges, and logging elements
   */
  init() {
    this.elements = {
      netBadge: document.getElementById("net-badge"),
      logTerminal: document.getElementById("sync-log-terminal")
    };

    // Update initial connectivity badge
    this.updateNetworkBadge();

    if (this.initialized) return;
    this.initialized = true;

    // Listen for browser connectivity transitions
    window.addEventListener("online", () => {
      this.isOnline = true;
      this.updateNetworkBadge();
      this.log("Device is ONLINE. Internet connection restored.");
      // Trigger silent background push when connection is restored
      this.pushPendingOrders({ silent: true });
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      this.updateNetworkBadge();
      this.log("Device is OFFLINE. Operations running 100% locally on IndexedDB.");
    });
  },

  /**
   * Updates topbar network indicator badge
   */
  updateNetworkBadge() {
    if (!this.elements.netBadge) return;
    if (this.isOnline) {
      this.elements.netBadge.textContent = "ONLINE";
      this.elements.netBadge.className = "badge badge-online";
    } else {
      this.elements.netBadge.textContent = "OFFLINE";
      this.elements.netBadge.className = "badge badge-offline";
    }
  },

  /**
   * Appends timestamped log lines to Admin Sync Console
   * @param {string} message
   */
  log(message) {
    const ts = new Date().toLocaleTimeString();
    const formatted = `[${ts}] ${message}`;
    console.info(`[SyncEngine] ${formatted}`);

    if (this.elements.logTerminal) {
      this.elements.logTerminal.textContent += `\n${formatted}`;
      this.elements.logTerminal.scrollTop = this.elements.logTerminal.scrollHeight;
    }
  },

  /**
   * Pushes pending orders and modified stock levels in a single compressed batch
   * @param {Object} options - { silent: boolean }
   * @returns {Promise<Object>}
   */
  async pushPendingOrders(options = { silent: false }) {
    if (!this.isOnline) {
      if (!options.silent) {
        alert("Cannot synchronize: Terminal is currently OFFLINE.");
      }
      this.log("Push aborted: Device is offline. All records remain queued in IndexedDB.");
      return { success: false, reason: "offline" };
    }

    if (this.isSyncing) {
      this.log("Sync already active. Skipping overlapping run.");
      return { success: false, reason: "in_progress" };
    }

    const pendingOrders = await DB.getUnsyncedOrders();
    const stockUpdates = await DB.getUnsyncedStock();
    const stockItemIds = Object.keys(stockUpdates);

    if (pendingOrders.length === 0 && stockItemIds.length === 0) {
      if (!options.silent) {
        alert("Everything is up to date. Zero pending orders or inventory changes.");
      }
      return { success: true, count: 0 };
    }

    const config = await DB.getSyncConfig();
    this.isSyncing = true;
    this.log(`Syncing ${pendingOrders.length} order(s) and ${stockItemIds.length} stock update(s) via [${config.source.toUpperCase()}]...`);

    try {
      if (config.source === "firebase") {
        await this.syncToFirebase(config, pendingOrders, stockUpdates);
      } else if (config.source === "gas") {
        await this.syncToGoogleAppsScript(config, pendingOrders, stockUpdates);
      } else {
        throw new Error(`Unsupported database source: ${config.source}`);
      }

      // Mark local orders as synced in IndexedDB
      const syncedIds = pendingOrders.map((o) => o.id);
      await DB.markOrdersAsSynced(syncedIds);

      // Clear synced stock modification queue
      await DB.clearStockQueue(stockItemIds);

      // Update last sync timestamp
      await DB.saveSyncConfig({ lastSync: new Date().toISOString() });

      this.log("Batch push completed successfully. Data synchronized.");
      Bus.emit("sync:completed", { ordersCount: syncedIds.length, stockCount: stockItemIds.length });

      if (!options.silent) {
        alert(`Sync Complete: ${syncedIds.length} orders and ${stockItemIds.length} stock updates saved.`);
      }
      return { success: true, ordersCount: syncedIds.length, stockCount: stockItemIds.length };
    } catch (err) {
      this.log(`Sync push failed: ${err.message}`);
      if (!options.silent) {
        alert(`Sync Error: ${err.message}`);
      }
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  },

  /**
   * Low-Bandwidth Batched Firebase Push using Multi-Path PATCH
   * Sends orders and stock counters in one single HTTP request.
   * @param {Object} config
   * @param {Array<Object>} orders
   * @param {Object} stockUpdates
   */
  async syncToFirebase(config, orders, stockUpdates) {
    if (!config.firebaseUrl) {
      throw new Error("Firebase Database URL is not configured.");
    }

    const baseUrl = config.firebaseUrl.replace(/\/+$/, "");
    const authParam = config.firebaseAuth ? `?auth=${encodeURIComponent(config.firebaseAuth)}` : "";

    // Build flat multi-path patch payload to update multiple nodes atomically
    const patchPayload = {};

    // 1. Pack clean order records (no images, minimal keys)
    for (const order of orders) {
      patchPayload[`orders/${order.orderNumber}`] = {
        orderNumber: order.orderNumber,
        cashierId: order.cashierId,
        cashierName: order.cashierName || "",
        items: (order.items || []).map((i) => ({
          id: i.id,
          name: i.name,
          price: i.price,
          qty: i.qty
        })),
        vatableSales: order.vatableSales,
        vatAmount: order.vatAmount,
        total: order.total,
        paymentType: order.paymentType,
        amountTendered: order.amountTendered || null,
        changeAmount: order.changeAmount || null,
        gcashRefNo: order.gcashRefNo || null,
        gcashAmountPaid: order.gcashAmountPaid || null,
        gcashPaymentDate: order.gcashPaymentDate || null,
        status: order.status || "COMPLETED",
        voidedAt: order.voidedAt || null,
        voidedBy: order.voidedBy || null,
        voidReason: order.voidReason || null,
        timestamp: order.timestamp,
        syncedAt: new Date().toISOString()
      };
    }

    // 2. Pack lightweight stock delta nodes (never sends product images)
    for (const [prodId, data] of Object.entries(stockUpdates)) {
      patchPayload[`stock/${prodId}`] = {
        stock: data.stock,
        isAvailable: data.isAvailable,
        updatedAt: new Date().toISOString()
      };
    }

    // Single HTTP PATCH call writes all paths atomically with minimal headers
    const endpoint = `${baseUrl}/.json${authParam}`;
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Firebase HTTP ${response.status}: ${errText}`);
    }
  },

  /**
   * Low-Bandwidth Google Apps Script Web App Push
   * Sends order batch and stock updates via single POST payload
   * @param {Object} config
   * @param {Array<Object>} orders
   * @param {Object} stockUpdates
   */
  async syncToGoogleAppsScript(config, orders, stockUpdates) {
    if (!config.gasUrl) {
      throw new Error("Google Apps Script Web App URL is not configured.");
    }

    const payload = {
      action: "sync_batch",
      secret: config.gasSecret || "",
      timestamp: new Date().toISOString(),
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber,
        cashierId: o.cashierId,
        cashierName: o.cashierName || "",
        items: (o.items || []).map((i) => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
        vatableSales: o.vatableSales,
        vatAmount: o.vatAmount,
        total: o.total,
        paymentType: o.paymentType,
        gcashRefNo: o.gcashRefNo || null,
        status: o.status || "COMPLETED",
        voidedAt: o.voidedAt || null,
        voidedBy: o.voidedBy || null,
        timestamp: o.timestamp
      })),
      stockUpdates
    };

    const response = await fetch(config.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`GAS HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    if (result.status !== "success" && result.status !== "ok") {
      throw new Error(result.message || "Google Apps Script rejected the sync batch.");
    }
  },

  /**
   * Pulls catalog updates from remote database (Back-Office manual trigger)
   * @returns {Promise<Object>}
   */
  async pullRemoteCatalog() {
    if (!this.isOnline) {
      alert("Cannot pull catalog: Terminal is currently OFFLINE.");
      return { success: false, reason: "offline" };
    }

    const config = await DB.getSyncConfig();
    this.log(`Fetching remote catalog from [${config.source.toUpperCase()}]...`);

    try {
      let remoteCategories = [];
      let remoteProducts = [];

      if (config.source === "firebase") {
        const baseUrl = config.firebaseUrl.replace(/\/+$/, "");
        const authParam = config.firebaseAuth ? `?auth=${encodeURIComponent(config.firebaseAuth)}` : "";

        // Fetch categories node
        const catRes = await fetch(`${baseUrl}/catalog/categories.json${authParam}`);
        if (catRes.ok) {
          const catData = await catRes.json();
          remoteCategories = catData ? (Array.isArray(catData) ? catData : Object.values(catData)) : [];
        }

        // Fetch products node
        const prodRes = await fetch(`${baseUrl}/catalog/products.json${authParam}`);
        if (prodRes.ok) {
          const prodData = await prodRes.json();
          remoteProducts = prodData ? (Array.isArray(prodData) ? prodData : Object.values(prodData)) : [];
        }
      } else if (config.source === "gas") {
        const url = new URL(config.gasUrl);
        url.searchParams.set("action", "pull_catalog");
        if (config.gasSecret) {
          url.searchParams.set("secret", config.gasSecret);
        }

        const response = await fetch(url.toString(), { method: "GET" });
        if (!response.ok) {
          throw new Error(`GAS HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        remoteCategories = result.categories || [];
        remoteProducts = result.products || [];
      }

      if (remoteCategories.length === 0 && remoteProducts.length === 0) {
        this.log("Remote catalog returned no entries. Local data maintained.");
        alert("No catalog records found on remote server.");
        return { success: true, count: 0 };
      }

      // Upsert remote items into local IndexedDB
      await DB.syncUpsertCatalog(remoteCategories, remoteProducts);
      this.log(`Catalog updated: ${remoteCategories.length} categories, ${remoteProducts.length} products loaded.`);
      Bus.emit("sync:completed", { type: "catalog" });

      alert(`Catalog Synchronized: ${remoteCategories.length} categories and ${remoteProducts.length} products updated.`);
      return { success: true, categories: remoteCategories.length, products: remoteProducts.length };
    } catch (err) {
      this.log(`Catalog pull failed: ${err.message}`);
      alert(`Fetch Error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
};

// REMARK: SYNC_JS_MODULARIZATION_COMPLETE