/**
 * Module Description: Admin Inventory Monitoring & Stock Adjustment Sub-Module
 * Manages real-time low-stock and out-of-stock monitoring, global threshold configuration,
 * per-item custom threshold overrides, live search filtering, and quick-replenishment
 * stock adjustment dialogs.
 */

import { DB } from "../db.js";
import { Bus } from "../bus.js";
import { Sync } from "../sync.js";

export const AdminInventory = {
  elements: {},
  callbacks: {},
  activeStockAdjustItem: null,
  initialized: false,

  /**
   * Initializes DOM selections and binds inventory threshold and adjustment events
   * @param {Object} callbacks - External notification hooks
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    this.elements = {
      statMonitoredCount: document.getElementById("stat-monitored-count"),
      statLowStockCount: document.getElementById("stat-low-stock-count"),
      statOutStockCount: document.getElementById("stat-out-stock-count"),
      statUnmonitoredCount: document.getElementById("stat-unmonitored-count"),
      inputGeneralThreshold: document.getElementById("input-general-threshold"),
      btnSaveGeneralThreshold: document.getElementById("btn-save-general-threshold"),
      inputInventorySearch: document.getElementById("input-inventory-search"),
      inventoryAdminTbody: document.getElementById("inventory-admin-tbody"),

      // Stock Adjustment Modal Elements
      modalStockAdjust: document.getElementById("modal-stock-adjust"),
      stockAdjustItemTitle: document.getElementById("stock-adjust-item-title"),
      stockAdjustCurrentLabel: document.getElementById("stock-adjust-current-label"),
      stockAdjustItemId: document.getElementById("stock-adjust-item-id"),
      inputSetAbsoluteStock: document.getElementById("input-set-absolute-stock"),
      inputItemThresholdOverride: document.getElementById("input-item-threshold-override"),
      quickStockButtons: document.querySelectorAll(".btn-quick-stock"),
      btnCloseStockAdjust: document.getElementById("btn-close-stock-adjust"),
      btnCancelStockAdjust: document.getElementById("btn-cancel-stock-adjust"),
      btnSaveStockAdjust: document.getElementById("btn-save-stock-adjust")
    };

    if (this.initialized) return;
    this.initialized = true;

    // Load saved general low-stock threshold setting
    if (this.elements.inputGeneralThreshold) {
      const savedThreshold = localStorage.getItem("pos_general_low_stock_threshold") || "5";
      this.elements.inputGeneralThreshold.value = savedThreshold;
    }

    // Save global low-stock threshold trigger
    if (this.elements.btnSaveGeneralThreshold) {
      this.elements.btnSaveGeneralThreshold.onclick = async () => {
        const val = parseInt(this.elements.inputGeneralThreshold.value, 10);
        if (isNaN(val) || val < 1) {
          alert("Please enter a valid warning threshold of at least 1 unit.");
          return;
        }
        localStorage.setItem("pos_general_low_stock_threshold", String(val));
        alert(`General low-stock warning threshold updated to ${val} units.`);
        await this.loadInventoryMonitoring();
        Bus.emit("inventory:updated");

        if (typeof this.callbacks.onCatalogModified === "function") {
          this.callbacks.onCatalogModified();
        }
      };
    }

    // Real-time table search filter
    if (this.elements.inputInventorySearch) {
      this.elements.inputInventorySearch.oninput = () => {
        const query = this.elements.inputInventorySearch.value.trim().toLowerCase();
        this.filterInventoryRows(query);
      };
    }

    // Modal dismiss controls
    if (this.elements.btnCloseStockAdjust) {
      this.elements.btnCloseStockAdjust.onclick = () => {
        if (this.elements.modalStockAdjust && this.elements.modalStockAdjust.open) {
          this.elements.modalStockAdjust.close();
        }
      };
    }

    if (this.elements.btnCancelStockAdjust) {
      this.elements.btnCancelStockAdjust.onclick = () => {
        if (this.elements.modalStockAdjust && this.elements.modalStockAdjust.open) {
          this.elements.modalStockAdjust.close();
        }
      };
    }

    // Quick stock addition helpers (+5, +10, +25, +50, +100, custom)
    if (this.elements.quickStockButtons) {
      this.elements.quickStockButtons.forEach((btn) => {
        btn.onclick = () => {
          if (!this.activeStockAdjustItem) return;
          const val = btn.dataset.val;
          const currentVal = parseInt(this.elements.inputSetAbsoluteStock.value, 10) || 0;
          if (val === "custom") {
            if (this.elements.inputSetAbsoluteStock) {
              this.elements.inputSetAbsoluteStock.focus();
              this.elements.inputSetAbsoluteStock.select();
            }
          } else {
            const addUnits = parseInt(val, 10) || 0;
            if (this.elements.inputSetAbsoluteStock) {
              this.elements.inputSetAbsoluteStock.value = Math.max(0, currentVal + addUnits);
            }
          }
        };
      });
    }

    // Save stock adjustment action
    if (this.elements.btnSaveStockAdjust) {
      this.elements.btnSaveStockAdjust.onclick = async () => {
        if (!this.activeStockAdjustItem) return;

        const newStock = Math.max(0, parseInt(this.elements.inputSetAbsoluteStock.value, 10) || 0);
        const thresholdRaw = this.elements.inputItemThresholdOverride.value.trim();
        const newThreshold = thresholdRaw !== "" ? Math.max(0, parseInt(thresholdRaw, 10)) : null;

        await DB.updateProduct(this.activeStockAdjustItem.id, {
          stock: newStock,
          threshold: newThreshold,
          isAvailable: newStock > 0
        });

        if (this.elements.modalStockAdjust && this.elements.modalStockAdjust.open) {
          this.elements.modalStockAdjust.close();
        }

        await this.loadInventoryMonitoring();
        Bus.emit("inventory:updated");

        if (typeof this.callbacks.onCatalogModified === "function") {
          this.callbacks.onCatalogModified();
        }

        Sync.pushPendingOrders({ silent: true }).catch(() => {});
      };
    }
  },

  /**
   * Evaluates product stock counts against warning thresholds and renders table rows
   */
  async loadInventoryMonitoring() {
    if (!this.elements.inventoryAdminTbody) return;

    const products = await DB.getProducts("all");
    const generalThreshold = parseInt(localStorage.getItem("pos_general_low_stock_threshold") || "5", 10);

    let monitoredCount = 0;
    let lowStockCount = 0;
    let outStockCount = 0;
    let unmonitoredCount = 0;

    products.forEach((p) => {
      if (p.isMonitored) {
        monitoredCount++;
        const effThreshold = (p.threshold !== null && p.threshold !== undefined && p.threshold !== "")
          ? parseInt(p.threshold, 10)
          : generalThreshold;

        const currentStock = typeof p.stock === "number" ? p.stock : 0;
        if (currentStock <= 0) {
          outStockCount++;
        } else if (currentStock <= effThreshold) {
          lowStockCount++;
        }
      } else {
        unmonitoredCount++;
      }
    });

    if (this.elements.statMonitoredCount) this.elements.statMonitoredCount.textContent = String(monitoredCount);
    if (this.elements.statLowStockCount) this.elements.statLowStockCount.textContent = String(lowStockCount);
    if (this.elements.statOutStockCount) this.elements.statOutStockCount.textContent = String(outStockCount);
    if (this.elements.statUnmonitoredCount) this.elements.statUnmonitoredCount.textContent = String(unmonitoredCount);

    this.elements.inventoryAdminTbody.innerHTML = products.map((prod) => {
      const isMon = Boolean(prod.isMonitored);
      const effThreshold = (prod.threshold !== null && prod.threshold !== undefined && prod.threshold !== "")
        ? parseInt(prod.threshold, 10)
        : generalThreshold;

      let statusBadge = "";
      let stockDisplay = "";
      let thresholdDisplay = "";

      if (isMon) {
        const stock = typeof prod.stock === "number" ? prod.stock : 0;
        stockDisplay = `<b>${stock}</b> units`;
        thresholdDisplay = prod.threshold !== null && prod.threshold !== undefined && prod.threshold !== ""
          ? `${prod.threshold} (Custom)`
          : `${generalThreshold} (Default)`;

        if (stock <= 0) {
          statusBadge = `<span class="badge badge-status-out">OUT OF STOCK</span>`;
        } else if (stock <= effThreshold) {
          statusBadge = `<span class="badge badge-status-low">⚠️ LOW STOCK (${stock})</span>`;
        } else {
          statusBadge = `<span class="badge badge-status-ok">IN STOCK</span>`;
        }
      } else {
        stockDisplay = `<span style="color:var(--text-muted);">Not Counted</span>`;
        thresholdDisplay = `<span style="color:var(--text-muted);">-</span>`;
        statusBadge = prod.isAvailable !== false
          ? `<span class="badge badge-status-ok">AVAILABLE</span>`
          : `<span class="badge badge-status-unavail">UNAVAILABLE</span>`;
      }

      return `
        <tr data-name="${(prod.name || "").toLowerCase()}">
          <td><b>${prod.name || "Item"}</b></td>
          <td>${(prod.cat || "").toUpperCase()}</td>
          <td>
            <span class="badge ${isMon ? "badge-monitored" : "badge-unmonitored"}">
              ${isMon ? "MONITORED" : "UNMONITORED"}
            </span>
          </td>
          <td>${stockDisplay}</td>
          <td>${thresholdDisplay}</td>
          <td>${statusBadge}</td>
          <td class="text-center">
            ${
              isMon
                ? `<button type="button" class="btn-action-sm btn-action-stock btn-trigger-stock" data-id="${prod.id}">⚡ Adjust Stock</button>`
                : `<button type="button" class="btn-action-sm btn-action-toggle btn-toggle-avail" data-id="${prod.id}">${prod.isAvailable !== false ? "Disable" : "Enable"}</button>`
            }
          </td>
        </tr>
      `;
    }).join("");

    this.elements.inventoryAdminTbody.querySelectorAll(".btn-trigger-stock").forEach((btn) => {
      btn.onclick = async () => {
        const prod = await DB.getProductById(btn.dataset.id);
        if (prod) this.openStockAdjustModal(prod);
      };
    });

    this.elements.inventoryAdminTbody.querySelectorAll(".btn-toggle-avail").forEach((btn) => {
      btn.onclick = async () => {
        const prod = await DB.getProductById(btn.dataset.id);
        if (prod) {
          const updatedState = prod.isAvailable === false;
          await DB.updateProduct(prod.id, { isAvailable: updatedState });
          await this.loadInventoryMonitoring();
          Bus.emit("inventory:updated");

          if (typeof this.callbacks.onCatalogModified === "function") {
            this.callbacks.onCatalogModified();
          }

          Sync.pushPendingOrders({ silent: true }).catch(() => {});
        }
      };
    });
  },

  /**
   * Opens the stock replenishment modal
   * @param {Object} prod - Product entity
   */
  openStockAdjustModal(prod) {
    this.activeStockAdjustItem = prod;

    if (this.elements.stockAdjustItemId) this.elements.stockAdjustItemId.value = prod.id;
    if (this.elements.stockAdjustItemTitle) this.elements.stockAdjustItemTitle.textContent = `Adjust Stock: ${prod.name}`;
    if (this.elements.stockAdjustCurrentLabel) {
      this.elements.stockAdjustCurrentLabel.textContent = `Current Stock: ${typeof prod.stock === "number" ? prod.stock : 0} units`;
    }
    if (this.elements.inputSetAbsoluteStock) {
      this.elements.inputSetAbsoluteStock.value = typeof prod.stock === "number" ? prod.stock : 0;
    }
    if (this.elements.inputItemThresholdOverride) {
      this.elements.inputItemThresholdOverride.value = (prod.threshold !== null && prod.threshold !== undefined && prod.threshold !== "") ? prod.threshold : "";
    }

    if (this.elements.modalStockAdjust && typeof this.elements.modalStockAdjust.showModal === "function") {
      this.elements.modalStockAdjust.showModal();
      setTimeout(() => {
        if (this.elements.inputSetAbsoluteStock) {
          this.elements.inputSetAbsoluteStock.focus();
          this.elements.inputSetAbsoluteStock.select();
        }
      }, 100);
    }
  },

  /**
   * Filters inventory table rows by product name query
   * @param {string} query - Clean lowercase string
   */
  filterInventoryRows(query) {
    if (!this.elements.inventoryAdminTbody) return;
    const rows = this.elements.inventoryAdminTbody.querySelectorAll("tr[data-name]");
    rows.forEach((row) => {
      const name = row.dataset.name || "";
      row.style.display = name.includes(query) ? "" : "none";
    });
  }
};

// REMARK: ADMIN_INVENTORY_JS_MODULARIZATION_COMPLETE