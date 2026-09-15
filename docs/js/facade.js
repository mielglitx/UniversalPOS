/**
 * Module Description: POS Architecture & Facade Barrel Gateway
 * Unifies access across persistence, hardware bridges, UI controllers, background
 * synchronization adapters, session state, reporting engines, and register workflows.
 * Contains the complete functional directory documenting the exact responsibilities
 * of every decoupled micro-module in the system.
 *
 * =============================================================================
 * MODULE INVENTORY & FUNCTIONAL DIRECTORY
 * =============================================================================
 *
 * 1. DB (`modules/db.js`):
 *    - Function: Offline persistence layer powered by Dexie.js (IndexedDB).
 *    - Responsibilities: Manages local database tables for products, categories,
 *      staff accounts, completed sales orders, line-item void audit logs, thermal
 *      printer targets, store branding profile settings, and offline sync queues.
 *
 * 2. Bus (`modules/bus.js`):
 *    - Function: Decoupled Publish/Subscribe (PubSub) event bus.
 *    - Responsibilities: Emits and listens to global domain events (cart changes,
 *      catalog modifications, inventory stock updates, and authentication state)
 *      to eliminate circular dependencies and tight coupling across modules.
 *
 * 3. Cart (`modules/cart.js`):
 *    - Function: Active transaction and line-item calculation engine.
 *    - Responsibilities: Manages the active ticket item array, enforces stock availability,
 *      computes Philippine statutory 12% VAT, net vatable sales, non-taxable sales,
 *      and grand totals due.
 *
 * 4. AuthVoid (`modules/auth-void.js`):
 *    - Function: Security authorization gatekeeper for cashier line-item voids.
 *    - Responsibilities: Prompts for and verifies manager PIN or optical QR employee
 *      badges before allowing removal of an item from an active cart.
 *
 * 5. GCashEMVCo (`modules/gcash-emvco.js`):
 *    - Function: BSP-compliant QR Ph dynamic payment payload generator.
 *    - Responsibilities: Formats EMVCo-compliant QR payload strings encoding the
 *      exact payable total for direct mobile scanning by customers.
 *
 * 6. Printer (`modules/printer.js`):
 *    - Function: ESC/POS binary command builder and hardware transmission dispatcher.
 *    - Responsibilities: Compiles byte buffers for customer official receipts (with store
 *      branding headers) and kitchen order slips; transmits jobs via TCP sockets (LAN/Wi-Fi),
 *      Bluetooth, WebUSB, or Flutter native mobile bridges.
 *
 * 7. Theme (`modules/theme.js`):
 *    - Function: Register styling and visual theme state controller.
 *    - Responsibilities: Manages toggling and local persistence between "basic" (high-contrast)
 *      and "modern" POS register themes.
 *
 * 8. Sync (`modules/sync.js`):
 *    - Function: Offline-first background remote database synchronization engine.
 *    - Responsibilities: Automatically pushes pending orders and modified stock counts
 *      to cloud endpoints (Firebase Realtime Database or Google Apps Script) and pulls
 *      updated remote catalog items.
 *
 * 9. Session (`modules/session.js`):
 *    - Function: Active employee authentication state manager.
 *    - Responsibilities: Tracks the signed-in user record, evaluates administrator and
 *      manager security roles, and clears user state on terminal lock.
 *
 * 10. Reports (`modules/reports.js`):
 *     - Function: ESC/POS financial summary and Z-reading byte builder.
 *     - Responsibilities: Generates 32-column (58mm) and 48-column (80mm) end-of-day
 *       sales summary reports, cash/GCash collection breakdowns, and tax ledgers.
 *
 * 11. POS & CartQtyModal (`modules/pos-core.js`):
 *     - Function: Core register workflow bootstrap and touch quantity editor controller.
 *     - Responsibilities: Binds reactive ticket table DOM elements, handles line-item
 *       void requests, and manages the direct touch numpad modal supporting numeric
 *       quantities up to 18 digits.
 *
 * 12. LoginUI (`modules/login-ui.js`):
 *     - Function: Full-screen terminal lock, optical QR camera scanner, and PIN pad.
 *     - Responsibilities: Locks terminal when idle, scans employee badges via camera,
 *       and validates staff numeric PINs.
 *
 * 13. CatalogUI (`modules/catalog-ui.js`):
 *     - Function: Register catalog, category sidebar, and Quick Menu shelf controller.
 *     - Responsibilities: Renders square product cards, manages category selection,
 *       and populates the one-touch add-on tray below the product grid.
 *
 * 14. CheckoutUI (`modules/checkout-ui.js`):
 *     - Function: Payment processing and order finalization controller.
 *     - Responsibilities: Coordinates cash payment confirmation (tendered amount and
 *       change due calculation), GCash reference capture, database persistence, and
 *       dual-printer receipt dispatching.
 *
 * 15. PrinterUI (`modules/printer-ui.js`):
 *     - Function: Multi-Printer Management Console controller.
 *     - Responsibilities: Discovers, pairs, tests, and configures thermal printers across
 *       Network, Bluetooth, and USB interfaces, assigning roles as Primary, Secondary, or Both.
 *
 * 16. AdminUI (`modules/admin-ui.js`):
 *     - Function: Back-office administration and management portal controller.
 *     - Responsibilities: Manages transaction history, post-checkout order voids,
 *       product catalog CRUD, category ordering, staff user accounts, employee QR badge
 *       exports, store profile branding (name, address, contact, logo), and cloud sync.
 * =============================================================================
 */

// Core Data, Hardware & Network Micro-Modules
export { DB } from "./modules/db.js";
export { Bus } from "./modules/bus.js";
export { Cart } from "./modules/cart.js";
export { AuthVoid } from "./modules/auth-void.js";
export { GCashEMVCo } from "./modules/gcash-emvco.js";
export { Printer } from "./modules/printer.js";
export { Theme } from "./modules/theme.js";
export { Sync } from "./modules/sync.js";

// Session, Reporting & Register Core Subsystems
export { Session } from "./modules/session.js";
export { Reports } from "./modules/reports.js";
export { POS, CartQtyModal } from "./modules/pos-core.js";

// Modularized UI Subsystem Controllers
export { LoginUI } from "./modules/login-ui.js";
export { CatalogUI } from "./modules/catalog-ui.js";
export { CheckoutUI } from "./modules/checkout-ui.js";
export { PrinterUI } from "./modules/printer-ui.js";
export { AdminUI } from "./modules/admin-ui.js";

// REMARK: FACADE_JS_BARREL_DIRECTORY_COMPLETE