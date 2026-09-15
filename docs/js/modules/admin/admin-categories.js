/**
 * Module Description: Admin Product Categories Sub-Module
 * Manages Category CRUD operations, sort order assignments, Quick Menu Add-on
 * shelf classifications, root category protection rules, and category icon uploads.
 */

import { DB } from "../db.js";
import { Bus } from "../bus.js";

const FALLBACK_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2394a3b8'><path d='M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'/></svg>";

export const AdminCategories = {
  elements: {},
  callbacks: {},
  currentCategoryImageBase64: "",
  initialized: false,

  /**
   * Initializes DOM selections and binds category form events
   * @param {Object} callbacks - External hooks
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    this.elements = {
      categoriesAdminTbody: document.getElementById("categories-admin-tbody"),
      btnAddNewCategory: document.getElementById("btn-add-new-category"),
      modalCategoryForm: document.getElementById("modal-category-form"),
      categoryModalTitle: document.getElementById("category-modal-title"),
      editCategoryId: document.getElementById("edit-category-id"),
      catNameInput: document.getElementById("cat-name-input"),
      catOrderInput: document.getElementById("cat-order-input"),
      catAddonCheckbox: document.getElementById("cat-addon-checkbox"),
      catPicInput: document.getElementById("cat-pic-input"),
      catPicPreview: document.getElementById("cat-pic-preview"),
      btnCancelCategory: document.getElementById("btn-cancel-category"),
      btnSaveCategory: document.getElementById("btn-save-category")
    };

    if (this.initialized) return;
    this.initialized = true;

    if (this.elements.btnAddNewCategory) {
      this.elements.btnAddNewCategory.onclick = () => this.openCategoryEditor(null);
    }

    if (this.elements.btnCancelCategory) {
      this.elements.btnCancelCategory.onclick = () => {
        if (this.elements.modalCategoryForm && this.elements.modalCategoryForm.open) {
          this.elements.modalCategoryForm.close();
        }
      };
    }

    if (this.elements.catPicInput) {
      this.elements.catPicInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            this.currentCategoryImageBase64 = evt.target.result;
            if (this.elements.catPicPreview) {
              this.elements.catPicPreview.src = this.currentCategoryImageBase64;
              this.elements.catPicPreview.classList.remove("hidden");
            }
          };
          reader.readAsDataURL(file);
        }
      };
    }

    if (this.elements.btnSaveCategory) {
      this.elements.btnSaveCategory.onclick = async () => {
        const name = this.elements.catNameInput.value.trim();
        const order = parseInt(this.elements.catOrderInput.value, 10) || 1;
        const isAddon = this.elements.catAddonCheckbox ? this.elements.catAddonCheckbox.checked : false;
        const id = this.elements.editCategoryId.value;

        if (!name) {
          alert("Please enter a category name.");
          return;
        }

        const payload = {
          name,
          order,
          isAddon,
          image: this.currentCategoryImageBase64 || FALLBACK_IMG
        };

        if (id) {
          await DB.updateCategory(id, payload);
        } else {
          await DB.addCategory(payload);
        }

        if (this.elements.modalCategoryForm && this.elements.modalCategoryForm.open) {
          this.elements.modalCategoryForm.close();
        }

        await this.loadAdminCategories();
        Bus.emit("catalog:addons-updated");

        if (typeof this.callbacks.onCategoriesModified === "function") {
          this.callbacks.onCategoriesModified();
        }
      };
    }
  },

  /**
   * Loads category rows from IndexedDB into table
   */
  async loadAdminCategories() {
    if (!this.elements.categoriesAdminTbody) return;

    const categories = await DB.getCategories();
    this.elements.categoriesAdminTbody.innerHTML = categories.map((cat) => {
      const typeBadge = cat.isAddon 
        ? `<span class="badge badge-addon">⚡ ADD-ON</span>`
        : `<span class="badge badge-unmonitored">REGULAR</span>`;

      return `
        <tr>
          <td>
            <img 
              src="${cat.image || FALLBACK_IMG}" 
              alt="${cat.name || "Category"}" 
              class="admin-table-thumb" 
              onerror="this.onerror=null;this.src='${FALLBACK_IMG}';" 
            />
          </td>
          <td><b>${cat.name || ""}</b></td>
          <td><code>${cat.id}</code></td>
          <td>${cat.order}</td>
          <td>${typeBadge}</td>
          <td class="text-center">
            <button type="button" class="btn-action-sm btn-edit-category" data-id="${cat.id}">Edit</button>
            ${
              cat.id !== "all"
                ? `<button type="button" class="btn-action-sm btn-action-del btn-del-category" data-id="${cat.id}">Delete</button>`
                : `<button type="button" class="btn-action-sm" disabled style="opacity:0.4;cursor:not-allowed;">Default</button>`
            }
          </td>
        </tr>
      `;
    }).join("");

    this.elements.categoriesAdminTbody.querySelectorAll(".btn-edit-category").forEach((btn) => {
      btn.onclick = async () => {
        const cat = await DB.getCategoryById(btn.dataset.id);
        if (cat) this.openCategoryEditor(cat);
      };
    });

    this.elements.categoriesAdminTbody.querySelectorAll(".btn-del-category").forEach((btn) => {
      btn.onclick = async () => {
        if (btn.dataset.id === "all") {
          alert("The root 'All Items' category cannot be deleted.");
          return;
        }
        if (confirm("Are you sure you want to remove this category? Products inside will remain in 'All Items'.")) {
          await DB.deleteCategory(btn.dataset.id);
          await this.loadAdminCategories();
          Bus.emit("catalog:addons-updated");
          if (typeof this.callbacks.onCategoriesModified === "function") {
            this.callbacks.onCategoriesModified();
          }
        }
      };
    });
  },

  /**
   * Opens category editor modal
   * @param {Object|null} category - Existing category entity or null for new
   */
  openCategoryEditor(category = null) {
    if (category) {
      if (this.elements.categoryModalTitle) this.elements.categoryModalTitle.textContent = "Edit Category";
      if (this.elements.editCategoryId) this.elements.editCategoryId.value = category.id;
      if (this.elements.catNameInput) this.elements.catNameInput.value = category.name || "";
      if (this.elements.catOrderInput) this.elements.catOrderInput.value = category.order || 1;
      if (this.elements.catAddonCheckbox) {
        this.elements.catAddonCheckbox.checked = Boolean(category.isAddon);
      }
      this.currentCategoryImageBase64 = category.image || "";

      if (this.elements.catPicPreview) {
        if (category.image) {
          this.elements.catPicPreview.src = category.image;
          this.elements.catPicPreview.classList.remove("hidden");
        } else {
          this.elements.catPicPreview.classList.add("hidden");
        }
      }
    } else {
      if (this.elements.categoryModalTitle) this.elements.categoryModalTitle.textContent = "Add New Category";
      if (this.elements.editCategoryId) this.elements.editCategoryId.value = "";
      if (this.elements.catNameInput) this.elements.catNameInput.value = "";
      if (this.elements.catOrderInput) this.elements.catOrderInput.value = 5;
      if (this.elements.catAddonCheckbox) this.elements.catAddonCheckbox.checked = false;
      this.currentCategoryImageBase64 = "";
      if (this.elements.catPicInput) this.elements.catPicInput.value = "";
      if (this.elements.catPicPreview) this.elements.catPicPreview.classList.add("hidden");
    }

    if (this.elements.modalCategoryForm && typeof this.elements.modalCategoryForm.showModal === "function") {
      this.elements.modalCategoryForm.showModal();
    }
  }
};

// REMARK: ADMIN_CATEGORIES_JS_MODULARIZATION_COMPLETE