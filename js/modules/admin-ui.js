/**
 * Module Description: Back-Office Administration Master Facade & Portal Controller
 * Central architectural facade orchestrating administration sub-modules:
 * AdminSales, AdminItems, AdminInventory, AdminCategories, AdminUsers,
 * AdminStore, and AdminSync. Manages administrator screen display security
 * gates and tab navigation routing.
 */

import { Session } from "./session.js";
import { AdminSales } from "./admin/admin-sales.js";
import { AdminItems } from "./admin/admin-items.js";
import { AdminInventory } from "./admin/admin-inventory.js";
import { AdminCategories } from "./admin/admin-categories.js";
import { AdminUsers } from "./admin/admin-users.js";
import { AdminStore } from "./admin/admin-store.js";
import { AdminSync } from "./admin/admin-sync.js";

export const AdminUI = {
  elements: {},
  callbacks: {},
  initialized: false,

  // Sub-Module References
  sales: AdminSales,
  items: AdminItems,
  inventory: AdminInventory,
  categories: AdminCategories,
  users: AdminUsers,
  store: AdminStore,
  sync: AdminSync,

  /**
   * Initializes master portal DOM bindings and bootstraps all sub-modules
   * @param {Object} callbacks - External modification hooks
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    this.elements = {
      adminScreen: document.getElementById("admin-screen"),
      btnOpenAdmin: document.getElementById("btn-open-admin"),
      btnCloseAdmin: document.getElementById("btn-close-admin"),
      adminTabButtons: document.querySelectorAll(".btn-admin-tab"),
      adminTabPanes: document.querySelectorAll(".admin-tab-pane")
    };

    if (this.initialized) return;
    this.initialized = true;

    // Open Admin Portal (Security Clearance Gated)
    if (this.elements.btnOpenAdmin) {
      this.elements.btnOpenAdmin.onclick = async () => {
        if (!Session.isAdmin()) {
          alert("Access Denied: Administrator role required.");
          return;
        }
        if (this.elements.adminScreen) {
          this.elements.adminScreen.classList.remove("hidden");
        }
        await this.switchTab("sales");
      };
    }

    // Close Admin Portal
    if (this.elements.btnCloseAdmin) {
      this.elements.btnCloseAdmin.onclick = () => {
        if (this.elements.adminScreen) {
          this.elements.adminScreen.classList.add("hidden");
        }
      };
    }

    // Tab Navigation Routing
    if (this.elements.adminTabButtons) {
      this.elements.adminTabButtons.forEach((btn) => {
        btn.onclick = async () => {
          await this.switchTab(btn.dataset.tab);
        };
      });
    }

    // Initialize all isolated sub-modules
    this.sales.init(this.callbacks);
    this.items.init(this.callbacks);
    this.inventory.init(this.callbacks);
    this.categories.init(this.callbacks);
    this.users.init(this.callbacks);
    this.store.init(this.callbacks);
    this.sync.init(this.callbacks);
  },

  /**
   * Switches active administration tab pane and invokes sub-module loader
   * @param {string} tabName - Identifier of selected tab
   */
  async switchTab(tabName) {
    if (this.elements.adminTabButtons) {
      this.elements.adminTabButtons.forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === tabName);
      });
    }

    if (this.elements.adminTabPanes) {
      this.elements.adminTabPanes.forEach((p) => {
        p.classList.toggle("active", p.id === `pane-${tabName}`);
      });
    }

    if (tabName === "sales") {
      await this.sales.loadSalesReport();
    } else if (tabName === "items") {
      await this.items.loadAdminItems();
    } else if (tabName === "inventory") {
      await this.inventory.loadInventoryMonitoring();
    } else if (tabName === "categories") {
      await this.categories.loadAdminCategories();
    } else if (tabName === "users") {
      await this.users.loadAdminUsers();
    } else if (tabName === "store") {
      await this.store.loadStoreSettings();
    } else if (tabName === "sync") {
      await this.sync.loadSyncSettings();
    }
  },

  // Facade Proxy Delegates for Backward Compatibility
  openVoidOrderModal(ordId, ordNum) {
    this.sales.openVoidOrderModal(ordId, ordNum);
  },

  openItemEditor(item = null) {
    this.items.openItemEditor(item);
  },

  openStockAdjustModal(prod) {
    this.inventory.openStockAdjustModal(prod);
  },

  openCategoryEditor(cat = null) {
    this.categories.openCategoryEditor(cat);
  },

  openUserEditor(user = null) {
    this.users.openUserEditor(user);
  }
};

// REMARK: ADMIN_UI_JS_MODULARIZATION_COMPLETE