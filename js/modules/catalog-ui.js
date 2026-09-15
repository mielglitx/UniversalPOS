/**
 * Module Description: Product Catalog & Category Workspace Controller
 * Manages category tab navigation, square product card rendering with real-time stock
 * warnings (low stock alerts and out-of-stock overlays), quick-access add-on tray shelf,
 * hardware barcode scanning input, and reactive cart additions.
 */

import { DB } from "./db.js";
import { Cart } from "./cart.js";
import { Bus } from "./bus.js";

// Safe Base64-encoded SVG fallback to prevent quotation collisions in inline onerror handlers
const FALLBACK_IMG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzk0YTNiOCI+PHBhdGggZD0iTTIxIDE5VjVjMC0xLjEtLjktMi0yLTJINWMtMS4xIDAtMiAuOS0yIDJ2MTRjMCAxLjEuOSAyIDIgMmgxNGMxLjEgMCAyLS45IDItMnpNOC41IDEzLjVsMi41IDMuMDFMMTQuNSAxMmw0LjUgNkg1bDMuNS00LjV6Ii8+PC9zdmc+";

export const CatalogUI = {
  currentCategory: "all",
  elements: {},
  initialized: false,

  /**
   * Initializes DOM bindings, scanner listeners, and inventory event subscriptions
   */
  init() {
    this.elements = {
      categoryTabs: document.getElementById("category-tabs"),
      productGrid: document.getElementById("product-grid"),
      barcodeInput: document.getElementById("barcode-input"),
      quickMenuContainer: document.getElementById("quick-menu-container"),
      quickMenuScroll: document.getElementById("quick-menu-scroll")
    };

    // Category sidebar delegation
    if (this.elements.categoryTabs) {
      this.elements.categoryTabs.onclick = async (e) => {
        const pill = e.target.closest(".cat-pill");
        if (!pill || !pill.dataset.cat) return;

        this.elements.categoryTabs.querySelectorAll(".cat-pill").forEach((p) => {
          p.classList.remove("active");
        });
        pill.classList.add("active");
        await this.loadProducts(pill.dataset.cat);
      };
    }

    // Delegated click handler on product grid
    if (this.elements.productGrid) {
      this.elements.productGrid.onclick = async (e) => {
        const card = e.target.closest(".product-card");
        if (!card || !card.dataset.id) return;

        const match = await DB.getProductById(card.dataset.id);
        if (!match) return;

        if (match.isMonitored && match.stock <= 0) {
          alert(`"${match.name}" is OUT OF STOCK.`);
          return;
        }

        if (!match.isMonitored && match.isAvailable === false) {
          alert(`"${match.name}" is currently unavailable.`);
          return;
        }

        const res = Cart.add(match);
        if (!res.ok && res.reason === "stock_exceeded") {
          alert(`Cannot add more "${match.name}": Only ${res.available} unit(s) available in stock.`);
        }
      };
    }

    // Delegated click handler on Quick Menu shelf
    if (this.elements.quickMenuScroll) {
      this.elements.quickMenuScroll.onclick = async (e) => {
        const btn = e.target.closest(".quick-card");
        if (!btn || !btn.dataset.id) return;

        const match = await DB.getProductById(btn.dataset.id);
        if (!match) return;

        if (match.isMonitored && match.stock <= 0) {
          alert(`"${match.name}" is OUT OF STOCK.`);
          return;
        }

        if (!match.isMonitored && match.isAvailable === false) {
          alert(`"${match.name}" is currently unavailable.`);
          return;
        }

        const res = Cart.add(match);
        if (!res.ok && res.reason === "stock_exceeded") {
          alert(`Cannot add more "${match.name}": Only ${res.available} unit(s) available in stock.`);
        }
      };
    }

    // Hardware barcode scanner listener (Enter-terminated string)
    if (this.elements.barcodeInput) {
      this.elements.barcodeInput.onkeydown = async (e) => {
        if (e.key === "Enter") {
          const code = this.elements.barcodeInput.value.trim();
          if (code) {
            const match = await DB.getProductByBarcode(code);
            if (match) {
              const res = Cart.add(match);
              if (!res.ok) {
                if (res.reason === "out_of_stock") {
                  alert(`Cannot add "${match.name}": Item is OUT OF STOCK.`);
                } else if (res.reason === "stock_exceeded") {
                  alert(`Cannot add more "${match.name}": Only ${res.available} unit(s) available in stock.`);
                } else if (res.reason === "unavailable") {
                  alert(`"${match.name}" is currently marked as UNAVAILABLE.`);
                }
              }
            } else {
              console.warn(`[Scanner] Barcode not found in catalog: ${code}`);
            }
          }
          this.elements.barcodeInput.value = "";
        }
      };
    }

    if (this.initialized) return;
    this.initialized = true;

    // Bus event listeners for inventory alerts and catalog updates
    Bus.on("cart:stock-limit-reached", (data) => {
      alert(`Stock Limit Reached: "${data.product.name}" only has ${data.available} unit(s) remaining.`);
    });

    Bus.on("cart:out-of-stock", (data) => {
      alert(`"${data.product.name}" is currently out of stock.`);
    });

    Bus.on("cart:item-unavailable", (data) => {
      alert(`"${data.product.name}" is currently marked as unavailable for sale.`);
    });

    Bus.on("sync:completed", async () => {
      await this.loadProducts(this.currentCategory);
      await this.loadQuickMenu();
    });

    Bus.on("inventory:updated", async () => {
      await this.loadProducts(this.currentCategory);
      await this.loadQuickMenu();
    });

    Bus.on("catalog:addons-updated", async () => {
      await this.loadQuickMenu();
    });
  },

  /**
   * Loads category list from IndexedDB and populates category sidebar
   */
  async loadCategories() {
    if (!this.elements.categoryTabs) return;

    const categories = await DB.getCategories();
    this.elements.categoryTabs.innerHTML = categories.map((cat) => `
      <button class="cat-pill ${cat.id === this.currentCategory ? "active" : ""}" data-cat="${cat.id}">
        <div class="cat-img-wrap">
          <img 
            src="${cat.image || FALLBACK_IMG}" 
            alt="${cat.name}" 
            loading="lazy" 
            onerror="this.onerror=null;this.src='${FALLBACK_IMG}';" 
          />
        </div>
        <span class="cat-label">${cat.name}</span>
      </button>
    `).join("");
  },

  /**
   * Loads products filtered by category and applies visual inventory warnings
   * @param {string} categoryId
   */
  async loadProducts(categoryId = "all") {
    if (!this.elements.productGrid) return;

    this.currentCategory = categoryId;
    const products = await DB.getProducts(categoryId);
    const generalThreshold = parseInt(localStorage.getItem("pos_general_low_stock_threshold") || "5", 10);

    this.elements.productGrid.innerHTML = products.map((prod) => {
      const isMon = Boolean(prod.isMonitored);
      let badgeHtml = "";
      let overlayHtml = "";
      let cardClasses = "product-card";

      if (isMon) {
        const stock = typeof prod.stock === "number" ? prod.stock : 0;
        const effThreshold = (prod.threshold !== null && prod.threshold !== undefined && prod.threshold !== "")
          ? parseInt(prod.threshold, 10)
          : generalThreshold;

        if (stock <= 0) {
          cardClasses += " out-of-stock";
          overlayHtml = `<div class="card-depleted-overlay"><span>OUT OF STOCK</span></div>`;
        } else if (stock <= effThreshold) {
          badgeHtml = `<div class="card-stock-badge badge-low-stock">⚠️ LOW: ${stock}</div>`;
        } else {
          badgeHtml = `<div class="card-stock-badge badge-stock-count">${stock} in stock</div>`;
        }
      } else {
        if (prod.isAvailable === false) {
          cardClasses += " unavailable";
          overlayHtml = `<div class="card-depleted-overlay overlay-unavail"><span>UNAVAILABLE</span></div>`;
        }
      }

      return `
        <div class="${cardClasses}" data-id="${prod.id}">
          <div class="prod-img-wrap">
            ${badgeHtml}
            ${overlayHtml}
            <img 
              class="prod-img" 
              src="${prod.image || FALLBACK_IMG}" 
              alt="${prod.name}" 
              loading="lazy" 
              onerror="this.onerror=null;this.src='${FALLBACK_IMG}';" 
            />
          </div>
          <div class="prod-info">
            <span class="prod-title">${prod.name}</span>
            <div class="price">₱${Number(prod.price).toFixed(2)}</div>
          </div>
        </div>
      `;
    }).join("");
  },

  /**
   * Loads and renders Add-on category products into the horizontal Quick Menu shelf
   */
  async loadQuickMenu() {
    if (!this.elements.quickMenuScroll || !this.elements.quickMenuContainer) return;

    const addonProducts = await DB.getAddonProducts();

    if (addonProducts.length === 0) {
      this.elements.quickMenuContainer.classList.add("hidden");
      this.elements.quickMenuScroll.innerHTML = "";
      return;
    }

    this.elements.quickMenuContainer.classList.remove("hidden");

    this.elements.quickMenuScroll.innerHTML = addonProducts.map((item) => {
      const isMon = Boolean(item.isMonitored);
      let disabledClass = "";
      let stockHint = "";

      if (isMon) {
        const stock = typeof item.stock === "number" ? item.stock : 0;
        if (stock <= 0) {
          disabledClass = " out-of-stock";
          stockHint = `<span class="quick-card-stock out">Out</span>`;
        } else {
          stockHint = `<span class="quick-card-stock">${stock} left</span>`;
        }
      } else if (item.isAvailable === false) {
        disabledClass = " unavailable";
        stockHint = `<span class="quick-card-stock out">Unavail</span>`;
      }

      return `
        <button type="button" class="quick-card${disabledClass}" data-id="${item.id}" title="Quick Add: ${item.name}">
          <div class="quick-card-thumb">
            <img 
              src="${item.image || FALLBACK_IMG}" 
              alt="${item.name}" 
              loading="lazy" 
              onerror="this.onerror=null;this.src='${FALLBACK_IMG}';" 
            />
          </div>
          <div class="quick-card-details">
            <span class="quick-card-title">${item.name}</span>
            <div class="quick-card-meta">
              <span class="quick-card-price">₱${Number(item.price).toFixed(2)}</span>
              ${stockHint}
            </div>
          </div>
        </button>
      `;
    }).join("");
  },

  /**
   * Focuses the barcode input field for immediate scanning
   */
  focusBarcode() {
    if (this.elements.barcodeInput) {
      this.elements.barcodeInput.focus();
    }
  },

  /**
   * Returns current active category ID
   * @returns {string}
   */
  getActiveCategory() {
    return this.currentCategory;
  }
};

// REMARK: CATALOG_UI_JS_MODULARIZATION_COMPLETE