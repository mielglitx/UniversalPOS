/**
 * Module Description: Printer Hub & Hardware Management UI Controller
 * Manages the thermal printer console, interface filtering (All, LAN, BT, USB),
 * WebUSB dynamic hardware pairing and enumeration, receipt role assignment
 * (Primary Customer Copy vs Secondary Server Slip), automatic paper width detection
 * for ESC/POS and XPrinter mechanisms, and diagnostic test print dispatching.
 */

import { DB } from "./db.js";
import { Printer } from "./printer.js";

export const PrinterUI = {
  elements: {},
  currentFilter: "all",
  detectedUsbDevices: [],
  initialized: false,

  /**
   * Initializes DOM bindings, hardware listeners, and event handlers
   */
  init() {
    this.elements = {
      modalPrinter: document.getElementById("modal-printer"),
      btnPrinterDialog: document.getElementById("btn-printer-dialog"),
      btnClosePrinterHub: document.getElementById("btn-close-printer-hub"),
      btnTestAllPrinters: document.getElementById("btn-test-all-printers"),
      printerFilterInterface: document.getElementById("printer-filter-interface"),
      printerListContainer: document.getElementById("printer-list-container"),

      // New Printer Form Controls
      newPrinterName: document.getElementById("new-printer-name"),
      newPrinterType: document.getElementById("new-printer-type"),
      newPrinterRole: document.getElementById("new-printer-role"),
      newPrinterPaper: document.getElementById("new-printer-paper"),

      // Interface Parameter Field Wrappers
      fieldNetworkWrap: document.getElementById("field-network-wrap"),
      newPrinterIp: document.getElementById("new-printer-ip"),
      newPrinterPort: document.getElementById("new-printer-port"),
      fieldBluetoothWrap: document.getElementById("field-bluetooth-wrap"),
      newPrinterBtName: document.getElementById("new-printer-bt-name"),
      fieldUsbWrap: document.getElementById("field-usb-wrap"),
      newPrinterUsbSelect: document.getElementById("new-printer-usb-select"),
      btnScanUsbPrinter: document.getElementById("btn-scan-usb-printer"),
      newPrinterUsbPort: document.getElementById("new-printer-usb-port"),

      btnSaveNewPrinter: document.getElementById("btn-save-new-printer"),
      btnKickDrawer: document.getElementById("btn-kick-drawer")
    };

    // Open Hub Modal
    if (this.elements.btnPrinterDialog) {
      this.elements.btnPrinterDialog.onclick = async () => {
        if (this.elements.printerFilterInterface) {
          this.elements.printerFilterInterface.value = "all";
        }
        this.currentFilter = "all";
        await this.loadPrinterHub("all");
        await this.refreshUsbPrinterList();
        if (this.elements.modalPrinter && typeof this.elements.modalPrinter.showModal === "function") {
          this.elements.modalPrinter.showModal();
        }
      };
    }

    // Close Hub Modal
    if (this.elements.btnClosePrinterHub) {
      this.elements.btnClosePrinterHub.onclick = () => {
        if (this.elements.modalPrinter && this.elements.modalPrinter.open) {
          this.elements.modalPrinter.close();
        }
      };
    }

    // Filter by Interface Type
    if (this.elements.printerFilterInterface) {
      this.elements.printerFilterInterface.onchange = async () => {
        this.currentFilter = this.elements.printerFilterInterface.value;
        await this.loadPrinterHub(this.currentFilter);
      };
    }

    // Toggle Form Fields Based on Selected Interface Type
    if (this.elements.newPrinterType) {
      this.elements.newPrinterType.onchange = () => this.handleInterfaceTypeChange();
    }

    // Pair and Enumerate USB Printers
    if (this.elements.btnScanUsbPrinter) {
      this.elements.btnScanUsbPrinter.onclick = () => this.pairUsbPrinter();
    }

    // USB Printer Selection Handler (Auto-sets name and paper width)
    if (this.elements.newPrinterUsbSelect) {
      this.elements.newPrinterUsbSelect.onchange = () => this.handleUsbSelectChange();
    }

    // Add New Printer Submit
    if (this.elements.btnSaveNewPrinter) {
      this.elements.btnSaveNewPrinter.onclick = () => this.handleSaveNewPrinter();
    }

    // Test All Selected Active Printers
    if (this.elements.btnTestAllPrinters) {
      this.elements.btnTestAllPrinters.onclick = () => this.handleTestAllSelected();
    }

    // Hardware Cash Drawer Kick Trigger
    if (this.elements.btnKickDrawer) {
      this.elements.btnKickDrawer.onclick = async () => {
        const enabledPrinters = await DB.getEnabledPrinters();
        await Printer.kickDrawer(enabledPrinters);
      };
    }

    if (this.initialized) return;
    this.initialized = true;

    // Listen for OS-level USB device connections and disconnections
    if (navigator.usb) {
      navigator.usb.addEventListener("connect", () => this.refreshUsbPrinterList());
      navigator.usb.addEventListener("disconnect", () => this.refreshUsbPrinterList());
    }
  },

  /**
   * Toggles configuration fields based on interface selection
   */
  handleInterfaceTypeChange() {
    if (!this.elements.newPrinterType) return;
    const type = this.elements.newPrinterType.value;

    if (type === "all") {
      // Reveal all inputs simultaneously for universal multi-homed configuration
      if (this.elements.fieldNetworkWrap) this.elements.fieldNetworkWrap.classList.remove("hidden");
      if (this.elements.fieldBluetoothWrap) this.elements.fieldBluetoothWrap.classList.remove("hidden");
      if (this.elements.fieldUsbWrap) this.elements.fieldUsbWrap.classList.remove("hidden");
      this.refreshUsbPrinterList();
    } else {
      if (this.elements.fieldNetworkWrap) this.elements.fieldNetworkWrap.classList.toggle("hidden", type !== "network");
      if (this.elements.fieldBluetoothWrap) this.elements.fieldBluetoothWrap.classList.toggle("hidden", type !== "bluetooth");
      if (this.elements.fieldUsbWrap) this.elements.fieldUsbWrap.classList.toggle("hidden", type !== "usb");

      if (type === "usb") {
        this.refreshUsbPrinterList();
      }
    }
  },

  /**
   * Discovers and populates already paired USB devices in the dropdown
   */
  async refreshUsbPrinterList() {
    if (!navigator.usb || !this.elements.newPrinterUsbSelect) return;

    try {
      this.detectedUsbDevices = await navigator.usb.getDevices();
      const select = this.elements.newPrinterUsbSelect;

      select.innerHTML = '<option value="">-- Select Detected USB Printer --</option>';

      if (this.detectedUsbDevices.length === 0) {
        select.innerHTML = '<option value="">-- No USB Printers Paired (Click "Pair USB") --</option>';
        return;
      }

      this.detectedUsbDevices.forEach((device) => {
        const devId = `${device.vendorId}_${device.productId}`;
        const name = device.productName || `USB POS Printer (${device.vendorId.toString(16)}:${device.productId.toString(16)})`;
        const option = document.createElement("option");
        option.value = devId;
        option.textContent = name;
        select.appendChild(option);
      });
    } catch (err) {
      console.warn("[PrinterUI] Error reading paired USB devices:", err);
    }
  },

  /**
   * Launches native WebUSB browser pairing dialog with filters for thermal printers and XPrinter
   */
  async pairUsbPrinter() {
    if (!navigator.usb) {
      alert("WebUSB is not supported in this browser. Use Google Chrome, Edge, or an Android WebView.");
      return;
    }

    try {
      // Common USB Vendor IDs for thermal printers (Winbond, STMicroelectronics, Epson, XPrinter clones)
      const filters = [
        { classCode: 7 },         // Standard USB Printer Class
        { vendorId: 0x0416 },     // Winbond / XPrinter
        { vendorId: 0x0483 },     // STMicroelectronics / XPrinter
        { vendorId: 0x04b8 },     // Epson ESC/POS
        { vendorId: 0x1fc9 },     // NXP / POS Thermal
        { vendorId: 0x0fe6 },     // ICS
        { vendorId: 0x28e9 }      // GigaDevice / XPrinter Clones
      ];

      const device = await navigator.usb.requestDevice({ filters });
      if (device) {
        await this.refreshUsbPrinterList();
        const devId = `${device.vendorId}_${device.productId}`;
        if (this.elements.newPrinterUsbSelect) {
          this.elements.newPrinterUsbSelect.value = devId;
        }
        this.handleUsbSelectChange();
      }
    } catch (err) {
      if (err.name !== "NotFoundError") {
        console.error("[PrinterUI] WebUSB Pairing Failed:", err);
        alert(`USB Pairing Error: ${err.message}`);
      }
    }
  },

  /**
   * Automatically sets the paper width and suggested name when a USB printer is chosen
   */
  handleUsbSelectChange() {
    if (!this.elements.newPrinterUsbSelect) return;
    const selectedVal = this.elements.newPrinterUsbSelect.value;
    if (!selectedVal) return;

    if (this.elements.newPrinterUsbPort) {
      this.elements.newPrinterUsbPort.value = selectedVal;
    }

    const device = this.detectedUsbDevices.find((d) => `${d.vendorId}_${d.productId}` === selectedVal);
    const prodName = device && device.productName ? device.productName : "";

    // 1. Auto-fill printer location/name if empty
    if (this.elements.newPrinterName && !this.elements.newPrinterName.value.trim()) {
      this.elements.newPrinterName.value = prodName || "Counter USB Printer";
    }

    // 2. Auto-detect paper width based on XPrinter model strings
    if (this.elements.newPrinterPaper) {
      const lowerName = prodName.toLowerCase();
      if (
        lowerName.includes("80") ||
        lowerName.includes("xp-80") ||
        lowerName.includes("n160") ||
        lowerName.includes("t80") ||
        lowerName.includes("80mm")
      ) {
        this.elements.newPrinterPaper.value = "80mm";
      } else if (
        lowerName.includes("58") ||
        lowerName.includes("xp-58") ||
        lowerName.includes("q90") ||
        lowerName.includes("v3") ||
        lowerName.includes("58mm")
      ) {
        this.elements.newPrinterPaper.value = "58mm";
      }
    }
  },

  /**
   * Loads printers from IndexedDB, applies interface filter, and renders roster
   * @param {string} filterType
   */
  async loadPrinterHub(filterType = "all") {
    if (!this.elements.printerListContainer) return;

    const allPrinters = await DB.getPrinters();
    const printers = filterType === "all"
      ? allPrinters
      : allPrinters.filter((p) => p.type === filterType || p.type === "all");

    if (printers.length === 0) {
      this.elements.printerListContainer.innerHTML = `
        <p class="printer-hint-text" style="text-align:center; padding:16px;">
          No ${filterType === "all" ? "" : filterType.toUpperCase() + " "}printers configured. Add one below.
        </p>
      `;
      return;
    }

    this.elements.printerListContainer.innerHTML = printers.map((p) => {
      let meta = "";
      if (p.type === "network") {
        meta = `TCP: ${p.address || "192.168.1.100"}:${p.port || 9100}`;
      } else if (p.type === "bluetooth") {
        meta = `BT: ${p.btName || "MPT-II"}`;
      } else if (p.type === "usb") {
        meta = `USB Port / ID: ${p.usbPort || "USB001"}`;
      } else if (p.type === "all") {
        meta = `Universal: ${p.address || "LAN"} | ${p.btName || "BT"} | ${p.usbPort || "USB"}`;
      }

      const currentRole = p.role || "primary";
      let roleBadgeClass = "badge-role-primary";
      if (currentRole === "secondary") roleBadgeClass = "badge-role-secondary";
      if (currentRole === "both") roleBadgeClass = "badge-role-both";

      return `
        <div class="printer-card" data-id="${p.id}">
          <div class="printer-card-left">
            <input 
              type="checkbox" 
              class="printer-checkbox" 
              data-id="${p.id}" 
              ${p.isEnabled ? "checked" : ""} 
              title="Enable or disable printing to this unit" 
            />
            <div class="printer-card-info">
              <span class="printer-card-title">
                ${p.name}
                <span class="badge ${p.type === "network" ? "" : "badge-admin"}">${p.type.toUpperCase()}</span>
                <span class="badge ${roleBadgeClass}">${currentRole.toUpperCase()}</span>
                <small style="font-weight:normal; opacity:0.75;">(${p.paperWidth || "58mm"})</small>
              </span>
              <span class="printer-card-meta">${meta}</span>
            </div>
          </div>
          <div class="printer-card-actions">
            <select class="printer-role-select" data-id="${p.id}" title="Assign Receipt Role">
              <option value="primary" ${currentRole === "primary" ? "selected" : ""}>Primary (Customer)</option>
              <option value="secondary" ${currentRole === "secondary" ? "selected" : ""}>Secondary (Server Slip)</option>
              <option value="both" ${currentRole === "both" ? "selected" : ""}>Both Copies</option>
            </select>
            <button class="btn-action-sm btn-test-single-printer" data-id="${p.id}">Test</button>
            <button class="btn-action-sm btn-action-del btn-del-printer" data-id="${p.id}">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    // Bind Enable/Disable Checkboxes
    this.elements.printerListContainer.querySelectorAll(".printer-checkbox").forEach((cb) => {
      cb.onchange = async () => {
        await DB.togglePrinterEnabled(cb.dataset.id, cb.checked);
      };
    });

    // Bind Role Selectors (Primary, Secondary, Both)
    this.elements.printerListContainer.querySelectorAll(".printer-role-select").forEach((sel) => {
      sel.onchange = async () => {
        await DB.setPrinterRole(sel.dataset.id, sel.value);
        await this.loadPrinterHub(this.currentFilter);
      };
    });

    // Bind Individual Unit Test Prints
    this.elements.printerListContainer.querySelectorAll(".btn-test-single-printer").forEach((btn) => {
      btn.onclick = async () => {
        const target = await DB.getPrinterById(btn.dataset.id);
        if (target) {
          await Printer.testPrint(target);
          alert(`Test print dispatched to [${(target.role || "primary").toUpperCase()}] ${target.name}.`);
        }
      };
    });

    // Bind Delete Printer Actions
    this.elements.printerListContainer.querySelectorAll(".btn-del-printer").forEach((btn) => {
      btn.onclick = async () => {
        if (confirm("Are you sure you want to remove this printer configuration?")) {
          await DB.deletePrinter(btn.dataset.id);
          await this.loadPrinterHub(this.currentFilter);
        }
      };
    });
  },

  /**
   * Dispatches diagnostic test across all enabled printers
   */
  async handleTestAllSelected() {
    const enabledPrinters = await DB.getEnabledPrinters();
    if (enabledPrinters.length === 0) {
      alert("No printers are currently checked. Select at least one printer to test.");
      return;
    }

    const testTicket = {
      orderNumber: "TEST-ALL",
      cashierName: "Admin Diagnostic",
      items: [
        { name: "Caramel Macchiato", qty: 2, price: 130.0 },
        { name: "Pork Sisig Rice", qty: 1, price: 165.0 }
      ],
      vatableSales: 379.46,
      vatAmount: 45.54,
      total: 425.0,
      paymentType: "TEST BROADCAST"
    };

    await Printer.broadcastReceipt(enabledPrinters, testTicket);
    alert(`Broadcast test sent: Customer copy to Primary, Server Slip to Secondary.`);
  },

  /**
   * Validates form and commits new printer target to IndexedDB
   */
  async handleSaveNewPrinter() {
    const name = this.elements.newPrinterName ? this.elements.newPrinterName.value.trim() : "";
    const type = this.elements.newPrinterType ? this.elements.newPrinterType.value : "all";
    const role = this.elements.newPrinterRole ? this.elements.newPrinterRole.value : "primary";
    const paperWidth = this.elements.newPrinterPaper ? this.elements.newPrinterPaper.value : "58mm";

    if (!name) {
      alert("Please enter a printer name or location.");
      return;
    }

    const payload = {
      name,
      type,
      role,
      paperWidth,
      isEnabled: true
    };

    if (type === "network" || type === "all") {
      payload.address = this.elements.newPrinterIp ? this.elements.newPrinterIp.value.trim() || "192.168.1.100" : "192.168.1.100";
      payload.port = this.elements.newPrinterPort ? parseInt(this.elements.newPrinterPort.value.trim(), 10) || 9100 : 9100;
    }
    if (type === "bluetooth" || type === "all") {
      payload.btName = this.elements.newPrinterBtName ? this.elements.newPrinterBtName.value.trim() || "MPT-II" : "MPT-II";
    }
    if (type === "usb" || type === "all") {
      const selectedUsb = this.elements.newPrinterUsbSelect ? this.elements.newPrinterUsbSelect.value : "";
      payload.usbPort = selectedUsb || (this.elements.newPrinterUsbPort ? this.elements.newPrinterUsbPort.value.trim() : "") || "USB001";
    }

    await DB.addPrinter(payload);

    // Reset form inputs
    if (this.elements.newPrinterName) this.elements.newPrinterName.value = "";
    if (this.elements.newPrinterBtName) this.elements.newPrinterBtName.value = "";
    if (this.elements.newPrinterUsbPort) this.elements.newPrinterUsbPort.value = "";
    if (this.elements.newPrinterUsbSelect) this.elements.newPrinterUsbSelect.value = "";
    if (this.elements.newPrinterType) this.elements.newPrinterType.value = "all";
    this.handleInterfaceTypeChange();

    await this.loadPrinterHub(this.currentFilter);
  }
};

// REMARK: PRINTER_UI_JS_MODULARIZATION_COMPLETE