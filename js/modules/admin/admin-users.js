/**
 * Module Description: Admin Staff & Users Sub-Module
 * Manages employee account records, numeric security PIN authentication,
 * administrative security role assignments, and HTML5 Canvas 2D composite QR login badge
 * generation and PNG export.
 */

import { DB } from "../db.js";
import { Session } from "../session.js";

export const AdminUsers = {
  elements: {},
  callbacks: {},
  currentBadgeUser: null,
  initialized: false,

  /**
   * Initializes DOM selections and binds user form & QR badge triggers
   * @param {Object} callbacks - External hooks
   */
  init(callbacks = {}) {
    this.callbacks = callbacks;

    this.elements = {
      usersAdminTbody: document.getElementById("users-admin-tbody"),
      btnAddNewUser: document.getElementById("btn-add-new-user"),
      modalUserForm: document.getElementById("modal-user-form"),
      userModalTitle: document.getElementById("user-modal-title"),
      editUserId: document.getElementById("edit-user-id"),
      userNameInput: document.getElementById("user-name-input"),
      userRoleSelect: document.getElementById("user-role-select"),
      userPinInput: document.getElementById("user-pin-input"),
      userBadgeInput: document.getElementById("user-badge-input"),
      btnCancelUser: document.getElementById("btn-cancel-user"),
      btnSaveUser: document.getElementById("btn-save-user"),

      // Staff QR Badge Modal Elements
      modalStaffQr: document.getElementById("modal-staff-qr"),
      btnCloseStaffQr: document.getElementById("btn-close-staff-qr"),
      btnDismissStaffQr: document.getElementById("btn-dismiss-staff-qr"),
      btnDownloadStaffQr: document.getElementById("btn-download-staff-qr"),
      staffQrCanvas: document.getElementById("staff-qr-canvas")
    };

    if (this.initialized) return;
    this.initialized = true;

    if (this.elements.btnAddNewUser) {
      this.elements.btnAddNewUser.onclick = () => this.openUserEditor(null);
    }

    if (this.elements.btnCancelUser) {
      this.elements.btnCancelUser.onclick = () => {
        if (this.elements.modalUserForm && this.elements.modalUserForm.open) {
          this.elements.modalUserForm.close();
        }
      };
    }

    if (this.elements.btnCloseStaffQr) {
      this.elements.btnCloseStaffQr.onclick = () => {
        if (this.elements.modalStaffQr && this.elements.modalStaffQr.open) {
          this.elements.modalStaffQr.close();
        }
      };
    }

    if (this.elements.btnDismissStaffQr) {
      this.elements.btnDismissStaffQr.onclick = () => {
        if (this.elements.modalStaffQr && this.elements.modalStaffQr.open) {
          this.elements.modalStaffQr.close();
        }
      };
    }

    if (this.elements.btnDownloadStaffQr) {
      this.elements.btnDownloadStaffQr.onclick = () => {
        this.downloadStaffBadge();
      };
    }

    if (this.elements.btnSaveUser) {
      this.elements.btnSaveUser.onclick = async () => {
        const name = this.elements.userNameInput ? this.elements.userNameInput.value.trim() : "";
        const pin = this.elements.userPinInput ? this.elements.userPinInput.value.trim() : "";
        const role = this.elements.userRoleSelect ? this.elements.userRoleSelect.value : "user";
        const badgeCode = this.elements.userBadgeInput ? this.elements.userBadgeInput.value.trim() : "";
        const id = this.elements.editUserId ? this.elements.editUserId.value : "";

        if (!name || pin.length < 4) {
          alert("Please provide a name and a numeric PIN with at least 4 digits.");
          return;
        }

        const payload = {
          name,
          pin,
          role,
          badgeCode: badgeCode || `STAFF-${pin}`
        };

        if (id) {
          await DB.updateUser(id, payload);
          const activeUser = Session.get();
          if (activeUser && activeUser.id === id) {
            Session.set({ ...activeUser, ...payload });
            const cashierBadge = document.getElementById("txt-active-cashier");
            if (cashierBadge) {
              cashierBadge.textContent = `${name} (${role.toUpperCase()})`;
            }
          }
        } else {
          await DB.addUser(payload);
        }

        if (this.elements.modalUserForm && this.elements.modalUserForm.open) {
          this.elements.modalUserForm.close();
        }

        await this.loadAdminUsers();
      };
    }
  },

  /**
   * Loads user table records from IndexedDB
   */
  async loadAdminUsers() {
    if (!this.elements.usersAdminTbody) return;

    const users = await DB.getUsers();
    this.elements.usersAdminTbody.innerHTML = users.map((u) => `
      <tr>
        <td><b>${u.id}</b></td>
        <td>${u.name}</td>
        <td><span class="badge ${u.role === "admin" || u.role === "manager" ? "badge-admin" : ""}">${u.role.toUpperCase()}</span></td>
        <td><code>••••</code></td>
        <td>${u.badgeCode || "N/A"}</td>
        <td class="text-center">
          <button type="button" class="btn-action-sm btn-action-qr btn-badge-user" data-id="${u.id}">QR Badge</button>
          <button type="button" class="btn-action-sm btn-edit-user" data-id="${u.id}">Edit</button>
          <button type="button" class="btn-action-sm btn-action-del btn-del-user" data-id="${u.id}">Remove</button>
        </td>
      </tr>
    `).join("");

    this.elements.usersAdminTbody.querySelectorAll(".btn-badge-user").forEach((btn) => {
      btn.onclick = async () => {
        const user = await DB.getUserById(btn.dataset.id);
        if (user) {
          await this.openStaffQrBadgeModal(user);
        }
      };
    });

    this.elements.usersAdminTbody.querySelectorAll(".btn-edit-user").forEach((btn) => {
      btn.onclick = async () => {
        const user = await DB.getUserById(btn.dataset.id);
        if (user) this.openUserEditor(user);
      };
    });

    this.elements.usersAdminTbody.querySelectorAll(".btn-del-user").forEach((btn) => {
      btn.onclick = async () => {
        const activeUser = Session.get();
        if (activeUser && activeUser.id === btn.dataset.id) {
          alert("You cannot remove the currently signed-in account.");
          return;
        }
        if (confirm("Are you sure you want to delete this staff user?")) {
          await DB.deleteUser(btn.dataset.id);
          await this.loadAdminUsers();
        }
      };
    });
  },

  /**
   * Opens user editor modal
   * @param {Object|null} user - Existing user entity or null for new
   */
  openUserEditor(user = null) {
    if (user) {
      if (this.elements.userModalTitle) this.elements.userModalTitle.textContent = "Edit Staff User";
      if (this.elements.editUserId) this.elements.editUserId.value = user.id;
      if (this.elements.userNameInput) this.elements.userNameInput.value = user.name || "";
      if (this.elements.userRoleSelect) {
        this.elements.userRoleSelect.value = (user.role === "admin" || user.role === "manager") ? "admin" : "user";
      }
      if (this.elements.userPinInput) this.elements.userPinInput.value = user.pin || "";
      if (this.elements.userBadgeInput) this.elements.userBadgeInput.value = user.badgeCode || "";
    } else {
      if (this.elements.userModalTitle) this.elements.userModalTitle.textContent = "Create New Staff User";
      if (this.elements.editUserId) this.elements.editUserId.value = "";
      if (this.elements.userNameInput) this.elements.userNameInput.value = "";
      if (this.elements.userPinInput) this.elements.userPinInput.value = "";
      if (this.elements.userBadgeInput) this.elements.userBadgeInput.value = "";
      if (this.elements.userRoleSelect) this.elements.userRoleSelect.value = "user";
    }

    if (this.elements.modalUserForm && typeof this.elements.modalUserForm.showModal === "function") {
      this.elements.modalUserForm.showModal();
    }
  },

  /**
   * Opens the staff QR identification badge preview modal
   * @param {Object} user - Target staff member
   */
  async openStaffQrBadgeModal(user) {
    this.currentBadgeUser = user;
    await this.renderStaffBadgeCanvas(user);

    if (this.elements.modalStaffQr && typeof this.elements.modalStaffQr.showModal === "function") {
      this.elements.modalStaffQr.showModal();
    }
  },

  /**
   * Renders a 340x380 composite employee ID badge onto an HTML5 canvas
   * @param {Object} user - Target staff member
   */
  async renderStaffBadgeCanvas(user) {
    const canvas = this.elements.staffQrCanvas;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const width = 340;
    const height = 380;
    canvas.width = width;
    canvas.height = height;

    // Card background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Accent security header stripe
    ctx.fillStyle = (user.role === "admin" || user.role === "manager") ? "#d97706" : "#2563eb";
    ctx.fillRect(0, 0, width, 8);

    // Card Header Text
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("STAFF IDENTIFICATION & LOGIN BADGE", width / 2, 30);

    // Offscreen QR Code generation via QRCode.js
    const tempDiv = document.createElement("div");
    const qrPayload = user.badgeCode ? user.badgeCode.trim() : (user.pin ? user.pin.trim() : user.id);

    if (window.QRCode) {
      new window.QRCode(tempDiv, {
        text: qrPayload,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: 2
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 60));

    const qrSize = 200;
    const qrX = (width - qrSize) / 2;
    const qrY = 46;

    // QR Border Reticle
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.strokeRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12);

    const qrCanvas = tempDiv.querySelector("canvas");
    if (qrCanvas) {
      ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);
    } else {
      const qrImg = tempDiv.querySelector("img");
      if (qrImg && qrImg.src) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
            resolve();
          };
          img.src = qrImg.src;
        });
      }
    }

    // Staff Name
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(user.name || "Staff Member", width / 2, 290);

    // Role Badge Pill
    const isManager = (user.role === "admin" || user.role === "manager");
    const roleText = isManager ? "ADMINISTRATOR" : "CASHIER / STAFF";

    ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const textMetrics = ctx.measureText(roleText);
    const pillWidth = textMetrics.width + 24;
    const pillHeight = 24;
    const pillX = (width - pillWidth) / 2;
    const pillY = 306;

    ctx.fillStyle = isManager ? "#fef3c7" : "#dcfce7";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 12);
    } else {
      ctx.rect(pillX, pillY, pillWidth, pillHeight);
    }
    ctx.fill();

    ctx.fillStyle = isManager ? "#92400e" : "#166534";
    ctx.fillText(roleText, width / 2, pillY + 16);

    // Footer Hint
    ctx.fillStyle = "#64748b";
    ctx.font = "italic 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("Point this QR to the POS terminal camera to sign in", width / 2, 356);
  },

  /**
   * Triggers PNG image download of the rendered staff badge
   */
  downloadStaffBadge() {
    if (!this.elements.staffQrCanvas || !this.currentBadgeUser) return;
    const canvas = this.elements.staffQrCanvas;
    const user = this.currentBadgeUser;

    const dataUrl = canvas.toDataURL("image/png");
    const sanitizedName = (user.name || "staff").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const filename = `staff_qr_${sanitizedName}_${user.role || "user"}.png`;

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

// REMARK: ADMIN_USERS_JS_MODULARIZATION_COMPLETE