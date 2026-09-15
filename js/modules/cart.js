/**
 * Module Description: Active Ticket & VAT Calculation Engine
 * Governs active cart line items, validates inventory stock ceilings,
 * enforces item availability toggles, calculates Philippine statutory 12%
 * VAT-inclusive financial totals, and emits reactive state update events.
 */

import { Bus } from "./bus.js";
import { DB } from "./db.js";

export const Cart = {
  items: [],

  /**
   * Adds or increments a product in the active cart with stock verification
   * @param {Object} product - Product entity from database
   * @param {number} quantity - Quantity to add
   * @returns {Object} { ok: boolean, reason?: string, currentQty?: number }
   */
  add(product, quantity = 1) {
    if (!product || !product.id) {
      return { ok: false, reason: "invalid_product" };
    }

    // 1. Check availability flag for both unmonitored and monitored goods
    if (product.isAvailable === false) {
      Bus.emit("cart:item-unavailable", { product });
      return { ok: false, reason: "unavailable" };
    }

    const existing = this.items.find((i) => i.id === product.id);
    const currentInCart = existing ? existing.qty : 0;
    const requestedTotal = currentInCart + quantity;

    // 2. Monitored inventory stock ceiling check
    if (product.isMonitored) {
      const availableStock = typeof product.stock === "number" ? product.stock : 0;

      if (availableStock <= 0) {
        Bus.emit("cart:out-of-stock", { product });
        return { ok: false, reason: "out_of_stock" };
      }

      if (requestedTotal > availableStock) {
        Bus.emit("cart:stock-limit-reached", {
          product,
          requested: requestedTotal,
          available: availableStock,
          inCart: currentInCart
        });
        return { ok: false, reason: "stock_exceeded", available: availableStock };
      }
    }

    // 3. Commit line item to ticket
    if (existing) {
      existing.qty = requestedTotal;
    } else {
      this.items.push({
        id: product.id,
        name: product.name,
        price: Number(product.price) || 0.0,
        qty: quantity,
        isMonitored: Boolean(product.isMonitored),
        maxStock: product.isMonitored ? product.stock : null
      });
    }

    this.notify();
    return { ok: true, currentQty: requestedTotal };
  },

  /**
   * Directly sets absolute item quantity with inventory ceiling validation
   * @param {string|number} productId 
   * @param {number} newQty 
   * @returns {Promise<Object>} { ok: boolean, reason?: string, available?: number }
   */
  async setQuantity(productId, newQty) {
    const item = this.items.find((i) => i.id === productId);
    if (!item) return { ok: false, reason: "item_not_found" };

    if (newQty <= 0) {
      this.voidItem(productId);
      return { ok: true };
    }

    const product = await DB.getProductById(productId);
    if (product && product.isMonitored) {
      const availableStock = typeof product.stock === "number" ? product.stock : 0;
      if (newQty > availableStock) {
        Bus.emit("cart:stock-limit-reached", {
          product,
          requested: newQty,
          available: availableStock,
          inCart: item.qty
        });
        return { ok: false, reason: "stock_exceeded", available: availableStock };
      }
    }

    item.qty = newQty;
    this.notify();
    return { ok: true };
  },

  /**
   * Decrements line item quantity by 1 or voids it if count reaches 0
   * @param {string|number} productId 
   */
  decrement(productId) {
    const index = this.items.findIndex((i) => i.id === productId);
    if (index === -1) return;

    if (this.items[index].qty > 1) {
      this.items[index].qty -= 1;
    } else {
      this.items.splice(index, 1);
    }
    this.notify();
  },

  /**
   * Removes an item from the ticket (called upon Manager Authorization)
   * @param {string|number} productId 
   * @returns {Object|null} The removed item object
   */
  voidItem(productId) {
    const index = this.items.findIndex((i) => i.id === productId);
    if (index !== -1) {
      const removed = this.items.splice(index, 1)[0];
      this.notify();
      Bus.emit("cart:item-voided", removed);
      return removed;
    }
    return null;
  },

  /**
   * Returns current quantity of a product currently in the cart
   * @param {string|number} productId 
   * @returns {number}
   */
  getQty(productId) {
    const existing = this.items.find((i) => i.id === productId);
    return existing ? existing.qty : 0;
  },

  /**
   * Clears all items from the active ticket
   */
  clear() {
    this.items = [];
    this.notify();
  },

  /**
   * Computes Philippine statutory 12% VAT-inclusive breakdown and order totals
   * @returns {Object} Calculated ticket breakdown
   */
  calculate() {
    const total = this.items.reduce((sum, item) => sum + (Number(item.price) || 0) * item.qty, 0);

    // Republic of the Philippines Standard: Menu prices are VAT-Inclusive (12%)
    const vatableSales = total / 1.12;
    const vatAmount = total - vatableSales;

    return {
      items: this.items.map((i) => ({
        id: i.id,
        name: i.name,
        price: Number(i.price) || 0,
        qty: i.qty,
        isMonitored: Boolean(i.isMonitored)
      })),
      itemCount: this.items.reduce((sum, item) => sum + item.qty, 0),
      vatableSales: Number(vatableSales.toFixed(2)),
      vatAmount: Number(vatAmount.toFixed(2)),
      total: Number(total.toFixed(2))
    };
  },

  /**
   * Broadcasts updated ticket calculations to all UI subscribers
   */
  notify() {
    Bus.emit("cart:updated", this.calculate());
  }
};

// REMARK: CART_JS_MODULARIZATION_COMPLETE