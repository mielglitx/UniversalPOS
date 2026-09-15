/**
 * Module Description: Checkout & Payment Processing UI Controller
 * Orchestrates cash payment confirmation with quick tender presets and change computation,
 * dynamic GCash QR Ph generation, customer reference number verification, dynamic customer
 * calling buzzer/pager N-grid selection, order persistence in IndexedDB, dual-printer
 * physical receipt dispatching, cash drawer firing, and background cloud synchronization.
 */

import { DB } from "./db.js";
import { Cart } from "./cart.js";
import { Session } from "./session.js";
import { GCashEMVCo } from "./gcash-emvco.js";
import { Printer } from "./printer.js";
import { Sync } from "./sync.js";
import { Bus } from "./bus.js";

export const CheckoutUI = {
  elements: {},
  currentBill: null,
  selectedPagerNumber: null,
  initialized: false,

  /**
   * Initializes DOM selections and binds payment buttons, modal events, and listeners
   */
  init() {
    this.elements = {
      btnPayCash: document.getElementById("btn-pay-cash"),
      btnPayGCash: document.getElementById("btn-pay-gcash"),

      // Dynamic GCash QR Modal Elements
      modalGCash: document.getElementById("modal-gcash"),
      qrContainer: document.getElementById("gcash-qrcode"),
      gcashAmountLabel: document.getElementById("gcash-amount-label"),
      btnCloseGCash: document.getElementById("btn-close-gcash"),
      btnConfirmGCash: document.getElementById("btn-confirm-gcash"),

      // Cash Confirmation Modal Elements
      modalCashConfirm: document.getElementById("modal-cash-confirm"),
      cashDueAmount: document.getElementById("cash-due-amount"),
      cashTenderedInput: document.getElementById("cash-tendered-input"),
      cashChangeAmount: document.getElementById("cash-change-amount"),
      cashErrorMsg: document.getElementById("cash-error-msg"),
      btnCancelCash: document.getElementById("btn-cancel-cash"),
      btnCancelCashX: document.getElementById("btn-cancel-cash-x"),
      btnFinalizeCash: document.getElementById("btn-finalize-cash"),
      quickCashButtons: document.querySelectorAll(".btn-quick-cash"),
      cashPagerContainer: document.getElementById("cash-pager-container"),
      cashPagerGrid: document.getElementById("cash-pager-grid"),
      cashPagerSelectedLabel: document.getElementById("cash-pager-selected-label"),

      // GCash Verification Modal Elements
      modalGCashConfirm: document.getElementById("modal-gcash-confirm"),
      gcashRefInput: document.getElementById("gcash-ref-input"),
      gcashAmountPaidInput: document.getElementById("gcash-amount-paid-input"),
      gcashPaymentDateInput: document.getElementById("gcash-payment-date-input"),
      gcashConfirmError: document.getElementById("gcash-confirm-error"),
      btnCancelGCashConfirmX: document.getElementById("btn-cancel-gcash-confirm-x"),
      btnBackGCashConfirm: document.getElementById("btn-back-gcash-confirm"),
      btnFinalizeGCash: document.getElementById("btn-finalize-gcash"),
      gcashPagerContainer: document.getElementById("gcash-pager-container"),
      gcashPagerGrid: document.getElementById("gcash-pager-grid"),
      gcashPagerSelectedLabel: document.getElementById("gcash-pager-selected-label")
    };

    // 1. Cash Payment Workflow
    if (this.elements.btnPayCash) {
      this.elements.btnPayCash.onclick = () => this.openCashConfirmationModal();
    }

    if (this.elements.btnCancelCash) {
      this.elements.btnCancelCash.onclick = () => this.closeCashConfirmationModal();
    }

    if (this.elements.btnCancelCashX) {
      this.elements.btnCancelCashX.onclick = () => this.closeCashConfirmationModal();
    }

    if (this.elements.cashTenderedInput) {
      this.elements.cashTenderedInput.oninput = () => this.calculateCashChange();
      this.elements.cashTenderedInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.handleCashFinalize();
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.closeCashConfirmationModal();
        }
      };
    }

    if (this.elements.quickCashButtons) {
      this.elements.quickCashButtons.forEach((btn) => {
        btn.onclick = () => this.handleQuickCashClick(btn.dataset.val);
      });
    }

    if (this.elements.btnFinalizeCash) {
      this.elements.btnFinalizeCash.onclick = () => this.handleCashFinalize();
    }

    // 2. GCash QR Code Workflow
    if (this.elements.btnPayGCash) {
      this.elements.btnPayGCash.onclick = () => this.openGCashModal();
    }

    if (this.elements.btnCloseGCash) {
      this.elements.btnCloseGCash.onclick = () => this.closeGCashModal();
    }

    if (this.elements.btnConfirmGCash) {
      this.elements.btnConfirmGCash.onclick = () => this.openGCashVerificationModal();
    }

    // 3. GCash Verification Workflow
    if (this.elements.btnCancelGCashConfirmX) {
      this.elements.btnCancelGCashConfirmX.onclick = () => this.closeGCashVerificationModal();
    }

    if (this.elements.btnBackGCashConfirm) {
      this.elements.btnBackGCashConfirm.onclick = () => {
        this.closeGCashVerificationModal();
        if (this.elements.modalGCash && typeof this.elements.modalGCash.showModal === "function") {
          this.elements.modalGCash.showModal();
        }
      };
    }

    if (this.elements.btnFinalizeGCash) {
      this.elements.btnFinalizeGCash.onclick = () => this.handleGCashFinalize();
    }

    if (this.elements.gcashRefInput) {
      this.elements.gcashRefInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.handleGCashFinalize();
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.closeGCashVerificationModal();
        }
      };
    }

    if (this.initialized) return;
    this.initialized = true;

    // Keyboard shortcuts: F8 for Cash, F9 for GCash
    window.addEventListener("keydown", (e) => {
      const loginScreen = document.getElementById("login-screen");
      const isLocked = loginScreen && !loginScreen.classList.contains("hidden");
      if (isLocked) return;

      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
      if (activeTag === "input" || activeTag === "select" || activeTag === "textarea") return;

      if (e.key === "F8") {
        e.preventDefault();
        this.openCashConfirmationModal();
      } else if (e.key === "F9") {
        e.preventDefault();
        this.openGCashModal();
      }
    });
  },

  /**
   * Dynamically renders N buzzer buttons based on administrative store capacity
   * @param {HTMLElement} containerEl
   * @param {HTMLElement} gridEl
   * @param {HTMLElement} labelEl
   */
  async renderPagerGrid(containerEl, gridEl, labelEl) {
    if (!containerEl || !gridEl) return;
    const store = await DB.getStoreSettings();

    if (!store.useNumberPager) {
      containerEl.classList.add("hidden");
      gridEl.innerHTML = "";
      this.selectedPagerNumber = null;
      if (labelEl) labelEl.textContent = "None";
      return;
    }

    containerEl.classList.remove("hidden");
    const totalBuzzers = Math.max(1, parseInt(store.pagerCount, 10) || 24);
    let buttonsHtml = "";

    for (let i = 1; i <= totalBuzzers; i++) {
      const numStr = String(i).padStart(2, "0");
      buttonsHtml += `<button type="button" class="btn-pager-num" data-val="${numStr}">${numStr}</button>`;
    }
    gridEl.innerHTML = buttonsHtml;

    gridEl.querySelectorAll(".btn-pager-num").forEach((btn) => {
      btn.onclick = () => {
        const val = btn.dataset.val;
        if (this.selectedPagerNumber === val) {
          this.selectedPagerNumber = null;
          btn.classList.remove("active");
          if (labelEl) labelEl.textContent = "None";
        } else {
          this.selectedPagerNumber = val;
          gridEl.querySelectorAll(".btn-pager-num").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          if (labelEl) labelEl.textContent = `#${val}`;
        }
      };
    });
  },

  // ===========================================================================
  // 1. CASH CONFIRMATION & CHANGE CALCULATION
  // ===========================================================================

  async openCashConfirmationModal() {
    const bill = Cart.calculate();
    if (bill.total <= 0) {
      alert("Cart is empty. Add products first.");
      return;
    }

    this.currentBill = bill;
    this.selectedPagerNumber = null;

    if (this.elements.cashDueAmount) {
      this.elements.cashDueAmount.textContent = `₱${bill.total.toFixed(2)}`;
    }

    if (this.elements.cashTenderedInput) {
      this.elements.cashTenderedInput.value = "";
    }

    if (this.elements.cashChangeAmount) {
      this.elements.cashChangeAmount.textContent = "₱0.00";
    }

    if (this.elements.cashErrorMsg) {
      this.elements.cashErrorMsg.textContent = "";
    }

    if (this.elements.cashPagerSelectedLabel) {
      this.elements.cashPagerSelectedLabel.textContent = "None";
    }

    // Render buzzer buttons if pager option is active
    await this.renderPagerGrid(
      this.elements.cashPagerContainer,
      this.elements.cashPagerGrid,
      this.elements.cashPagerSelectedLabel
    );

    if (this.elements.modalCashConfirm && typeof this.elements.modalCashConfirm.showModal === "function") {
      this.elements.modalCashConfirm.showModal();
      setTimeout(() => {
        if (this.elements.cashTenderedInput) {
          this.elements.cashTenderedInput.focus();
        }
      }, 100);
    }
  },

  closeCashConfirmationModal() {
    if (this.elements.modalCashConfirm && this.elements.modalCashConfirm.open) {
      this.elements.modalCashConfirm.close();
    }
    this.currentBill = null;
    this.selectedPagerNumber = null;
  },

  handleQuickCashClick(value) {
    if (!this.currentBill) return;

    if (value === "exact") {
      this.elements.cashTenderedInput.value = this.currentBill.total.toFixed(2);
    } else {
      const denom = parseFloat(value);
      if (!isNaN(denom)) {
        this.elements.cashTenderedInput.value = denom.toFixed(2);
      }
    }

    this.calculateCashChange();
  },

  calculateCashChange() {
    if (!this.currentBill) return;

    const due = this.currentBill.total;
    const tendered = parseFloat(this.elements.cashTenderedInput.value) || 0;
    const change = tendered - due;

    if (this.elements.cashErrorMsg) {
      this.elements.cashErrorMsg.textContent = "";
    }

    if (change >= 0) {
      this.elements.cashChangeAmount.textContent = `₱${change.toFixed(2)}`;
      this.elements.cashChangeAmount.style.color = "#15803d";
    } else {
      this.elements.cashChangeAmount.textContent = "₱0.00";
      this.elements.cashChangeAmount.style.color = "#b91c1c";
    }
  },

  async handleCashFinalize() {
    if (!this.currentBill) {
      this.currentBill = Cart.calculate();
    }

    const bill = this.currentBill;
    const tendered = parseFloat(this.elements.cashTenderedInput.value);

    if (isNaN(tendered) || tendered < bill.total) {
      if (this.elements.cashErrorMsg) {
        this.elements.cashErrorMsg.textContent = "Tendered cash is insufficient to cover the total amount due.";
      }
      if (this.elements.cashTenderedInput) {
        this.elements.cashTenderedInput.focus();
      }
      return;
    }

    const change = tendered - bill.total;
    const activeCashier = Session.get() || { id: "STAFF-01", name: "Cashier" };
    const pagerNumber = this.selectedPagerNumber || null;

    try {
      // 1. Atomically save order, pager number, and deduct monitored items in IndexedDB
      const savedOrder = await DB.saveOrder({
        cashierId: activeCashier.id,
        cashierName: activeCashier.name,
        items: bill.items,
        vatableSales: bill.vatableSales,
        vatAmount: bill.vatAmount,
        total: bill.total,
        paymentType: "CASH",
        amountTendered: tendered,
        changeAmount: change,
        pagerNumber
      });

      // 2. Broadcast inventory update event to immediately refresh catalog warning overlays
      Bus.emit("inventory:updated");

      // 3. Broadcast physical receipts across enabled printers
      const enabledPrinters = await DB.getEnabledPrinters();
      await Printer.broadcastReceipt(enabledPrinters, {
        ...bill,
        orderNumber: savedOrder.orderNumber,
        cashierName: activeCashier.name,
        paymentType: "CASH",
        amountTendered: tendered,
        changeAmount: change,
        pagerNumber
      });

      // 4. Actuate counter cash drawer
      await Printer.kickDrawer(enabledPrinters);

      // 5. Reset ticket state and close modal
      Cart.clear();
      this.closeCashConfirmationModal();
      console.info(`[Checkout] Cash Order ${savedOrder.orderNumber} committed locally.`);

      // 6. Opportunistic per-sale background push (fire-and-forget)
      Sync.pushPendingOrders({ silent: true }).catch((syncErr) => {
        console.warn("[Checkout Sync] Background push queued for scheduler:", syncErr.message);
      });
    } catch (err) {
      console.error("[Checkout Error] Failed to finalize cash transaction:", err);
      if (this.elements.cashErrorMsg) {
        this.elements.cashErrorMsg.textContent = `Transaction failed: ${err.message}`;
      }
    }
  },

  // ===========================================================================
  // 2. GCASH QR DISPLAY & REFERENCE/TIMESTAMP CONFIRMATION
  // ===========================================================================

  openGCashModal() {
    const bill = Cart.calculate();
    if (bill.total <= 0) {
      alert("Cart is empty. Add products first.");
      return;
    }

    this.currentBill = bill;

    if (this.elements.gcashAmountLabel) {
      this.elements.gcashAmountLabel.textContent = `₱${bill.total.toFixed(2)}`;
    }

    if (this.elements.qrContainer) {
      this.elements.qrContainer.innerHTML = "";

      try {
        const dynamicPayload = GCashEMVCo.generateDynamicPayload(bill.total);
        if (window.QRCode) {
          new window.QRCode(this.elements.qrContainer, {
            text: dynamicPayload,
            width: 180,
            height: 180,
            correctLevel: window.QRCode.CorrectLevel.M
          });
        } else {
          this.elements.qrContainer.textContent = dynamicPayload;
        }
      } catch (qrErr) {
        console.warn("[Checkout] QR generation fallback:", qrErr);
        this.elements.qrContainer.textContent = "Error rendering QR code.";
      }
    }

    if (this.elements.modalGCash && typeof this.elements.modalGCash.showModal === "function") {
      this.elements.modalGCash.showModal();
    }
  },

  closeGCashModal() {
    if (this.elements.modalGCash && this.elements.modalGCash.open) {
      this.elements.modalGCash.close();
    }
  },

  async openGCashVerificationModal() {
    if (!this.currentBill) {
      this.currentBill = Cart.calculate();
    }

    this.closeGCashModal();
    this.selectedPagerNumber = null;

    if (this.elements.gcashAmountPaidInput) {
      this.elements.gcashAmountPaidInput.value = this.currentBill.total.toFixed(2);
    }

    if (this.elements.gcashRefInput) {
      this.elements.gcashRefInput.value = "";
    }

    if (this.elements.gcashPaymentDateInput) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const localIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
      this.elements.gcashPaymentDateInput.value = localIso;
    }

    if (this.elements.gcashConfirmError) {
      this.elements.gcashConfirmError.textContent = "";
    }

    if (this.elements.gcashPagerSelectedLabel) {
      this.elements.gcashPagerSelectedLabel.textContent = "None";
    }

    // Render buzzer buttons if pager option is active
    await this.renderPagerGrid(
      this.elements.gcashPagerContainer,
      this.elements.gcashPagerGrid,
      this.elements.gcashPagerSelectedLabel
    );

    if (this.elements.modalGCashConfirm && typeof this.elements.modalGCashConfirm.showModal === "function") {
      this.elements.modalGCashConfirm.showModal();
      setTimeout(() => {
        if (this.elements.gcashRefInput) {
          this.elements.gcashRefInput.focus();
        }
      }, 100);
    }
  },

  closeGCashVerificationModal() {
    if (this.elements.modalGCashConfirm && this.elements.modalGCashConfirm.open) {
      this.elements.modalGCashConfirm.close();
    }
    this.selectedPagerNumber = null;
  },

  async handleGCashFinalize() {
    if (!this.currentBill) {
      this.currentBill = Cart.calculate();
    }

    const bill = this.currentBill;
    const refNo = this.elements.gcashRefInput ? this.elements.gcashRefInput.value.trim() : "";
    const amountPaid = parseFloat(this.elements.gcashAmountPaidInput.value);
    const paymentDate = this.elements.gcashPaymentDateInput ? this.elements.gcashPaymentDateInput.value : "";
    const pagerNumber = this.selectedPagerNumber || null;

    if (!refNo) {
      if (this.elements.gcashConfirmError) {
        this.elements.gcashConfirmError.textContent = "Please enter the customer GCash reference number.";
      }
      if (this.elements.gcashRefInput) this.elements.gcashRefInput.focus();
      return;
    }

    if (isNaN(amountPaid) || amountPaid <= 0) {
      if (this.elements.gcashConfirmError) {
        this.elements.gcashConfirmError.textContent = "Please provide a valid GCash amount paid.";
      }
      if (this.elements.gcashAmountPaidInput) this.elements.gcashAmountPaidInput.focus();
      return;
    }

    if (amountPaid < bill.total) {
      if (this.elements.gcashConfirmError) {
        this.elements.gcashConfirmError.textContent = `Amount paid (₱${amountPaid.toFixed(2)}) is less than total due (₱${bill.total.toFixed(2)}).`;
      }
      return;
    }

    if (!paymentDate) {
      if (this.elements.gcashConfirmError) {
        this.elements.gcashConfirmError.textContent = "Please specify the date and time when the GCash payment occurred.";
      }
      return;
    }

    const activeCashier = Session.get() || { id: "STAFF-01", name: "Cashier" };

    try {
      // 1. Atomically save order, pager number, and deduct monitored items in IndexedDB
      const savedOrder = await DB.saveOrder({
        cashierId: activeCashier.id,
        cashierName: activeCashier.name,
        items: bill.items,
        vatableSales: bill.vatableSales,
        vatAmount: bill.vatAmount,
        total: bill.total,
        paymentType: "GCASH_DYNAMIC_QR",
        gcashRefNo: refNo,
        gcashAmountPaid: amountPaid,
        gcashPaymentDate: paymentDate,
        pagerNumber
      });

      // 2. Broadcast inventory update event to immediately refresh catalog warning overlays
      Bus.emit("inventory:updated");

      // 3. Broadcast physical receipts across enabled printers
      const enabledPrinters = await DB.getEnabledPrinters();
      await Printer.broadcastReceipt(enabledPrinters, {
        ...bill,
        orderNumber: savedOrder.orderNumber,
        cashierName: activeCashier.name,
        paymentType: "GCASH QR Ph",
        gcashRefNo: refNo,
        gcashAmountPaid: amountPaid,
        gcashPaymentDate: paymentDate,
        pagerNumber
      });

      // 4. Reset ticket state and close modal
      Cart.clear();
      this.closeGCashVerificationModal();
      this.currentBill = null;
      console.info(`[Checkout] GCash Order ${savedOrder.orderNumber} committed locally.`);

      // 5. Opportunistic per-sale background push (fire-and-forget)
      Sync.pushPendingOrders({ silent: true }).catch((syncErr) => {
        console.warn("[Checkout Sync] Background push queued for scheduler:", syncErr.message);
      });
    } catch (err) {
      console.error("[Checkout Error] Failed to finalize GCash transaction:", err);
      if (this.elements.gcashConfirmError) {
        this.elements.gcashConfirmError.textContent = `Confirmation failed: ${err.message}`;
      }
    }
  }
};

// REMARK: CHECKOUT_UI_JS_PAGER_GRID_COMPLETE