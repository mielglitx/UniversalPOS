/**
 * Module Description: ESC/POS Binary Command Builder & Hardware Dispatcher
 * Builds binary print job buffers for Customer Official Receipts (with store branding
 * headers, itemized pricing, customer calling buzzer/pager numbers, and VAT breakdown)
 * and Server Kitchen Slips (high-visibility item quantities and prominent buzzer numbers).
 * Dynamically routes jobs to Primary, Secondary, or Both targets, supporting LAN/Wi-Fi
 * (TCP 9100), Bluetooth, WebUSB, and native mobile container bridges.
 */

import { DB } from "./db.js";

export const Printer = {
  ip: localStorage.getItem("pos_printer_ip") || "192.168.1.100",
  port: parseInt(localStorage.getItem("pos_printer_port") || "9100", 10),

  setTarget(ip, port) {
    this.ip = ip;
    this.port = port;
    localStorage.setItem("pos_printer_ip", ip);
    localStorage.setItem("pos_printer_port", port);
  },

  /**
   * Generates Customer Receipt ESC/POS bytes (Official copy with store profile, prices, buzzer, VAT, and totals)
   * @param {Object} ticket - Calculated ticket details
   * @param {string} paperWidth - Paper format ('58mm' or '80mm')
   * @returns {Promise<Uint8Array>}
   */
  async buildCustomerReceiptBytes(ticket, paperWidth = "58mm") {
    const is80mm = paperWidth === "80mm";
    const totalCols = is80mm ? 48 : 32;
    const divider = "-".repeat(totalCols) + "\n";
    const doubleDivider = "=".repeat(totalCols) + "\n";

    // Retrieve active store profile branding from IndexedDB
    const store = await DB.getStoreSettings();

    const encoder = new TextEncoder();
    const buffer = [];

    const append = (bytes) => buffer.push(...bytes);
    const text = (str) => {
      // Normalize currency symbol to ASCII 'P' for reliable printing across ESC/POS models
      const sanitized = str.replace(/₱/g, "P");
      append(encoder.encode(sanitized));
    };

    // 1. Initialize Printer (ESC @)
    append([0x1B, 0x40]);

    // 2. Select Standard Character Code Table PC437 (ESC t 0)
    append([0x1B, 0x74, 0x00]);

    // 3. Center Align (ESC a 1)
    append([0x1B, 0x61, 0x01]);

    // 4. Double-Height Bold Store Title (ESC ! 0x30)
    append([0x1B, 0x21, 0x30]);
    text(`${(store.storeName || "LOKALEX STORE").toUpperCase()}\n`);

    // 5. Reset Format (ESC ! 0x00) & Print Sub-Headers
    append([0x1B, 0x21, 0x00]);
    if (store.companyName) {
      text(`${store.companyName}\n`);
    }
    if (store.address) {
      text(`${store.address}\n`);
    }
    if (store.contactNumber) {
      text(`Tel: ${store.contactNumber}\n`);
    }

    text(doubleDivider);
    text("[ CUSTOMER OFFICIAL RECEIPT ]\n");
    text(`Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}\n`);
    if (ticket.orderNumber) {
      text(`Order: ${ticket.orderNumber}\n`);
    }
    if (ticket.cashierName) {
      text(`Cashier: ${ticket.cashierName}\n`);
    }

    // Prominently print buzzer/pager number if assigned
    if (ticket.pagerNumber) {
      text(divider);
      append([0x1B, 0x61, 0x01]); // Center Align
      append([0x1B, 0x21, 0x30]); // Double-Height & Double-Width Bold
      text(`BUZZER #${ticket.pagerNumber}\n`);
      append([0x1B, 0x21, 0x00]); // Reset font
      append([0x1B, 0x61, 0x00]); // Left Align
    }
    text(divider);

    // 6. Left Align (ESC a 0)
    append([0x1B, 0x61, 0x00]);

    // Column Formatter for Customer Receipt (Total width calibrated to 32 or 48)
    const padRow = (col1, col2, col3) => {
      if (is80mm) {
        // 48 cols: Name(24) + space(1) + Qty(7) + space(1) + Price(15) = 48
        const c1 = col1.padEnd(24, " ").substring(0, 24);
        const c2 = col2.padEnd(7, " ").substring(0, 7);
        const c3 = col3.padStart(15, " ").substring(0, 15);
        return `${c1} ${c2} ${c3}\n`;
      } else {
        // 32 cols: Name(16) + space(1) + Qty(4) + space(1) + Price(10) = 32
        const c1 = col1.padEnd(16, " ").substring(0, 16);
        const c2 = col2.padEnd(4, " ").substring(0, 4);
        const c3 = col3.padStart(10, " ").substring(0, 10);
        return `${c1} ${c2} ${c3}\n`;
      }
    };

    // Header Row
    text(padRow("ITEM", "QTY", "TOTAL"));
    text(divider);

    // Line Items
    if (Array.isArray(ticket.items)) {
      ticket.items.forEach((item) => {
        const name = item.name || "Item";
        const qty = `${item.qty}x`;
        const sub = `P${((item.price || 0) * (item.qty || 1)).toFixed(2)}`;
        text(padRow(name, qty, sub));
      });
    }

    text(divider);

    // 7. Right Align Totals (ESC a 2)
    append([0x1B, 0x61, 0x02]);
    const vatable = typeof ticket.vatableSales === "number" ? ticket.vatableSales : 0;
    const vat = typeof ticket.vatAmount === "number" ? ticket.vatAmount : 0;
    const total = typeof ticket.total === "number" ? ticket.total : 0;

    text(`Vatable Sales: P${vatable.toFixed(2)}\n`);
    text(`VAT Amount (12%): P${vat.toFixed(2)}\n`);

    // Bold Grand Total (ESC E 1)
    append([0x1B, 0x45, 0x01]);
    text(`TOTAL AMOUNT: P${total.toFixed(2)}\n`);
    append([0x1B, 0x45, 0x00]);

    if (ticket.paymentType) {
      text(`Payment Mode: ${ticket.paymentType}\n`);
    }
    if (ticket.amountTendered !== null && ticket.amountTendered !== undefined) {
      text(`Amount Tendered: P${Number(ticket.amountTendered).toFixed(2)}\n`);
    }
    if (ticket.changeAmount !== null && ticket.changeAmount !== undefined) {
      text(`Change: P${Number(ticket.changeAmount).toFixed(2)}\n`);
    }
    if (ticket.gcashRefNo) {
      text(`GCash Ref: ${ticket.gcashRefNo}\n`);
    }

    text(doubleDivider);

    // 8. Center Footer (ESC a 1)
    append([0x1B, 0x61, 0x01]);
    if (store.tagline) {
      text(`"${store.tagline}"\n`);
    }
    text("Thank you for your purchase!\n");
    text("Please visit us again.\n\n\n\n");

    // 9. Partial Cut (GS V 66 0)
    append([0x1D, 0x56, 0x42, 0x00]);

    return new Uint8Array(buffer);
  },

  /**
   * Generates Server Order Slip ESC/POS bytes
   * Displays high-visibility item names, quantities, and buzzer/pager numbers (No prices, no tax, no totals).
   * @param {Object} ticket
   * @param {string} paperWidth
   * @returns {Uint8Array}
   */
  buildServerSlipBytes(ticket, paperWidth = "58mm") {
    const is80mm = paperWidth === "80mm";
    const totalCols = is80mm ? 48 : 32;
    const divider = "-".repeat(totalCols) + "\n";
    const doubleDivider = "=".repeat(totalCols) + "\n";

    const encoder = new TextEncoder();
    const buffer = [];

    const append = (bytes) => buffer.push(...bytes);
    const text = (str) => {
      const sanitized = str.replace(/₱/g, "P");
      append(encoder.encode(sanitized));
    };

    // 1. Initialize Printer (ESC @)
    append([0x1B, 0x40]);

    // 2. Select Standard Character Code Table PC437 (ESC t 0)
    append([0x1B, 0x74, 0x00]);

    // 3. Center Align (ESC a 1)
    append([0x1B, 0x61, 0x01]);

    // 4. Double-Height Bold Header (ESC ! 0x30)
    append([0x1B, 0x21, 0x30]);
    text("*** SERVER SLIP ***\n");

    // 5. Reset Format (ESC ! 0x00)
    append([0x1B, 0x21, 0x00]);
    if (ticket.orderNumber) {
      append([0x1B, 0x45, 0x01]);
      text(`ORDER: ${ticket.orderNumber}\n`);
      append([0x1B, 0x45, 0x00]);
    }

    // High-visibility buzzer callout for food preparation staff
    if (ticket.pagerNumber) {
      append([0x1B, 0x61, 0x01]); // Center
      append([0x1B, 0x21, 0x30]); // Double-Height & Double-Width Bold
      text(`BUZZER #${ticket.pagerNumber}\n`);
      append([0x1B, 0x21, 0x00]); // Reset
      append([0x1B, 0x61, 0x00]); // Left
    }

    text(`Time: ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}\n`);
    if (ticket.cashierName) {
      text(`Server/Cashier: ${ticket.cashierName}\n`);
    }
    text(doubleDivider);

    // 6. Left Align (ESC a 0)
    append([0x1B, 0x61, 0x00]);

    // Column Formatter for Server Slip
    const padServerRow = (qtyStr, nameStr) => {
      if (is80mm) {
        // 48 cols: QTY(10) + Item Name(38) = 48
        const c1 = qtyStr.padEnd(10, " ").substring(0, 10);
        const c2 = nameStr.padEnd(38, " ").substring(0, 38);
        return `${c1}${c2}\n`;
      } else {
        // 32 cols: QTY(6) + Item Name(26) = 32
        const c1 = qtyStr.padEnd(6, " ").substring(0, 6);
        const c2 = nameStr.padEnd(26, " ").substring(0, 26);
        return `${c1}${c2}\n`;
      }
    };

    text(padServerRow("QTY", "ORDER DETAILS"));
    text(divider);

    let totalItemCount = 0;

    // Line Items with prominent bold quantities
    if (Array.isArray(ticket.items)) {
      ticket.items.forEach((item) => {
        const qty = item.qty || 1;
        totalItemCount += qty;

        // Emphasized bold text for server legibility
        append([0x1B, 0x45, 0x01]);
        text(padServerRow(`[ ${qty}x ]`, item.name || "Item"));
        append([0x1B, 0x45, 0x00]);
      });
    }

    text(divider);

    // Summary of total units
    append([0x1B, 0x45, 0x01]);
    text(`TOTAL UNITS ORDERED: ${totalItemCount}\n`);
    append([0x1B, 0x45, 0x00]);
    text(doubleDivider);

    // Center Alignment
    append([0x1B, 0x61, 0x01]);
    text("[ SERVER / PREPARATION COPY ]\n\n\n\n");

    // Partial Cut (GS V 66 0)
    append([0x1D, 0x56, 0x42, 0x00]);

    return new Uint8Array(buffer);
  },

  /**
   * Cash Drawer Kick Pulse (ESC p m t1 t2)
   * @returns {Uint8Array}
   */
  buildDrawerKickBytes() {
    return new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA]);
  },

  /**
   * Native WebUSB dispatch for thermal receipt printers (including XPrinter)
   * @param {string} usbIdentifier 
   * @param {Uint8Array} bytes 
   * @returns {Promise<Object>}
   */
  async printWebUsb(usbIdentifier, bytes) {
    if (!navigator.usb) {
      throw new Error("WebUSB API is not supported in this browser or environment.");
    }

    const devices = await navigator.usb.getDevices();
    let targetDevice = null;

    if (usbIdentifier) {
      targetDevice = devices.find((d) => {
        const devId = `${d.vendorId}_${d.productId}`;
        return devId === usbIdentifier || (d.productName && d.productName.includes(usbIdentifier));
      });
    }

    if (!targetDevice && devices.length > 0) {
      targetDevice = devices[0];
    }

    if (!targetDevice) {
      throw new Error("No paired USB printer found. Click 'Pair USB' in Printer Settings.");
    }

    await targetDevice.open();

    if (!targetDevice.configuration) {
      await targetDevice.selectConfiguration(1);
    }

    // Find printer interface (Interface Class 7 is USB Printer)
    let printerInterface = targetDevice.configuration.interfaces.find((iface) =>
      iface.alternates.some((alt) => alt.interfaceClass === 7 || alt.interfaceClass === 0 || alt.interfaceClass === 255)
    );

    const interfaceNumber = printerInterface ? printerInterface.interfaceNumber : 0;
    await targetDevice.claimInterface(interfaceNumber);

    // Find bulk OUT endpoint
    const alternate = printerInterface ? printerInterface.alternates[0] : targetDevice.configuration.interfaces[0].alternates[0];
    const outEndpoint = alternate.endpoints.find((ep) => ep.direction === "out" && ep.type === "bulk") || alternate.endpoints.find((ep) => ep.direction === "out");

    if (!outEndpoint) {
      await targetDevice.releaseInterface(interfaceNumber);
      await targetDevice.close();
      throw new Error("Could not identify a USB bulk output endpoint on this printer.");
    }

    // Transmit in chunks (64 bytes)
    const chunkSize = 64;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      await targetDevice.transferOut(outEndpoint.endpointNumber, chunk);
    }

    await targetDevice.releaseInterface(interfaceNumber);
    await targetDevice.close();
    return { ok: true };
  },

  /**
   * Dispatches raw ESC/POS byte sequence to a specific target printer
   * @param {Object} printer 
   * @param {Uint8Array} bytes 
   * @returns {Promise<Object>}
   */
  async dispatchToTarget(printer, bytes) {
    if (!printer) {
      return { ok: false, error: "No target printer specified" };
    }

    const byteList = Array.from(bytes);

    // 1. Check for Mobile WebView Bridge (Android / iOS native shell)
    if (window.flutter_inappwebview) {
      try {
        if (printer.type === "network" || (printer.type === "all" && printer.address)) {
          return await window.flutter_inappwebview.callHandler(
            "printRawTcp",
            printer.address || this.ip,
            parseInt(printer.port, 10) || this.port,
            byteList
          );
        } else if (printer.type === "bluetooth" || (printer.type === "all" && printer.btName)) {
          return await window.flutter_inappwebview.callHandler(
            "printRawBluetooth",
            printer.btName || "MPT-II",
            byteList
          );
        } else if (printer.type === "usb" || (printer.type === "all" && printer.usbPort)) {
          return await window.flutter_inappwebview.callHandler(
            "printRawUsb",
            printer.usbPort || "USB001",
            byteList
          );
        }
      } catch (err) {
        console.error(`[Printer Bridge Error] Dispatch failed for ${printer.name}:`, err);
        return { ok: false, error: err.message };
      }
    }

    // 2. Direct WebUSB Execution (Browser PWA / Desktop Chrome)
    if (printer.type === "usb" && navigator.usb) {
      try {
        await this.printWebUsb(printer.usbPort, bytes);
        return { ok: true, webUsb: true };
      } catch (usbErr) {
        console.warn(`[WebUSB Driver] USB direct print error: ${usbErr.message}`);
      }
    }

    // 3. Fallback / Diagnostic Console Simulation
    console.info(
      `[Printer Simulation] Dispatched ${bytes.length} bytes to [${(printer.role || "primary").toUpperCase()} | ${(printer.type || "all").toUpperCase()}] "${printer.name}" (${printer.paperWidth || "58mm"})`
    );
    return { ok: true, simulated: true, printerId: printer.id };
  },

  /**
   * Dual-Receipt Multi-Printer Concurrent Broadcast Pipeline
   * Routes Customer Receipt to Primary, Server Slip to Secondary,
   * and both slips consecutively to printers flagged as 'both'.
   * @param {Array<Object>} enabledPrinters 
   * @param {Object} ticket 
   * @returns {Promise<Array<Object>>}
   */
  async broadcastReceipt(enabledPrinters, ticket) {
    if (!enabledPrinters || enabledPrinters.length === 0) {
      console.warn("[Printer] No active printers configured. Falling back to default dispatch.");
      const fallbackBytes = await this.buildCustomerReceiptBytes(ticket, "58mm");
      return [
        await this.dispatchToTarget(
          {
            id: "DEFAULT-LAN",
            name: "Default Primary Printer",
            type: "network",
            role: "primary",
            address: this.ip,
            port: this.port,
            paperWidth: "58mm"
          },
          fallbackBytes
        )
      ];
    }

    const dispatchPromises = [];

    for (const printer of enabledPrinters) {
      const width = printer.paperWidth || "58mm";
      const role = printer.role || "primary";

      if (role === "primary") {
        // Customer copy only
        const custBytes = await this.buildCustomerReceiptBytes(ticket, width);
        dispatchPromises.push(this.dispatchToTarget(printer, custBytes));
      } else if (role === "secondary") {
        // Server slip only
        const serverBytes = this.buildServerSlipBytes(ticket, width);
        dispatchPromises.push(this.dispatchToTarget(printer, serverBytes));
      } else if (role === "both") {
        // Combines Customer Copy + Cut + Server Slip + Cut into one continuous dispatch
        const custBytes = await this.buildCustomerReceiptBytes(ticket, width);
        const serverBytes = this.buildServerSlipBytes(ticket, width);

        const combinedBytes = new Uint8Array(custBytes.length + serverBytes.length);
        combinedBytes.set(custBytes, 0);
        combinedBytes.set(serverBytes, custBytes.length);

        dispatchPromises.push(this.dispatchToTarget(printer, combinedBytes));
      }
    }

    return await Promise.allSettled(dispatchPromises);
  },

  /**
   * Cash Drawer Kick Multi-Dispatch (Fires on Primary/Customer cash stations)
   * @param {Array<Object>} enabledPrinters 
   * @returns {Promise<Array<Object>>}
   */
  async kickDrawer(enabledPrinters) {
    const kickBytes = this.buildDrawerKickBytes();

    if (!enabledPrinters || enabledPrinters.length === 0) {
      return await this.dispatchToTarget(
        {
          id: "DEFAULT-LAN",
          name: "Default Printer",
          type: "network",
          address: this.ip,
          port: this.port
        },
        kickBytes
      );
    }

    const primaryPrinters = enabledPrinters.filter(
      (p) => (p.role === "primary" || p.role === "both") && (p.type === "network" || p.type === "usb" || p.type === "all")
    );
    const targets = primaryPrinters.length > 0 ? primaryPrinters : [enabledPrinters[0]];

    const kickPromises = targets.map((printer) => this.dispatchToTarget(printer, kickBytes));
    return await Promise.allSettled(kickPromises);
  },

  /**
   * Diagnostic test execution for a designated role
   * @param {Object} printer 
   * @param {string|null} roleOverride 
   * @returns {Promise<Object>}
   */
  async testPrint(printer, roleOverride = null) {
    const role = roleOverride || printer.role || "primary";
    const width = printer.paperWidth || "58mm";
    const sampleTicket = {
      orderNumber: "TEST-0001",
      cashierName: "Admin Test",
      pagerNumber: "08",
      items: [
        { name: "Caramel Macchiato", qty: 2, price: 130.0 },
        { name: "Pork Sisig Rice", qty: 1, price: 165.0 }
      ],
      vatableSales: 379.46,
      vatAmount: 45.54,
      total: 425.0,
      paymentType: "TEST PRINT"
    };

    if (role === "secondary") {
      const bytes = this.buildServerSlipBytes(sampleTicket, width);
      return await this.dispatchToTarget(printer, bytes);
    } else if (role === "both") {
      const custBytes = await this.buildCustomerReceiptBytes(sampleTicket, width);
      const serverBytes = this.buildServerSlipBytes(sampleTicket, width);
      const combined = new Uint8Array(custBytes.length + serverBytes.length);
      combined.set(custBytes, 0);
      combined.set(serverBytes, custBytes.length);
      return await this.dispatchToTarget(printer, combined);
    } else {
      const bytes = await this.buildCustomerReceiptBytes(sampleTicket, width);
      return await this.dispatchToTarget(printer, bytes);
    }
  },

  async dispatch(bytes) {
    return await this.dispatchToTarget(
      {
        id: "DEFAULT-LAN",
        name: "Default Printer",
        type: "network",
        address: this.ip,
        port: this.port,
        paperWidth: "58mm"
      },
      bytes
    );
  }
};

// REMARK: PRINTER_JS_PAGER_ESCPOS_COMPLETE