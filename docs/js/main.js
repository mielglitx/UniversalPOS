/**
 * Module Description: POS Application Primary Entrypoint & Modular Orchestrator
 * Bypasses mobile WebView local MIME-type restrictions ("text/plain") for ES modules
 * by dynamically fetching component files from correct local paths and importing them via blobs.
 */

import { 
  POS, 
  DB, 
  Cart, 
  Theme, 
  Sync, 
  LoginUI, 
  CatalogUI, 
  CheckoutUI, 
  PrinterUI, 
  AdminUI 
} from "./facade.js";

async function loadComponentScript(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const text = await response.text();
    const blob = new Blob([text], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await import(url);
  } catch (err) {
    console.error(`[Module Loader] Failed to load component ${path}:`, err);
  }
}

async function initApp() {
  try {
    // 1. Dynamically load Web Component UI Skeletons from correct js/components path
    await loadComponentScript("./js/components/pos-login.js");
    await loadComponentScript("./js/components/pos-workspace.js");
    await loadComponentScript("./js/components/pos-admin.js");
    await loadComponentScript("./js/components/pos-modals.js");

    // 2. Initialize IndexedDB schema, seed master records, and sync settings
    await DB.init();

    // 3. Initialize Network Monitor & Cloud Sync Adapter
    Sync.init();

    // 4. Boot POS Facade ticket bindings and manager void modal verification
    POS.boot({
      tbody: document.getElementById("cart-tbody"),
      txtNet: document.getElementById("txt-subtotal"),
      txtVat: document.getElementById("txt-tax"),
      txtTotal: document.getElementById("txt-total"),
      modalVoid: document.getElementById("modal-void"),
      inputVoid: document.getElementById("manager-qr-input"),
      lblVoid: document.getElementById("void-item-label"),
      errVoid: document.getElementById("void-error-msg")
    });

    // 5. Initialize Catalog & Category Browser
    CatalogUI.init();
    await CatalogUI.loadCategories();
    await CatalogUI.loadProducts("all");

    // 6. Initialize Payment & Multi-Printer Checkout Engine
    CheckoutUI.init();

    // 7. Initialize Multi-Printer Hub Console
    PrinterUI.init();

    // 8. Initialize Administration Back-Office Portal
    AdminUI.init({
      onCatalogModified: async () => {
        await CatalogUI.loadCategories();
        await CatalogUI.loadProducts(CatalogUI.getActiveCategory());
      },
      onCategoriesModified: async () => {
        await CatalogUI.loadCategories();
        await CatalogUI.loadProducts(CatalogUI.getActiveCategory());
      }
    });

    // 9. Initialize Lock Screen & Continuous Optical QR Scanner
    LoginUI.init({
      onLoginSuccess: () => {
        CatalogUI.focusBarcode();
      },
      onLock: () => {
        Cart.clear();
      }
    });

    // 10. Bind global register action controls
    const btnThemeBasic = document.getElementById("btn-theme-basic");
    const btnThemeModern = document.getElementById("btn-theme-modern");
    const btnClearCart = document.getElementById("btn-clear-cart");

    if (btnThemeBasic) {
      btnThemeBasic.onclick = () => Theme.set("basic");
    }
    if (btnThemeModern) {
      btnThemeModern.onclick = () => Theme.set("modern");
    }
    if (btnClearCart) {
      btnClearCart.onclick = () => Cart.clear();
    }

  } catch (err) {
    console.error("[POS Bootstrap Error] System failed to initialize:", err);
  }
}

// Start application runtime
initApp();

// REMARK: MAIN_JS_PATH_FIXED