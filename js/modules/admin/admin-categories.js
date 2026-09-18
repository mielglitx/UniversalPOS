/**
 * Module Description: Admin Product Categories Sub-Module
 * Manages Category CRUD operations, sort order assignments, automated alphabetical
 * sorting (A–Z), hybrid drag-and-drop manual re-ordering (supporting desktop mouse
 * dragging and mobile WebView touch gestures via touchstart/touchmove/touchend),
 * tactile Up/Down button swapping, sequential index normalization (1..N),
 * Quick Menu Add-on shelf classifications, and root category protection rules.
 */

import { DB } from "../db.js";
import { Bus } from "../bus.js";

const FALLBACK_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2394a3b8'><path d='M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'/></svg>";

export const AdminCategories = {
  elements: {},
  callbacks: {},
  currentCategoryImageBase64: "",
  draggedRow: null,
  touchDraggedRow: null,
  initialized: false,

  /**
   * Initializes DOM selections and binds category form, sorting, and drag-and-drop events
   * @param {Object} callbacks - External hooks
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    this.elements = {
      categoriesAdminTbody: document.getElementById("categories-admin-tbody"),
      btnAddNewCategory: document.getElementById("btn-add-new-category"),
      btnAutoSortCategories: document.getElementById("btn-auto-sort-categories"),
      btnNormalizeCategoryOrders: document.getElementById("btn-normalize-category-orders"),
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

    // Open category creation editor
    if (this.elements.btnAddNewCategory) {
      this.elements.btnAddNewCategory.onclick = () => this.openCategoryEditor(null);
    }

    // Auto-sort categories alphabetically (A-Z)
    if (this.elements.btnAutoSortCategories) {
      this.elements.btnAutoSortCategories.onclick = async () => {
        await this.autoSortByName();
      };
    }

    // Re-index category orders sequentially (1, 2, 3...)
    if (this.elements.btnNormalizeCategoryOrders) {
      this.elements.btnNormalizeCategoryOrders.onclick = async () => {
        await this.normalizeOrders();
      };
    }

    // Cancel / Close editor modal
    if (this.elements.btnCancelCategory) {
      this.elements.btnCancelCategory.onclick = () => {
        if (this.elements.modalCategoryForm && this.elements.modalCategoryForm.open) {
          this.elements.modalCategoryForm.close();
        }
      };
    }

    // Category Icon File Reader & Preview Handler
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

    // Save Category Trigger
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
   * Loads category rows from IndexedDB into table with drag handles and manual controls
   */
  async loadAdminCategories() {
    if (!this.elements.categoriesAdminTbody) return;

    const categories = await DB.getCategories();
    const total = categories.length;

    this.elements.categoriesAdminTbody.innerHTML = categories.map((cat, index) => {
      const isRoot = cat.id === "all";
      const isFirstMovable = index <= 1; // Index 0 is 'all'
      const isLastMovable = index === total - 1;

      const typeBadge = cat.isAddon 
        ? `<span class="badge badge-addon">⚡ ADD-ON</span>`
        : `<span class="badge badge-unmonitored">REGULAR</span>`;

      const dragHandleHtml = isRoot
        ? `<span class="drag-handle-disabled" title="Root category position is fixed">🔒</span>`
        : `<span class="drag-handle" draggable="true" title="Drag to re-order category">⠿</span>`;

      const orderControls = isRoot
        ? `<span class="cat-order-fixed">📌 Root (#1)</span>`
        : `
          <div class="cat-order-btn-group">
            <span class="cat-order-pill">#${cat.order}</span>
            <button type="button" class="btn-order-move btn-order-up" data-id="${cat.id}" title="Move Up" ${isFirstMovable ? "disabled" : ""}>▲</button>
            <button type="button" class="btn-order-move btn-order-down" data-id="${cat.id}" title="Move Down" ${isLastMovable ? "disabled" : ""}>▼</button>
          </div>
        `;

      return `
        <tr data-cat-id="${cat.id}" class="${isRoot ? 'cat-row-root' : 'cat-row-draggable'}" ${!isRoot ? 'draggable="true"' : ''}>
          <td class="drag-handle-cell text-center">${dragHandleHtml}</td>
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
          <td>${orderControls}</td>
          <td>${typeBadge}</td>
          <td class="text-center">
            <button type="button" class="btn-action-sm btn-edit-category" data-id="${cat.id}">Edit</button>
            ${
              !isRoot
                ? `<button type="button" class="btn-action-sm btn-action-del btn-del-category" data-id="${cat.id}">Delete</button>`
                : `<button type="button" class="btn-action-sm" disabled style="opacity:0.4;cursor:not-allowed;">Default</button>`
            }
          </td>
        </tr>
      `;
    }).join("");

    // Bind Edit triggers
    this.elements.categoriesAdminTbody.querySelectorAll(".btn-edit-category").forEach((btn) => {
      btn.onclick = async () => {
        const cat = await DB.getCategoryById(btn.dataset.id);
        if (cat) this.openCategoryEditor(cat);
      };
    });

    // Bind Delete triggers
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

    // Bind Manual Move Up triggers
    this.elements.categoriesAdminTbody.querySelectorAll(".btn-order-up").forEach((btn) => {
      btn.onclick = async () => {
        await this.moveCategory(btn.dataset.id, "up");
      };
    });

    // Bind Manual Move Down triggers
    this.elements.categoriesAdminTbody.querySelectorAll(".btn-order-down").forEach((btn) => {
      btn.onclick = async () => {
        await this.moveCategory(btn.dataset.id, "down");
      };
    });

    // Bind Hybrid Drag and Drop Listeners (HTML5 Desktop + Mobile Touch)
    this.bindDragAndDropEvents();
  },

  /**
   * Binds both desktop HTML5 drag events and mobile touch handlers for reordering rows
   */
  bindDragAndDropEvents() {
    const tbody = this.elements.categoriesAdminTbody;
    if (!tbody) return;

    const rows = tbody.querySelectorAll("tr.cat-row-draggable");

    rows.forEach((row) => {
      // -------------------------------------------------------------
      // 1. DESKTOP HTML5 DRAG & DROP EVENTS
      // -------------------------------------------------------------
      row.ondragstart = (e) => {
        if (row.dataset.catId === "all") {
          e.preventDefault();
          return;
        }
        this.draggedRow = row;
        row.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.dataset.catId);
      };

      row.ondragover = (e) => {
        e.preventDefault();
        if (!this.draggedRow || this.draggedRow === row || row.dataset.catId === "all") {
          return;
        }
        e.dataTransfer.dropEffect = "move";

        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        row.classList.remove("drop-target-above", "drop-target-below");
        if (e.clientY < midY) {
          row.classList.add("drop-target-above");
        } else {
          row.classList.add("drop-target-below");
        }
      };

      row.ondragleave = () => {
        row.classList.remove("drop-target-above", "drop-target-below");
      };

      row.ondrop = async (e) => {
        e.preventDefault();
        const isAbove = row.classList.contains("drop-target-above");
        row.classList.remove("drop-target-above", "drop-target-below");

        if (this.draggedRow && this.draggedRow !== row && row.dataset.catId !== "all") {
          if (isAbove) {
            tbody.insertBefore(this.draggedRow, row);
          } else {
            tbody.insertBefore(this.draggedRow, row.nextSibling);
          }
          await this.persistDomOrderToDatabase();
        }
      };

      row.ondragend = () => {
        row.classList.remove("is-dragging");
        tbody.querySelectorAll("tr").forEach((r) => {
          r.classList.remove("drop-target-above", "drop-target-below", "is-dragging");
        });
        this.draggedRow = null;
      };

      // -------------------------------------------------------------
      // 2. MOBILE & TABLET TOUCH GESTURE REORDERING (WEBVIEW SUPPORT)
      // -------------------------------------------------------------
      const handle = row.querySelector(".drag-handle");
      if (handle) {
        handle.ontouchstart = (e) => {
          if (row.dataset.catId === "all") return;
          this.touchDraggedRow = row;
          row.classList.add("is-dragging");
        };

        handle.ontouchmove = (e) => {
          if (!this.touchDraggedRow) return;
          e.preventDefault(); // Prevent scrolling while actively dragging

          const touch = e.touches[0];
          const elem = document.elementFromPoint(touch.clientX, touch.clientY);
          const targetTr = elem ? elem.closest("tr[data-cat-id]") : null;

          tbody.querySelectorAll("tr").forEach((r) => {
            if (r !== targetTr) {
              r.classList.remove("drop-target-above", "drop-target-below");
            }
          });

          if (targetTr && targetTr !== this.touchDraggedRow && targetTr.dataset.catId !== "all") {
            const rect = targetTr.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;

            targetTr.classList.remove("drop-target-above", "drop-target-below");
            if (touch.clientY < midY) {
              targetTr.classList.add("drop-target-above");
            } else {
              targetTr.classList.add("drop-target-below");
            }
          }
        };

        handle.ontouchend = async () => {
          if (!this.touchDraggedRow) return;

          const targetAbove = tbody.querySelector(".drop-target-above");
          const targetBelow = tbody.querySelector(".drop-target-below");

          if (targetAbove && targetAbove !== this.touchDraggedRow && targetAbove.dataset.catId !== "all") {
            tbody.insertBefore(this.touchDraggedRow, targetAbove);
          } else if (targetBelow && targetBelow !== this.touchDraggedRow && targetBelow.dataset.catId !== "all") {
            tbody.insertBefore(this.touchDraggedRow, targetBelow.nextSibling);
          }

          tbody.querySelectorAll("tr").forEach((r) => {
            r.classList.remove("drop-target-above", "drop-target-below", "is-dragging");
          });

          this.touchDraggedRow = null;
          await this.persistDomOrderToDatabase();
        };

        handle.ontouchcancel = () => {
          tbody.querySelectorAll("tr").forEach((r) => {
            r.classList.remove("drop-target-above", "drop-target-below", "is-dragging");
          });
          this.touchDraggedRow = null;
        };
      }
    });
  },

  /**
   * Reads the current physical DOM order of table rows and commits sequential indices to IndexedDB
   */
  async persistDomOrderToDatabase() {
    const tbody = this.elements.categoriesAdminTbody;
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll("tr[data-cat-id]"));
    const updatePayload = [];

    // Root 'all' category is guaranteed to be rank 1
    let nextOrder = 1;
    for (const r of rows) {
      const catId = r.dataset.catId;
      if (catId) {
        updatePayload.push({
          id: catId,
          order: nextOrder++
        });
      }
    }

    await DB.updateCategoryOrders(updatePayload);
    await this.loadAdminCategories();
    Bus.emit("catalog:addons-updated");

    if (typeof this.callbacks.onCategoriesModified === "function") {
      this.callbacks.onCategoriesModified();
    }
  },

  /**
   * Manually shifts a category up or down by swapping order with its adjacent sibling
   * @param {string} categoryId
   * @param {'up'|'down'} direction
   */
  async moveCategory(categoryId, direction) {
    if (!categoryId || categoryId === "all") return;

    const categories = await DB.getCategories();
    const currentIndex = categories.findIndex((c) => c.id === categoryId);
    if (currentIndex === -1) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    // Guard bounds: never move above index 0 ('all' category is always index 0)
    if (targetIndex < 1 || targetIndex >= categories.length) return;

    const currentCat = categories[currentIndex];
    const targetCat = categories[targetIndex];

    // Swap order values cleanly
    const tempOrder = currentCat.order;
    currentCat.order = targetCat.order;
    targetCat.order = tempOrder;

    // If both orders happened to be identical, normalize them explicitly
    if (currentCat.order === targetCat.order) {
      if (direction === "up") {
        currentCat.order = Math.max(1, targetCat.order - 1);
      } else {
        currentCat.order = targetCat.order + 1;
      }
    }

    await DB.updateCategoryOrders([
      { id: currentCat.id, order: currentCat.order },
      { id: targetCat.id, order: targetCat.order }
    ]);

    await this.loadAdminCategories();
    Bus.emit("catalog:addons-updated");

    if (typeof this.callbacks.onCategoriesModified === "function") {
      this.callbacks.onCategoriesModified();
    }
  },

  /**
   * Automatically sorts non-root categories alphabetically (A-Z) and re-indexes them sequentially
   */
  async autoSortByName() {
    const categories = await DB.getCategories();
    if (categories.length <= 2) return;

    const rootCat = categories.find((c) => c.id === "all");
    const otherCats = categories.filter((c) => c.id !== "all");

    // Sort alphabetically by category name
    otherCats.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }));

    const updatePayload = [];
    if (rootCat) {
      updatePayload.push({ id: rootCat.id, order: 1 });
    }

    let nextOrder = 2;
    for (const cat of otherCats) {
      updatePayload.push({ id: cat.id, order: nextOrder++ });
    }

    await DB.updateCategoryOrders(updatePayload);
    await this.loadAdminCategories();
    Bus.emit("catalog:addons-updated");

    if (typeof this.callbacks.onCategoriesModified === "function") {
      this.callbacks.onCategoriesModified();
    }

    alert("Categories auto-sorted alphabetically (A–Z).");
  },

  /**
   * Normalizes category orders to consecutive sequential numbers (1, 2, 3...)
   */
  async normalizeOrders() {
    const categories = await DB.getCategories();
    if (categories.length === 0) return;

    const updatePayload = categories.map((cat, idx) => ({
      id: cat.id,
      order: idx + 1
    }));

    await DB.updateCategoryOrders(updatePayload);
    await this.loadAdminCategories();
    Bus.emit("catalog:addons-updated");

    if (typeof this.callbacks.onCategoriesModified === "function") {
      this.callbacks.onCategoriesModified();
    }

    alert("Category orders normalized to sequential indices (1..N).");
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

// REMARK: ADMIN_CATEGORIES_JS_DRAG_DROP_COMPLETE