/**
 * Module Description: Checkout, Print Preview & Payment Processing UI Controller
 * Orchestrates cash payment confirmation with quick tender presets and change computation,
 * dynamic GCash QR Ph generation, customer reference number verification, dynamic customer
 * calling buzzer/pager N-grid selection, dual-screen live customer display window management
 * with real-time broadcast synchronization, thermal print preview generation (58mm/80mm),
 * order persistence in IndexedDB, and dual-printer hardware dispatching.
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
  customerDisplayWindow: null,
  previewPaperWidth: "58mm",
  initialized: false,

  /**
   * Initializes DOM selections and binds payment buttons, modal events, and listeners
   */
  init() {
    this.elements = {
      btnPayCash: document.getElementById("btn-pay-cash"),
      btnPayGCash: document.getElementById("btn-pay-gcash"),
      btnCustomerDisplay: document.getElementById("btn-customer-display"),
      btnPreviewTicket: document.getElementById("btn-preview-ticket"),

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
      gcashPagerSelectedLabel: document.getElementById("gcash-pager-selected-label"),

      // Thermal Print Preview Modal Elements
      modalPrintPreview: document.getElementById("modal-print-preview"),
      previewCustomerReceipt: document.getElementById("preview-customer-receipt"),
      previewServerSlip: document.getElementById("preview-server-slip"),
      previewWidthSelect: document.getElementById("preview-width-select"),
      btnClosePreview: document.getElementById("btn-close-preview"),
      btnClosePreviewX: document.getElementById("btn-close-preview-x"),
      btnPrintFromPreview: document.getElementById("btn-print-from-preview")
    };

    // 1. Dual Monitor Customer Display Launcher
    if (this.elements.btnCustomerDisplay) {
      this.elements.btnCustomerDisplay.onclick = () => this.openCustomerDisplay();
    }

    // 2. Thermal Print Preview Workflow
    if (this.elements.btnPreviewTicket) {
      this.elements.btnPreviewTicket.onclick = () => this.openPrintPreview();
    }

    if (this.elements.btnClosePreview) {
      this.elements.btnClosePreview.onclick = () => this.closePrintPreview();
    }

    if (this.elements.btnClosePreviewX) {
      this.elements.btnClosePreviewX.onclick = () => this.closePrintPreview();
    }

    if (this.elements.previewWidthSelect) {
      this.elements.previewWidthSelect.onchange = () => {
        this.previewPaperWidth = this.elements.previewWidthSelect.value || "58mm";
        this.renderPrintPreview(this.previewPaperWidth);
      };
    }

    if (this.elements.btnPrintFromPreview) {
      this.elements.btnPrintFromPreview.onclick = async () => {
        const bill = Cart.items.length > 0 ? Cart.calculate() : null;
        if (!bill || bill.items.length === 0) {
          alert("Cart is empty. Please add items to ticket to print physically.");
          return;
        }
        const activeCashier = Session.get() || { id: "STAFF-01", name: "Cashier" };
        const enabledPrinters = await DB.getEnabledPrinters();
        await Printer.broadcastReceipt(enabledPrinters, {
          ...bill,
          orderNumber: `PREV-${Date.now().toString().slice(-4)}`,
          cashierName: activeCashier.name,
          paymentType: "TEST PRINT",
          pagerNumber: this.selectedPagerNumber || "01"
        });
        alert("Preview receipt sent to paired printers.");
      };
    }

    // 3. Cash Payment Workflow
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

    // 4. GCash QR Code Workflow
    if (this.elements.btnPayGCash) {
      this.elements.btnPayGCash.onclick = () => this.openGCashModal();
    }

    if (this.elements.btnCloseGCash) {
      this.elements.btnCloseGCash.onclick = () => this.closeGCashModal();
    }

    if (this.elements.btnConfirmGCash) {
      this.elements.btnConfirmGCash.onclick = () => this.openGCashVerificationModal();
    }

    // 5. GCash Verification Workflow
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
   * Opens the standalone customer-facing display in a separate browser window for dual monitors
   */
  async openCustomerDisplay() {
    if (this.customerDisplayWindow && !this.customerDisplayWindow.closed) {
      this.customerDisplayWindow.focus();
      return;
    }

    const w = 1024;
    const h = 768;
    const left = window.screen.availLeft + (window.screen.availWidth || 1920);
    const top = 50;

    this.customerDisplayWindow = window.open(
      "customer-display.html",
      "CustomerDisplayWindow",
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`
    );

    // Broadcast current store branding and ticket calculations to the newly opened screen
    const store = await DB.getStoreSettings();
    setTimeout(() => {
      Cart.broadcastToCustomer({
        type: "store:updated",
        data: store
      });
      Cart.notify();
    }, 600);
  },

  // ===========================================================================
  // 1. THERMAL PRINT PREVIEW MODAL WORKFLOW
  // ===========================================================================

  async openPrintPreview() {
    if (!this.elements.modalPrintPreview) return;

    if (this.elements.previewWidthSelect) {
      this.previewPaperWidth = this.elements.previewWidthSelect.value || "58mm";
    }

    await this.renderPrintPreview(this.previewPaperWidth);

    if (typeof this.elements.modalPrintPreview.showModal === "function") {
      this.elements.modalPrintPreview.showModal();
    }
  },

  closePrintPreview() {
    if (this.elements.modalPrintPreview && this.elements.modalPrintPreview.open) {
      this.elements.modalPrintPreview.close();
    }
  },

  /**
   * Formats and displays both customer receipt and server slip inside the preview dialog
   * @param {string} paperWidth - '58mm' or '80mm'
   */
  async renderPrintPreview(paperWidth = "58mm") {
    if (!this.elements.previewCustomerReceipt || !this.elements.previewServerSlip) return;

    const is80mm = paperWidth === "80mm";
    const store = await DB.getStoreSettings();
    const activeCashier = Session.get() || { id: "STAFF-01", name: "Cashier" };

    // Use current ticket if populated; otherwise show realistic sample order
    let ticket = Cart.items.length > 0 ? Cart.calculate() : null;
    let isSample = false;

    if (!ticket || ticket.items.length === 0) {
      isSample = true;
      ticket = {
        orderNumber: "ORD-984210",
        cashierName: activeCashier.name || "Cashier",
        timestamp: new Date().toISOString(),
        items: [
          { name: "Caramel Macchiato", qty: 2, price: 130.0 },
          { name: "Pork Sisig Rice", qty: 1, price: 165.0 },
          { name: "Choco Crinkles", qty: 3, price: 75.0 }
        ],
        vatableSales: 580.36,
        vatAmount: 69.64,
        total: 650.0,
        paymentType: "CASH",
        amountTendered: 1000.0,
        changeAmount: 350.0,
        pagerNumber: this.selectedPagerNumber || "07"
      };
    } else {
      ticket = {
        ...ticket,
        orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
        cashierName: activeCashier.name,
        paymentType: "CASH",
        amountTendered: this.elements.cashTenderedInput ? parseFloat(this.elements.cashTenderedInput.value) || ticket.total : ticket.total,
        changeAmount: this.elements.cashTenderedInput ? Math.max(0, (parseFloat(this.elements.cashTenderedInput.value) || 0) - ticket.total) : 0,
        pagerNumber: this.selectedPagerNumber || (store.useNumberPager ? "01" : null)
      };
    }

    // Set paper width container class
    const containerWidthClass = is80mm ? "thermal-paper-80mm" : "thermal-paper-58mm";
    this.elements.previewCustomerReceipt.className = `thermal-paper-slip ${containerWidthClass}`;
    this.elements.previewServerSlip.className = `thermal-paper-slip ${containerWidthClass}`;

    // Generate HTML formatted slips
    this.elements.previewCustomerReceipt.innerHTML = this.formatCustomerReceiptHtml(ticket, store, is80mm, isSample);
    this.elements.previewServerSlip.innerHTML = this.formatServerSlipHtml(ticket, is80mm, isSample);
  },

  /**
   * Builds customer receipt HTML simulating monospace columns and double-height fonts
   */
  formatCustomerReceiptHtml(ticket, store, is80mm, isSample) {
    const totalCols = is80mm ? 48 : 32;
    const divider = "-".repeat(totalCols);
    const dblDivider = "=".repeat(totalCols);

    const padRow = (name, qty, total) => {
      const nMax = is80mm ? 24 : 16;
      const qMax = is80mm ? 7 : 4;
      const tMax = is80mm ? 15 : 10;
      const c1 = (name || "Item").padEnd(nMax, " ").slice(0, nMax);
      const c2 = String(qty).padStart(qMax, " ").slice(0, qMax);
      const c3 = String(total).padStart(tMax, " ").slice(0, tMax);
      return `${c1} ${c2} ${c3}`;
    };

    let itemsHtml = "";
    if (Array.isArray(ticket.items)) {
      itemsHtml = ticket.items.map((i) => {
        const lineTotal = `₱${((Number(i.price) || 0) * (i.qty || 1)).toFixed(2)}`;
        return padRow(i.name, `${i.qty}x`, lineTotal);
      }).join("\n");
    }

    const buzzerCallout = ticket.pagerNumber ? `
<div class="receipt-divider">${divider}</div>
<div class="receipt-center receipt-pager-box">
  <span class="receipt-dbl-height">BUZZER #${ticket.pagerNumber}</span>
</div>` : "";

    const logoHtml = store.logoBase64
      ? `<div class="receipt-center"><img src="${store.logoBase64}" class="receipt-logo-img" alt="Logo" /></div>`
      : "";

    return `
${isSample ? '<div class="receipt-sample-tag">[ SAMPLE PREVIEW ]</div>' : ''}
${logoHtml}
<div class="receipt-center receipt-dbl-height"><b>${(store.storeName || "LOKALEX STORE").toUpperCase()}</b></div>
${store.companyName ? `<div class="receipt-center">${store.companyName}</div>` : ''}
${store.address ? `<div class="receipt-center">${store.address}</div>` : ''}
${store.contactNumber ? `<div class="receipt-center">Tel: ${store.contactNumber}</div>` : ''}
<div class="receipt-divider">${dblDivider}</div>
<div class="receipt-center"><b>[ CUSTOMER OFFICIAL RECEIPT ]</b></div>
<div>Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
<div>Order: ${ticket.orderNumber || "ORD-000000"}</div>
<div>Cashier: ${ticket.cashierName || "Cashier"}</div>
${buzzerCallout}
<div class="receipt-divider">${divider}</div>
<div>${padRow("ITEM", "QTY", "TOTAL")}</div>
<div class="receipt-divider">${divider}</div>
<pre class="receipt-items-pre">${itemsHtml}</pre>
<div class="receipt-divider">${divider}</div>
<div class="receipt-right">Vatable Sales: ₱${Number(ticket.vatableSales || 0).toFixed(2)}</div>
<div class="receipt-right">VAT Amount (12%): ₱${Number(ticket.vatAmount || 0).toFixed(2)}</div>
<div class="receipt-right receipt-total-line"><b>TOTAL AMOUNT: ₱${Number(ticket.total || 0).toFixed(2)}</b></div>
<div class="receipt-right">Payment Mode: ${ticket.paymentType || "CASH"}</div>
${ticket.amountTendered ? `<div class="receipt-right">Amount Tendered: ₱${Number(ticket.amountTendered).toFixed(2)}</div>` : ''}
${ticket.changeAmount !== null && ticket.changeAmount !== undefined ? `<div class="receipt-right">Change: ₱${Number(ticket.changeAmount).toFixed(2)}</div>` : ''}
<div class="receipt-divider">${dblDivider}</div>
${store.tagline ? `<div class="receipt-center">"${store.tagline}"</div>` : ''}
<div class="receipt-center">Thank you for your purchase!</div>
<div class="receipt-center">Please visit us again.</div>
<div class="receipt-cut-line">┈┈┈┈┈┈┈┈┈┈┈ [ CUT PAPER ] ┈┈┈┈┈┈┈┈┈┈┈</div>
`;
  },

  /**
   * Builds server order slip HTML
   */
  formatServerSlipHtml(ticket, is80mm, isSample) {
    const totalCols = is80mm ? 48 : 32;
    const divider = "-".repeat(totalCols);
    const dblDivider = "=".repeat(totalCols);

    let totalUnits = 0;
    const padServerRow = (qtyStr, nameStr) => {
      const qMax = is80mm ? 10 : 6;
      const nMax = is80mm ? 38 : 26;
      const c1 = qtyStr.padEnd(qMax, " ").slice(0, qMax);
      const c2 = nameStr.padEnd(nMax, " ").slice(0, nMax);
      return `${c1}${c2}`;
    };

    let itemsHtml = "";
    if (Array.isArray(ticket.items)) {
      itemsHtml = ticket.items.map((i) => {
        const qty = i.qty || 1;
        totalUnits += qty;
        return padServerRow(`[ ${qty}x ]`, i.name || "Item");
      }).join("\n");
    }

    const buzzerCallout = ticket.pagerNumber ? `
<div class="receipt-divider">${divider}</div>
<div class="receipt-center receipt-pager-box">
  <span class="receipt-dbl-height">BUZZER #${ticket.pagerNumber}</span>
</div>` : "";

    return `
${isSample ? '<div class="receipt-sample-tag">[ SAMPLE PREVIEW ]</div>' : ''}
<div class="receipt-center receipt-dbl-height"><b>*** SERVER SLIP ***</b></div>
<div class="receipt-center"><b>ORDER: ${ticket.orderNumber || "ORD-000000"}</b></div>
${buzzerCallout}
<div>Time: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
<div>Server/Cashier: ${ticket.cashierName || "Cashier"}</div>
<div class="receipt-divider">${dblDivider}</div>
<div>${padServerRow("QTY", "ORDER DETAILS")}</div>
<div class="receipt-divider">${divider}</div>
<pre class="receipt-items-pre receipt-bold-items">${itemsHtml}</pre>
<div class="receipt-divider">${divider}</div>
<div class="receipt-center receipt-bold-items">TOTAL UNITS ORDERED: ${totalUnits}</div>
<div class="receipt-divider">${dblDivider}</div>
<div class="receipt-center">[ SERVER / PREPARATION COPY ]</div>
<div class="receipt-cut-line">┈┈┈┈┈┈┈┈┈┈┈ [ CUT PAPER ] ┈┈┈┈┈┈┈┈┈┈┈</div>
`;
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

        // Mirror buzzer selection instantly to dual monitor
        Cart.broadcastToCustomer({
          type: "checkout:updated",
          data: {
            pagerNumber: this.selectedPagerNumber
          }
        });
      };
    });
  },

  // ===========================================================================
  // 2. CASH CONFIRMATION & CHANGE CALCULATION
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

    // Mirror opening of cash checkout to customer display
    Cart.broadcastToCustomer({
      type: "checkout:updated",
      data: {
        pagerNumber: null,
        tendered: null,
        change: null
      }
    });

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

    Cart.broadcastToCustomer({
      type: "checkout:cleared",
      data: {}
    });
    Cart.notify();
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

    // Mirror live tendered cash and computed change to dual monitor
    Cart.broadcastToCustomer({
      type: "checkout:updated",
      data: {
        pagerNumber: this.selectedPagerNumber,
        tendered: tendered > 0 ? tendered : null,
        change: change >= 0 ? change : 0
      }
    });
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

      // 5. Mirror finalized change and buzzer details to customer display
      Cart.broadcastToCustomer({
        type: "checkout:updated",
        data: {
          pagerNumber,
          tendered,
          change: Math.max(0, change)
        }
      });

      // 6. Reset ticket state and close modal
      Cart.clear();
      this.closeCashConfirmationModal();
      console.info(`[Checkout] Cash Order ${savedOrder.orderNumber} committed locally.`);

      // Retain change and buzzer on customer display for 6 seconds before returning to welcome screen
      setTimeout(() => {
        Cart.broadcastToCustomer({
          type: "checkout:cleared",
          data: {}
        });
      }, 6000);

      // 7. Opportunistic per-sale background push
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
  // 3. GCASH QR DISPLAY & REFERENCE/TIMESTAMP CONFIRMATION
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

    Cart.broadcastToCustomer({
      type: "checkout:cleared",
      data: {}
    });
    Cart.notify();
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

      // 4. Mirror payment confirmation and pager number to customer display
      Cart.broadcastToCustomer({
        type: "checkout:updated",
        data: {
          pagerNumber,
          tendered: amountPaid,
          change: 0.0
        }
      });

      // 5. Reset ticket state and close modal
      Cart.clear();
      this.closeGCashVerificationModal();
      this.currentBill = null;
      console.info(`[Checkout] GCash Order ${savedOrder.orderNumber} committed locally.`);

      setTimeout(() => {
        Cart.broadcastToCustomer({
          type: "checkout:cleared",
          data: {}
        });
      }, 6000);

      // 6. Opportunistic per-sale background push
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

// REMARK: CHECKOUT_UI_JS_PREVIEW_AND_DUAL_MONITOR_COMPLETE