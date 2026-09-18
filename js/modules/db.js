/**
 * Module Description: Local Offline Storage Subsystem (Dexie.js / IndexedDB)
 * Persists staff accounts, product catalog (with creation timestamps for chronological sorting),
 * categories (with batch order re-indexing for auto and manual sorting), completed sales orders,
 * line-item void audit logs, thermal printer hub hardware targets, store profile configuration
 * (including buzzer/pager toggle and quantity capacity), and offline sync queues. Implements
 * atomic stock deduction upon sale, soft-void cancellation, and cloud delta synchronization.
 */

// Fallback image SVGs for category and product initialization
const SVG_CAT_ALL = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><path d='M3 4h8v8H3V4zm10 0h8v8h-8V4zM3 14h8v8H3v-8zm10 0h8v8h-8v-8z'/></svg>";
const SVG_CAT_BEV = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><path d='M2 19h18v2H2v-2zm18-8v-2h-2V3H4v6H2v2c0 2.21 1.79 4 4 4h8c1.86 0 3.41-1.28 3.86-3H18c1.1 0 2-.9 2-2zm-4-6v6H6V5h10zm2 6h-2V5h2v6z'/></svg>";
const SVG_CAT_MEALS = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><path d='M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z'/></svg>";
const SVG_CAT_SNACKS = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'/></svg>";

if (typeof window.Dexie === "undefined") {
  throw new Error("[DB Init Error] Dexie.js is not loaded on the window object.");
}

// Initialize Dexie instance
const localDB = new window.Dexie("LokalexPOSDB");

// Define Stores and Database Migrations
localDB.version(1).stores({
  users: "id, pin, badgeCode, role",
  categories: "id, order",
  products: "id, cat, bc",
  orders: "++id, orderNumber, cashierId, timestamp",
  voidLogs: "++id, itemId, managerId, timestamp"
});

localDB.version(2).stores({
  printers: "id, name, type, isEnabled"
});

localDB.version(3).stores({
  printers: "id, name, type, role, isEnabled"
});

localDB.version(4).stores({
  orders: "++id, orderNumber, cashierId, synced, timestamp",
  settings: "key"
});

// Version 5: Monitored inventory support, soft-void order tracking, and stock synchronization queue
localDB.version(5).stores({
  products: "id, cat, bc, isMonitored, isAvailable",
  orders: "++id, orderNumber, cashierId, status, synced, timestamp",
  stockQueue: "id"
});

// Version 6: Addons category classification for Quick Menu shelf
localDB.version(6).stores({
  categories: "id, order, isAddon"
});

// Version 7: Index creation timestamps for product catalog sorting
localDB.version(7).stores({
  products: "id, cat, bc, isMonitored, isAvailable, createdAt"
});

