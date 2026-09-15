/**
 * Module Description: Admin Sales & Transaction Ledger Sub-Module
 * Handles sales metric aggregations (Gross Sales, Completed Orders, VAT Collected,
 * Cash vs. GCash splits), Daily Z-Reading thermal print dispatching with adaptive
 * 58mm/80mm column calibration, UTF-8 BOM CSV financial ledger generation,
 * and in-app soft-void workflows with monitored inventory restitution.
 */

import { DB } from "../db.js";
import { Session } from "../session.js";
import { Reports } from "../reports.js";
import { Printer } from "../printer.js";
import { Sync } from "../sync.js";
import { Bus } from "../bus.js";

export const AdminSales = {
  elements: {},
  callbacks: {},
  initialized: false,

  /**
   * Initializes DOM selections and binds reporting and void modal event triggers
   * @param {Object} callbacks - External hooks
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    this.elements = {
      statGrossSales: document.getElementById("stat-gross-sales"),
      statTotalOrders: document.getElementById("stat-total-orders"),
      statTotalVat: document.getElementById("stat-total-vat"),
      statPaymentSplit: document.getElementById("stat-payment-split"),
      salesTbody: document.getElementById("sales-tbody"),
      btnPrintSalesReport: document.getElementById("btn-print-sales-report"),
      btnGenerateSalesReport: document.getElementById("btn-generate-sales-report"),

      // In-App Void Order Modal Elements
      modalVoidOrder: document.getElementById("modal-void-order"),
      voidOrderNumberLabel: document.getElementById("void-order-number-label"),
      voidOrderIdInput: document.getElementById("void-order-id-input"),
      voidOrderNumInput: document.getElementById("void-order-num-input"),
      voidOrderReasonInput: document.getElementById("void-order-reason-input"),
      voidOrderErrorMsg: document.getElementById("void-order-error-msg"),
      btnCancelVoidOrder: document.getElementById("btn-cancel-void-order"),
      btnCloseVoidOrderX: document.getElementById("btn-close-void-order-x"),
      btnConfirmVoidOrder: document.getElementById("btn-confirm-void-order")
    };

    if (this.initialized) return;
    this.initialized = true;

    // 1. Thermal Daily Sales Report Print Trigger
    if (this.elements.btnPrintSalesReport) {
      this.elements.btnPrintSalesReport.onclick = async () => {
        const summary = await DB.getSalesSummary();
        const enabled = await DB.getEnabledPrinters();
        const paperWidth = enabled.length > 0 && enabled[0].paperWidth ? enabled[0].paperWidth : "58mm";
        const reportBytes = Reports.buildDailyReportBytes(summary, Session.get(), paperWidth);

        if (enabled.length > 0) {
          await Promise.allSettled(enabled.map((p) => Printer.dispatchToTarget(p, reportBytes)));
        } else {
          await Printer.dispatch(reportBytes);
        }
        alert("Daily sales summary report dispatched to active printer(s).");
      };
    }

    // 2. CSV Financial Report File Generation Trigger
    if (this.elements.btnGenerateSalesReport) {
      this.elements.btnGenerateSalesReport.onclick = async () => {
        const summary = await DB.getSalesSummary();
        const orders = await DB.getAllOrders();
        const activeUser = Session.get();

        const csvContent = this.generateCSVReport(summary, orders, activeUser);
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const filename = `sales_report_${year}-${month}-${day}.csv`;

        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      };
    }

    // 3. In-App Order Void Modal Action Triggers
    if (this.elements.btnCancelVoidOrder) {
      this.elements.btnCancelVoidOrder.onclick = () => this.closeVoidOrderModal();
    }

    if (this.elements.btnCloseVoidOrderX) {
      this.elements.btnCloseVoidOrderX.onclick = () => this.closeVoidOrderModal();
    }

    if (this.elements.btnConfirmVoidOrder) {
      this.elements.btnConfirmVoidOrder.onclick = async () => {
        const ordId = parseInt(this.elements.voidOrderIdInput.value, 10);
        const reason = (this.elements.voidOrderReasonInput.value || "").trim();

        if (!reason) {
          if (this.elements.voidOrderErrorMsg) {
            this.elements.voidOrderErrorMsg.textContent = "Please provide a reason for voiding this sale.";
          }
          if (this.elements.voidOrderReasonInput) {
            this.elements.voidOrderReasonInput.focus();
          }
          return;
        }

        const activeManager = Session.get() || { id: "ADM-001", name: "Manager" };

        try {
          await DB.voidOrder(ordId, activeManager, reason);
          this.closeVoidOrderModal();
          await this.loadSalesReport();
          Bus.emit("inventory:updated");

          Sync.pushPendingOrders({ silent: true }).catch((err) => {
            console.warn("[Admin Void Sync] Background sync queued:", err.message);
          });
        } catch (err) {
          console.error("[Admin Sales Void Error]:", err);
          if (this.elements.voidOrderErrorMsg) {
            this.elements.voidOrderErrorMsg.textContent = `Failed: ${err.message}`;
          }
        }
      };
    }
  },

  /**
   * Opens the in-app confirmation modal for order voiding
   * @param {number} ordId - Database ID of order
   * @param {string} ordNum - Order Number reference string
   */
  openVoidOrderModal(ordId, ordNum) {
    if (!this.elements.modalVoidOrder) return;

    if (this.elements.voidOrderIdInput) this.elements.voidOrderIdInput.value = ordId;
    if (this.elements.voidOrderNumInput) this.elements.voidOrderNumInput.value = ordNum;
    if (this.elements.voidOrderNumberLabel) this.elements.voidOrderNumberLabel.textContent = ordNum;
    if (this.elements.voidOrderReasonInput) this.elements.voidOrderReasonInput.value = "";
    if (this.elements.voidOrderErrorMsg) this.elements.voidOrderErrorMsg.textContent = "";

    if (typeof this.elements.modalVoidOrder.showModal === "function") {
      this.elements.modalVoidOrder.showModal();
    }

    setTimeout(() => {
      if (this.elements.voidOrderReasonInput) {
        this.elements.voidOrderReasonInput.focus();
      }
    }, 100);
  },

  /**
   * Closes the in-app void modal
   */
  closeVoidOrderModal() {
    if (this.elements.modalVoidOrder && this.elements.modalVoidOrder.open) {
      this.elements.modalVoidOrder.close();
    }
  },

  /**
   * Loads sales summary cards and transaction table rows from IndexedDB
   */
  async loadSalesReport() {
    const summary = await DB.getSalesSummary();
    const orders = await DB.getAllOrders();

    if (this.elements.statGrossSales) {
      this.elements.statGrossSales.textContent = `₱${summary.grossSales.toFixed(2)}`;
    }
    if (this.elements.statTotalOrders) {
      this.elements.statTotalOrders.textContent = String(summary.orderCount);
    }
    if (this.elements.statTotalVat) {
      this.elements.statTotalVat.textContent = `₱${summary.totalVat.toFixed(2)}`;
    }
    if (this.elements.statPaymentSplit) {
      this.elements.statPaymentSplit.textContent = `₱${summary.gcashSales.toFixed(0)} / ₱${summary.cashSales.toFixed(0)}`;
    }

    if (this.elements.salesTbody) {
      this.elements.salesTbody.innerHTML = orders.map((ord) => {
        const d = new Date(ord.timestamp);
        const dateFormatted = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        const isVoided = ord.status === "VOIDED";

        let statusBadge = "";
        let actionBtn = "";

        if (isVoided) {
          statusBadge = `<span class="badge badge-status-out">VOIDED</span>`;
          actionBtn = `<small style="color:var(--text-muted);">Voided by ${ord.voidedBy || "Manager"}</small>`;
        } else {
          statusBadge = `<span class="badge badge-status-ok">COMPLETED</span>`;
          actionBtn = `<button type="button" class="btn-action-sm btn-action-del btn-void-order" data-id="${ord.id}" data-ord="${ord.orderNumber}">Void Sale</button>`;
        }

        return `
          <tr style="${isVoided ? 'opacity: 0.6; text-decoration: line-through;' : ''}">
            <td><b>${ord.orderNumber}</b></td>
            <td>${dateFormatted}</td>
            <td>${ord.cashierName || ord.cashierId}</td>
            <td>
              <span class="badge ${ord.paymentType === "CASH" ? "" : "badge-admin"}">${ord.paymentType}</span>
              ${statusBadge}
            </td>
            <td class="text-right"><b>₱${Number(ord.total || 0).toFixed(2)}</b></td>
            <td class="text-center" style="text-decoration: none;">
              ${actionBtn}
            </td>
          </tr>
        `;
      }).join("");

      this.elements.salesTbody.querySelectorAll(".btn-void-order").forEach((btn) => {
        btn.onclick = () => {
          const ordNum = btn.dataset.ord;
          const ordId = parseInt(btn.dataset.id, 10);
          this.openVoidOrderModal(ordId, ordNum);
        };
      });
    }
  },

  /**
   * Generates formatted CSV content string with UTF-8 BOM
   * @param {Object} summary - Sales summary metrics
   * @param {Array} orders - Order transaction ledger
   * @param {Object} activeUser - Generating employee
   * @returns {string}
   */
  generateCSVReport(summary, orders, activeUser) {
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();

    let csv = "\uFEFF";
    csv += `"POS REG-01 - SALES & FINANCIAL REPORT"\n`;
    csv += `"Generated:","${dateStr} ${timeStr}"\n`;
    csv += `"Generated By:","${activeUser ? activeUser.name : "System"}"\n\n`;

    csv += `"FINANCIAL SUMMARY METRICS"\n`;
    csv += `"Metric","Value"\n`;
    csv += `"Total Orders Completed","${summary.orderCount}"\n`;
    csv += `"Total Orders Voided","${summary.voidedCount || 0}"\n`;
    csv += `"Gross Sales (Net of Voids)","PHP ${summary.grossSales.toFixed(2)}"\n`;
    csv += `"VAT Collected (12%)","PHP ${summary.totalVat.toFixed(2)}"\n`;
    csv += `"Vatable Net Sales","PHP ${(summary.grossSales - summary.totalVat).toFixed(2)}"\n`;
    csv += `"Cash Collections","PHP ${summary.cashSales.toFixed(2)}"\n`;
    csv += `"GCash QR Sales","PHP ${summary.gcashSales.toFixed(2)}"\n\n`;

    csv += `"TRANSACTION HISTORY LEDGER"\n`;
    csv += `"Order #","Date & Time","Status","Cashier / User","Payment Method","Items Summary","Vatable Sales (PHP)","VAT 12% (PHP)","Total Amount (PHP)","Void Details"\n`;

    for (const ord of orders) {
      const d = new Date(ord.timestamp);
      const ts = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      const itemsSummary = (ord.items || [])
        .map((i) => `${i.name} (x${i.qty})`)
        .join("; ");
      const voidInfo = ord.status === "VOIDED"
        ? `Voided by ${ord.voidedBy || "Manager"} (${ord.voidReason || "No Reason"})`
        : "";

      csv += `"${ord.orderNumber}",`;
      csv += `"${ts}",`;
      csv += `"${ord.status || "COMPLETED"}",`;
      csv += `"${(ord.cashierName || ord.cashierId || "").replace(/"/g, '""')}",`;
      csv += `"${ord.paymentType}",`;
      csv += `"${itemsSummary.replace(/"/g, '""')}",`;
      csv += `"${(ord.vatableSales || 0).toFixed(2)}",`;
      csv += `"${(ord.vatAmount || 0).toFixed(2)}",`;
      csv += `"${(ord.total || 0).toFixed(2)}",`;
      csv += `"${voidInfo.replace(/"/g, '""')}"\n`;
    }

    return csv;
  }
};

// REMARK: ADMIN_SALES_JS_MODULARIZATION_COMPLETE