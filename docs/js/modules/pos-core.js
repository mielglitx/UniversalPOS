/**
 * Module Description: POS Core Workflow & Quantity Modal Controller
 * Coordinates the touch quantity editor modal supporting numeric input up to 
 * 18 digits, handles reactive cart ticket table DOM rendering, Philippine statutory 
 * 12% VAT-inclusive totals calculation, and initializes line-item manager void authorization.
 */

import { Bus } from "./bus.js";
import { Cart } from "./cart.js";
import { AuthVoid } from "./auth-void.js";
import { Theme } from "./theme.js";

/**
 * Direct Cart Item Quantity Editor Modal Controller
 * Supports touchscreen numpad inputs and physical keyboard entry up to 18 digits.
 */
export const CartQtyModal = {
  modal: null,
  input: null,
  nameLabel: null,
  idInput: null,
  errorEl: null,
  currentProductId: null,
  initialized: false,

  init() {
    this.modal = document.getElementById("modal-cart-qty");
    this.input = document.getElementById("cart-qty-input");
    this.nameLabel = document.getElementById("cart-qty-item-name");
    this.idInput = document.getElementById("cart-qty-item-id");
    this.errorEl = document.getElementById("cart-qty-error-msg");

    if (!this.modal || this.initialized) return;
    this.initialized = true;

    // Delegated click handler for touch numpad and action buttons
    this.modal.onclick = async (e) => {
      const target = e.target.closest("button");
      if (!target) return;

      // Numeric buttons (0-9)
      if (target.classList.contains("btn-num") && target.dataset.val !== undefined) {
        e.preventDefault();
        e.stopPropagation();
        const val = target.dataset.val;
        let current = this.input ? this.input.value.trim() : "";

        if (current === "0" || current === "") {
          if (this.input) this.input.value = val;
        } else if (current.length < 18) {
          if (this.input) this.input.value = current + val;
        }

        if (this.errorEl) this.errorEl.textContent = "";
        return;
      }

      // Clear Button (CLR)
      if (target.id === "btn-cart-qty-clear" || target.classList.contains("btn-clear")) {
        e.preventDefault();
        e.stopPropagation();
        if (this.input) this.input.value = "0";
        if (this.errorEl) this.errorEl.textContent = "";
        return;
      }

      // Confirm / Submit Button (OK)
      if (target.id === "btn-cart-qty-submit" || target.classList.contains("btn-submit")) {
        e.preventDefault();
        e.stopPropagation();
        await this.commit();
        return;
      }

      // Cancel / Close Buttons
      if (target.id === "btn-cancel-cart-qty" || target.id === "btn-close-cart-qty-x") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };

    // Hardware keyboard listener
    this.modal.onkeydown = async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await this.commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        let current = this.input ? this.input.value.trim() : "";
        if (current === "0" || current === "") {
          if (this.input) this.input.value = e.key;
        } else if (current.length < 18) {
          if (this.input) this.input.value = current + e.key;
        }
        if (this.errorEl) this.errorEl.textContent = "";
      } else if (e.key === "Backspace") {
        e.preventDefault();
        let current = this.input ? this.input.value.trim() : "";
        if (current.length > 1) {
          if (this.input) this.input.value = current.slice(0, -1);
        } else {
          if (this.input) this.input.value = "0";
        }
      }
    };
  },

  open(productId, itemName, currentQty) {
    this.currentProductId = productId;
    if (this.nameLabel) this.nameLabel.textContent = itemName;
    if (this.idInput) this.idInput.value = productId;
    if (this.input) this.input.value = String(currentQty);
    if (this.errorEl) this.errorEl.textContent = "";
    if (this.modal && typeof this.modal.showModal === "function") {
      this.modal.showModal();
    }
  },

  async commit() {
    const rawVal = this.input ? this.input.value.trim() : "0";
    const qty = parseInt(rawVal, 10);
    if (isNaN(qty) || qty < 0) {
      if (this.errorEl) this.errorEl.textContent = "Please enter a valid quantity.";
      return;
    }

    const res = await Cart.setQuantity(this.currentProductId, qty);
    if (res && !res.ok && res.reason === "stock_exceeded") {
      if (this.errorEl) {
        this.errorEl.textContent = `Only ${res.available} unit(s) available in stock.`;
      }
      return;
    }

    this.close();
  },

  close() {
    if (this.modal && this.modal.open) {
      this.modal.close();
    }
    this.currentProductId = null;
  }
};

/**
 * Core POS Subsystem Coordinator
 */
export const POS = {
  booted: false,

  async boot(ui) {
    if (this.booted) return;
    this.booted = true;

    // 1. Initialize Dual-Theme Engine
    Theme.init();

    // 2. Initialize Direct Cart Item Quantity Editor Modal
    CartQtyModal.init();

    // 3. Initialize Manager Void Authorization with 4-element signature
    AuthVoid.init(
      ui.modalVoid,
      ui.inputVoid,
      ui.lblVoid,
      ui.errVoid
    );

    // 4. Reactive Ticket & Cart Rendering
    Bus.on("cart:updated", (calc) => {
      if (!ui.tbody) return;

      ui.tbody.innerHTML = calc.items
        .map(
          (item) => `
        <tr>
          <td>${item.name}</td>
          <td class="text-center">
            <button 
              type="button" 
              class="btn-cart-qty" 
              data-id="${item.id}" 
              data-name="${item.name}" 
              data-qty="${item.qty}"
              title="Click to edit quantity"
            >
              ${item.qty}
            </button>
          </td>
          <td class="text-right">₱${item.price.toFixed(2)}</td>
          <td class="text-right">₱${(item.price * item.qty).toFixed(2)}</td>
          <td class="text-center">
            <button type="button" class="btn-row-void" data-id="${item.id}">Void</button>
          </td>
        </tr>
      `
        )
        .join("");

      // Bind dynamic quantity editor modal triggers
      ui.tbody.querySelectorAll(".btn-cart-qty").forEach((btn) => {
        btn.onclick = () => {
          CartQtyModal.open(btn.dataset.id, btn.dataset.name, btn.dataset.qty);
        };
      });

      // Bind dynamic Void triggers
      ui.tbody.querySelectorAll(".btn-row-void").forEach((btn) => {
        btn.onclick = () => {
          const item = calc.items.find((i) => String(i.id) === String(btn.dataset.id));
          if (item) {
            Bus.emit("cart:request-void", item);
          }
        };
      });

      // Update Financial Totals (Philippine statutory 12% VAT standard)
      if (ui.txtNet) ui.txtNet.textContent = `₱${calc.vatableSales.toFixed(2)}`;
      if (ui.txtVat) ui.txtVat.textContent = `₱${calc.vatAmount.toFixed(2)}`;
      if (ui.txtTotal) ui.txtTotal.textContent = `₱${calc.total.toFixed(2)}`;
    });
  }
};

// REMARK: POS_CORE_JS_MODULARIZATION_COMPLETE