/**
 * Module Description: Admin Store Profile & Branding Settings Sub-Module
 * Manages store branding details (Store Name, Registered Company Name, Branch Address,
 * Contact Numbers, Receipt Footer Taglines), receipt monochrome logo image
 * uploading, and customer number pager/calling buzzer configuration (on/off toggle
 * and total active buzzer count capacity).
 */

import { DB } from "../db.js";

export const AdminStore = {
  elements: {},
  callbacks: {},
  currentStoreLogoBase64: "",
  initialized: false,

  /**
   * Initializes DOM selections and binds store profile save, pager toggle, and logo preview events
   * @param {Object} callbacks - External hooks
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    this.elements = {
      storeNameInput: document.getElementById("store-name-input"),
      storeCompanyInput: document.getElementById("store-company-input"),
      storeAddressInput: document.getElementById("store-address-input"),
      storeContactInput: document.getElementById("store-contact-input"),
      storeTaglineInput: document.getElementById("store-tagline-input"),
      storeLogoInput: document.getElementById("store-logo-input"),
      storeLogoPreview: document.getElementById("store-logo-preview"),
      storeUsePagerCheckbox: document.getElementById("store-use-pager-checkbox"),
      storePagerCountWrap: document.getElementById("store-pager-count-wrap"),
      storePagerCountInput: document.getElementById("store-pager-count-input"),
      btnSaveStoreSettings: document.getElementById("btn-save-store-settings")
    };

    if (this.initialized) return;
    this.initialized = true;

    // Toggle buzzer count input visibility based on checkbox state
    if (this.elements.storeUsePagerCheckbox) {
      this.elements.storeUsePagerCheckbox.onchange = () => {
        const isEnabled = this.elements.storeUsePagerCheckbox.checked;
        if (this.elements.storePagerCountWrap) {
          this.elements.storePagerCountWrap.classList.toggle("hidden", !isEnabled);
        }
      };
    }

    // Store Logo File Reader & Preview Handler
    if (this.elements.storeLogoInput) {
      this.elements.storeLogoInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            this.currentStoreLogoBase64 = evt.target.result;
            if (this.elements.storeLogoPreview) {
              this.elements.storeLogoPreview.src = this.currentStoreLogoBase64;
              this.elements.storeLogoPreview.classList.remove("hidden");
            }
          };
          reader.readAsDataURL(file);
        }
      };
    }

    // Save Store Profile Settings Trigger
    if (this.elements.btnSaveStoreSettings) {
      this.elements.btnSaveStoreSettings.onclick = async () => {
        const storeName = this.elements.storeNameInput ? this.elements.storeNameInput.value.trim() || "LOKALEX STORE" : "LOKALEX STORE";
        const companyName = this.elements.storeCompanyInput ? this.elements.storeCompanyInput.value.trim() : "";
        const address = this.elements.storeAddressInput ? this.elements.storeAddressInput.value.trim() : "";
        const contactNumber = this.elements.storeContactInput ? this.elements.storeContactInput.value.trim() : "";
        const tagline = this.elements.storeTaglineInput ? this.elements.storeTaglineInput.value.trim() : "";
        const useNumberPager = this.elements.storeUsePagerCheckbox ? Boolean(this.elements.storeUsePagerCheckbox.checked) : false;
        const pagerCount = this.elements.storePagerCountInput ? Math.max(1, parseInt(this.elements.storePagerCountInput.value, 10) || 24) : 24;

        const payload = {
          storeName,
          companyName,
          address,
          contactNumber,
          tagline,
          logoBase64: this.currentStoreLogoBase64 || "",
          useNumberPager,
          pagerCount
        };

        await DB.saveStoreSettings(payload);
        alert("Store Profile & Pager settings saved. Receipts will now reflect these details.");
      };
    }
  },

  /**
   * Loads persisted store settings from IndexedDB into form fields
   */
  async loadStoreSettings() {
    const settings = await DB.getStoreSettings();

    if (this.elements.storeNameInput) this.elements.storeNameInput.value = settings.storeName || "";
    if (this.elements.storeCompanyInput) this.elements.storeCompanyInput.value = settings.companyName || "";
    if (this.elements.storeAddressInput) this.elements.storeAddressInput.value = settings.address || "";
    if (this.elements.storeContactInput) this.elements.storeContactInput.value = settings.contactNumber || "";
    if (this.elements.storeTaglineInput) this.elements.storeTaglineInput.value = settings.tagline || "";

    const isPagerEnabled = Boolean(settings.useNumberPager);
    if (this.elements.storeUsePagerCheckbox) {
      this.elements.storeUsePagerCheckbox.checked = isPagerEnabled;
    }
    if (this.elements.storePagerCountWrap) {
      this.elements.storePagerCountWrap.classList.toggle("hidden", !isPagerEnabled);
    }
    if (this.elements.storePagerCountInput) {
      this.elements.storePagerCountInput.value = settings.pagerCount !== undefined ? settings.pagerCount : 24;
    }

    this.currentStoreLogoBase64 = settings.logoBase64 || "";
    if (this.elements.storeLogoPreview) {
      if (settings.logoBase64) {
        this.elements.storeLogoPreview.src = settings.logoBase64;
        this.elements.storeLogoPreview.classList.remove("hidden");
      } else {
        this.elements.storeLogoPreview.classList.add("hidden");
      }
    }
  }
};

// REMARK: ADMIN_STORE_JS_PAGER_FEATURE_COMPLETE