export const DB = {
  instance: localDB,
  initPromise: null,

  /**
   * Initializes database and seeds master records if empty
   */
  async init() {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      await localDB.open();

      // 1. Seed Users if empty
      const userCount = await localDB.users.count();
      if (userCount === 0) {
        await localDB.users.bulkAdd([
          {
            id: "USR-001",
            name: "Amiel (Staff)",
            pin: "1234",
            badgeCode: "STAFF-01",
            role: "user"
          },
          {
            id: "ADM-001",
            name: "Amiel (Admin)",
            pin: "8821",
            badgeCode: "MGR-AUTH-8821",
            role: "admin"
          }
        ]);
      }

      // 2. Seed Categories if empty
      const catCount = await localDB.categories.count();
      if (catCount === 0) {
        await localDB.categories.bulkAdd([
          { id: "all", name: "All Items", image: SVG_CAT_ALL, order: 1, isAddon: false },
          { id: "beverages", name: "Beverages", image: SVG_CAT_BEV, order: 2, isAddon: false },
          { id: "meals", name: "Meals", image: SVG_CAT_MEALS, order: 3, isAddon: false },
          { id: "snacks", name: "Snacks", image: SVG_CAT_SNACKS, order: 4, isAddon: false }
        ]);
      }

      // 3. Seed Products if empty
      const prodCount = await localDB.products.count();
      if (prodCount === 0) {
        await localDB.products.bulkAdd([
          {
            id: "P1",
            name: "Iced Americano",
            price: 110.0,
            cat: "beverages",
            bc: "1001",
            image: "img/iced-americano.png",
            isMonitored: false,
            stock: 0,
            threshold: null,
            isAvailable: true,
            createdAt: "2026-01-01T08:00:00.000Z"
          },
          {
            id: "P2",
            name: "Cafe Latte",
            price: 130.0,
            cat: "beverages",
            bc: "1002",
            image: "img/cafe-latte.png",
            isMonitored: false,
            stock: 0,
            threshold: null,
            isAvailable: true,
            createdAt: "2026-01-01T08:05:00.000Z"
          },
          {
            id: "P3",
            name: "Pork Sisig Rice",
            price: 165.0,
            cat: "meals",
            bc: "1003",
            image: "img/pork-sisig.png",
            isMonitored: true,
            stock: 15,
            threshold: 5,
            isAvailable: true,
            createdAt: "2026-01-01T08:10:00.000Z"
          },
          {
            id: "P4",
            name: "Choco Crinkles",
            price: 75.0,
            cat: "snacks",
            bc: "1004",
            image: "img/choco-crinkles.png",
            isMonitored: true,
            stock: 24,
            threshold: 6,
            isAvailable: true,
            createdAt: "2026-01-01T08:15:00.000Z"
          }
        ]);
      }

      // 4. Seed Printers if empty
      const printerCount = await localDB.printers.count();
      if (printerCount === 0) {
        await localDB.printers.bulkAdd([
          {
            id: "PRN-001",
            name: "Cashier Counter Thermal",
            type: "network",
            role: "primary",
            address: "192.168.1.100",
            port: 9100,
            paperWidth: "58mm",
            isEnabled: true
          }
        ]);
      }

      // 5. Seed Default Cloud Sync Settings if empty
      const syncSetting = await localDB.settings.get("cloud_sync");
      if (!syncSetting) {
        await localDB.settings.put({
          key: "cloud_sync",
          source: "firebase",
          firebaseUrl: "",
          firebaseAuth: "",
          gasUrl: "",
          gasSecret: "",
          lastSync: null
        });
      }

      // 6. Seed Default Store Profile Settings if empty
      const storeSetting = await localDB.settings.get("store_settings");
      if (!storeSetting) {
        await localDB.settings.put({
          key: "store_settings",
          storeName: "LOKALEX STORE",
          companyName: "Lokalex Delivery Services",
          address: "Camiling, Tarlac, Philippines",
          contactNumber: "0917-123-4567",
          tagline: "Fast, Fresh & Local Delivery",
          logoBase64: "",
          useNumberPager: false,
          pagerCount: 24
        });
      }
    })();

    return this.initPromise;
  },

  /**
   * Store Settings & Profile Configuration
   */
  async getStoreSettings() {
    const settings = await localDB.settings.get("store_settings");
    return settings || {
      key: "store_settings",
      storeName: "LOKALEX STORE",
      companyName: "Lokalex Delivery Services",
      address: "Camiling, Tarlac, Philippines",
      contactNumber: "0917-123-4567",
      tagline: "Fast, Fresh & Local Delivery",
      logoBase64: "",
      useNumberPager: false,
      pagerCount: 24
    };
  },

  async saveStoreSettings(updates) {
    const current = await this.getStoreSettings();
    const merged = { ...current, ...updates, key: "store_settings" };
    await localDB.settings.put(merged);
    return merged;
  },

  /**
   * Cloud Sync Configuration & Settings Operations
   */
  async getSyncConfig() {
    const config = await localDB.settings.get("cloud_sync");
    return config || {
      source: "firebase",
      firebaseUrl: "",
      firebaseAuth: "",
      gasUrl: "",
      gasSecret: "",
      lastSync: null
    };
  },

  async saveSyncConfig(updates) {
    const current = await this.getSyncConfig();
    const merged = { ...current, ...updates, key: "cloud_sync" };
    await localDB.settings.put(merged);
    return merged;
  },

  /**
   * Sync Queue Management for Orders & Stock
   */
  async getUnsyncedOrders() {
    return await localDB.orders.filter(ord => ord.synced === 0 || !ord.synced).toArray();
  },

  async markOrdersAsSynced(orderIds) {
    if (!orderIds || orderIds.length === 0) return;
    await localDB.transaction("rw", localDB.orders, async () => {
      for (const id of orderIds) {
        await localDB.orders.update(id, { synced: 1 });
      }
    });
  },

  /**
   * Retrieves pending modified stocks to sync minimal byte payloads
   */
  async getUnsyncedStock() {
    const queueEntries = await localDB.stockQueue.toArray();
    if (queueEntries.length === 0) return {};

    const stockMap = {};
    for (const item of queueEntries) {
      const prod = await localDB.products.get(item.id);
      if (prod && prod.isMonitored) {
        stockMap[item.id] = {
          stock: typeof prod.stock === "number" ? prod.stock : 0,
          isAvailable: Boolean(prod.isAvailable)
        };
      }
    }
    return stockMap;
  },

  async clearStockQueue(productIds) {
    if (!productIds || productIds.length === 0) return;
    await localDB.transaction("rw", localDB.stockQueue, async () => {
      for (const id of productIds) {
        await localDB.stockQueue.delete(id);
      }
    });
  },

  /**
   * Upsert Remote Products & Categories into Local IndexedDB
   */
  async syncUpsertCatalog(remoteCategories, remoteProducts) {
    await localDB.transaction("rw", localDB.categories, localDB.products, async () => {
      if (Array.isArray(remoteCategories) && remoteCategories.length > 0) {
        await localDB.categories.bulkPut(remoteCategories);
      }
      if (Array.isArray(remoteProducts) && remoteProducts.length > 0) {
        await localDB.products.bulkPut(remoteProducts);
      }
    });
  },

  /**
   * Multi-Printer Hub Queries & CRUD
   */
  async getPrinters() {
    return await localDB.printers.toArray();
  },

  async getEnabledPrinters() {
    return await localDB.printers.filter(p => Boolean(p.isEnabled)).toArray();
  },

  async getPrinterById(id) {
    return await localDB.printers.where("id").equals(id).first();
  },

  async addPrinter(printer) {
    const newPrinter = {
      id: printer.id || `PRN-${Date.now().toString().slice(-4)}`,
      name: (printer.name || "").trim(),
      type: printer.type || "network",
      role: printer.role || "primary",
      address: (printer.address || "").trim(),
      port: parseInt(printer.port, 10) || 9100,
      btName: (printer.btName || "").trim(),
      usbPort: (printer.usbPort || "").trim(),
      paperWidth: printer.paperWidth || "58mm",
      isEnabled: printer.isEnabled !== undefined ? Boolean(printer.isEnabled) : true
    };
    await localDB.printers.add(newPrinter);
    return newPrinter;
  },

  async updatePrinter(id, updates) {
    const formatted = { ...updates };
    if (formatted.name !== undefined) formatted.name = formatted.name.trim();
    if (formatted.address !== undefined) formatted.address = formatted.address.trim();
    if (formatted.port !== undefined) formatted.port = parseInt(formatted.port, 10) || 9100;
    if (formatted.btName !== undefined) formatted.btName = formatted.btName.trim();
    if (formatted.usbPort !== undefined) formatted.usbPort = formatted.usbPort.trim();
    if (formatted.isEnabled !== undefined) formatted.isEnabled = Boolean(formatted.isEnabled);

    await localDB.printers.update(id, formatted);
    return await this.getPrinterById(id);
  },

  async setPrinterRole(id, role) {
    const targetRole = ["primary", "secondary", "both"].includes(role) ? role : "primary";
    await localDB.printers.update(id, { role: targetRole });
    return await this.getPrinterById(id);
  },

  async togglePrinterEnabled(id, isEnabled) {
    await localDB.printers.update(id, { isEnabled: Boolean(isEnabled) });
    return await this.getPrinterById(id);
  },

  async deletePrinter(id) {
    return await localDB.printers.delete(id);
  },

  /**
   * Category Queries & CRUD
   */
  async getCategories() {
    return await localDB.categories.orderBy("order").toArray();
  },

  async getCategoryById(id) {
    return await localDB.categories.where("id").equals(id).first();
  },

  async getAddonCategories() {
    return await localDB.categories.filter(c => Boolean(c.isAddon)).toArray();
  },

  async addCategory(category) {
    const slug = (category.name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const newCategory = {
      id: category.id || slug || `cat-${Date.now().toString().slice(-4)}`,
      name: (category.name || "").trim(),
      order: parseInt(category.order, 10) || 99,
      image: category.image || SVG_CAT_ALL,
      isAddon: Boolean(category.isAddon)
    };

    await localDB.categories.add(newCategory);
    return newCategory;
  },

  async updateCategory(id, updates) {
    const formatted = { ...updates };
    if (formatted.name !== undefined) formatted.name = formatted.name.trim();
    if (formatted.order !== undefined) formatted.order = parseInt(formatted.order, 10) || 99;
    if (formatted.isAddon !== undefined) formatted.isAddon = Boolean(formatted.isAddon);
    await localDB.categories.update(id, formatted);
    return await this.getCategoryById(id);
  },

  /**
   * Atomically batch-updates display order values across multiple categories
   * @param {Array<{id: string, order: number}>} orderList
   */
  async updateCategoryOrders(orderList) {
    if (!Array.isArray(orderList) || orderList.length === 0) return;
    await localDB.transaction("rw", localDB.categories, async () => {
      for (const item of orderList) {
        await localDB.categories.update(item.id, { order: parseInt(item.order, 10) || 1 });
      }
    });
  },

  async deleteCategory(id) {
    if (id === "all") throw new Error("Cannot delete root 'all' category.");
    return await localDB.categories.delete(id);
  },

  /**
   * Product Queries & CRUD
   */
  async getProducts(category = "all") {
    if (category === "all") {
      return await localDB.products.toArray();
    }
    return await localDB.products.where("cat").equals(category).toArray();
  },

  async getAddonProducts() {
    const addonCategories = await this.getAddonCategories();
    if (addonCategories.length === 0) return [];
    const addonCatIds = new Set(addonCategories.map(c => c.id));
    return await localDB.products.filter(p => addonCatIds.has(p.cat)).toArray();
  },

  async getProductByBarcode(barcode) {
    return await localDB.products.where("bc").equals(barcode).first();
  },

  async getProductById(id) {
    return await localDB.products.where("id").equals(id).first();
  },

  async addProduct(product) {
    const isMon = Boolean(product.isMonitored);
    const stockVal = isMon ? Math.max(0, parseInt(product.stock, 10) || 0) : 0;
    const isAvailable = isMon ? (stockVal > 0) : (product.isAvailable !== false);

    const newProduct = {
      id: product.id || `P${Date.now().toString().slice(-5)}`,
      name: (product.name || "").trim(),
      price: Math.max(0, Number(product.price) || 0.0),
      cat: product.cat || "all",
      bc: (product.bc || "").trim(),
      image: product.image || "",
      isMonitored: isMon,
      stock: stockVal,
      threshold: (product.threshold !== null && product.threshold !== undefined && product.threshold !== "")
        ? Math.max(0, parseInt(product.threshold, 10) || 0)
        : null,
      isAvailable,
      createdAt: product.createdAt || new Date().toISOString()
    };

    await localDB.products.add(newProduct);
    if (isMon) {
      await localDB.stockQueue.put({ id: newProduct.id });
    }
    return newProduct;
  },

  async updateProduct(id, updates) {
    const formatted = { ...updates };
    if (formatted.price !== undefined) formatted.price = Math.max(0, Number(formatted.price) || 0.0);
    if (formatted.name !== undefined) formatted.name = formatted.name.trim();
    if (formatted.bc !== undefined) formatted.bc = formatted.bc.trim();
    if (formatted.stock !== undefined) {
      formatted.stock = Math.max(0, parseInt(formatted.stock, 10) || 0);
      if (formatted.isMonitored || updates.isMonitored) {
        formatted.isAvailable = formatted.stock > 0;
      }
    }

    await localDB.products.update(id, formatted);
    const prod = await this.getProductById(id);
    if (prod && prod.isMonitored) {
      await localDB.stockQueue.put({ id: prod.id });
    }
    return prod;
  },

  async deleteProduct(id) {
    await localDB.stockQueue.delete(id);
    return await localDB.products.delete(id);
  },

  /**
   * User & Authentication Queries & CRUD
   */
  async getUsers() {
    return await localDB.users.toArray();
  },

  async getUserById(id) {
    return await localDB.users.where("id").equals(id).first();
  },

  async authenticateUser(pinOrBadge) {
    const trimmed = String(pinOrBadge).trim();
    const user = await localDB.users
      .filter(u => u.pin === trimmed || u.badgeCode === trimmed)
      .first();

    return user || null;
  },

  async verifyManagerBadge(badgeOrPin) {
    const user = await this.authenticateUser(badgeOrPin);
    if (user && (user.role === "admin" || user.role === "manager")) {
      return user;
    }
    return null;
  },

  async addUser(user) {
    const newUser = {
      id: user.id || `USR-${Date.now().toString().slice(-4)}`,
      name: (user.name || "").trim(),
      pin: String(user.pin).trim(),
      badgeCode: (user.badgeCode || "").trim(),
      role: (user.role === "admin" || user.role === "manager") ? user.role : "user"
    };
    await localDB.users.add(newUser);
    return newUser;
  },

  async updateUser(id, updates) {
    const formatted = { ...updates };
    if (formatted.name !== undefined) formatted.name = formatted.name.trim();
    if (formatted.pin !== undefined) formatted.pin = String(formatted.pin).trim();
    if (formatted.badgeCode !== undefined) formatted.badgeCode = (formatted.badgeCode || "").trim();
    if (formatted.role !== undefined) {
      formatted.role = (formatted.role === "admin" || formatted.role === "manager") ? formatted.role : "user";
    }
    await localDB.users.update(id, formatted);
    return await this.getUserById(id);
  },

  async deleteUser(id) {
    return await localDB.users.delete(id);
  },

  /**
   * Order Persistence with Atomic Stock Deduction
   */
  async saveOrder(orderData) {
    const sanitizedItems = (orderData.items || []).map(item => ({
      id: item.id,
      name: item.name || "Item",
      price: Math.max(0, Number(item.price) || 0.0),
      qty: Math.max(1, parseInt(item.qty, 10) || 1)
    }));

    const record = {
      orderNumber: orderData.orderNumber || `ORD-${Date.now().toString().slice(-6)}`,
      cashierId: orderData.cashierId || "STAFF-01",
      cashierName: orderData.cashierName || "Cashier",
      items: sanitizedItems,
      vatableSales: Math.max(0, Number(orderData.vatableSales) || 0.0),
      vatAmount: Math.max(0, Number(orderData.vatAmount) || 0.0),
      total: Math.max(0, Number(orderData.total) || 0.0),
      paymentType: orderData.paymentType || "CASH",
      amountTendered: orderData.amountTendered ? Math.max(0, Number(orderData.amountTendered)) : null,
      changeAmount: orderData.changeAmount ? Math.max(0, Number(orderData.changeAmount)) : null,
      gcashRefNo: orderData.gcashRefNo || null,
      gcashAmountPaid: orderData.gcashAmountPaid ? Math.max(0, Number(orderData.gcashAmountPaid)) : null,
      gcashPaymentDate: orderData.gcashPaymentDate || null,
      pagerNumber: orderData.pagerNumber || null,
      status: "COMPLETED",
      timestamp: new Date().toISOString(),
      synced: 0
    };

    let insertedId;

    await localDB.transaction("rw", [localDB.orders, localDB.products, localDB.stockQueue], async () => {
      insertedId = await localDB.orders.add(record);

      for (const item of sanitizedItems) {
        const product = await localDB.products.get(item.id);
        if (product && product.isMonitored) {
          const currentStock = typeof product.stock === "number" ? product.stock : 0;
          const updatedStock = Math.max(0, currentStock - item.qty);
          await localDB.products.update(item.id, {
            stock: updatedStock,
            isAvailable: updatedStock > 0
          });
          await localDB.stockQueue.put({ id: item.id });
        }
      }
    });

    return { ...record, id: insertedId };
  },

  /**
   * Post-Checkout Manager Void Workflow
   */
  async voidOrder(orderIdOrNumber, manager, reason = "Manager Void") {
    let order;
    if (typeof orderIdOrNumber === "number") {
      order = await localDB.orders.get(orderIdOrNumber);
    } else {
      order = await localDB.orders.where("orderNumber").equals(orderIdOrNumber).first();
    }

    if (!order) {
      throw new Error(`Order ${orderIdOrNumber} not found.`);
    }

    if (order.status === "VOIDED") {
      throw new Error(`Order ${order.orderNumber} has already been voided.`);
    }

    await localDB.transaction("rw", [localDB.orders, localDB.products, localDB.stockQueue, localDB.voidLogs], async () => {
      // 1. Soft-void the order
      await localDB.orders.update(order.id, {
        status: "VOIDED",
        voidedAt: new Date().toISOString(),
        voidedBy: manager ? (manager.name || manager.id) : "Manager",
        voidReason: reason,
        synced: 0
      });

      // 2. Restore monitored item quantities
      for (const item of order.items || []) {
        const product = await localDB.products.get(item.id);
        if (product && product.isMonitored) {
          const currentStock = typeof product.stock === "number" ? product.stock : 0;
          const restoredStock = currentStock + (parseInt(item.qty, 10) || 1);
          await localDB.products.update(item.id, {
            stock: restoredStock,
            isAvailable: true
          });
          await localDB.stockQueue.put({ id: item.id });
        }
      }

      // 3. Record audit log
      await localDB.voidLogs.add({
        orderNumber: order.orderNumber,
        total: order.total,
        managerId: manager ? manager.id : "MGR-001",
        managerName: manager ? manager.name : "Manager",
        reason,
        timestamp: new Date().toISOString()
      });
    });

    return await localDB.orders.get(order.id);
  },

  async getAllOrders() {
    return await localDB.orders.reverse().sortBy("timestamp");
  },

  async getOrderById(id) {
    return await localDB.orders.get(id);
  },

  /**
   * Financial Reporting Aggregations
   */
  async getSalesSummary() {
    const orders = await localDB.orders.toArray();
    let grossSales = 0.0;
    let totalVat = 0.0;
    let cashSales = 0.0;
    let gcashSales = 0.0;
    let completedCount = 0;
    let voidedCount = 0;
    let voidedSales = 0.0;

    for (const order of orders) {
      if (order.status === "VOIDED") {
        voidedCount++;
        voidedSales += (Number(order.total) || 0);
        continue;
      }

      completedCount++;
      grossSales += (Number(order.total) || 0);
      totalVat += (Number(order.vatAmount) || 0);
      if (order.paymentType === "CASH") {
        cashSales += (Number(order.total) || 0);
      } else {
        gcashSales += (Number(order.total) || 0);
      }
    }

    return {
      orderCount: completedCount,
      voidedCount,
      voidedSales: Number(voidedSales.toFixed(2)),
      grossSales: Number(grossSales.toFixed(2)),
      totalVat: Number(totalVat.toFixed(2)),
      cashSales: Number(cashSales.toFixed(2)),
      gcashSales: Number(gcashSales.toFixed(2))
    };
  },

  /**
   * Cart Line Item Void Audit Logging
   */
  async logVoid(item, manager) {
    return await localDB.voidLogs.add({
      itemId: item.id,
      itemName: item.name,
      price: Number(item.price) || 0.0,
      qty: parseInt(item.qty, 10) || 1,
      managerId: manager ? manager.id : "MGR-001",
      managerName: manager ? manager.name : "Manager",
      timestamp: new Date().toISOString()
    });
  }
};

// REMARK: DB_JS_SORTING_SUPPORT_COMPLETE