/**
 * Module Description: Active Staff Session Management Subsystem
 * Tracks, persists, and broadcasts the currently authenticated employee
 * identity and role permissions (Cashier vs Manager/Admin). Provides null-safe
 * getters and emits real-time domain events across the decoupled event bus.
 */

import { Bus } from "./bus.js";

export const Session = {
  activeUser: null,

  /**
   * Sets the authenticated staff user and broadcasts the state change
   * @param {Object|null} user - Authenticated user entity { id, name, role, pin, badge }
   */
  set(user) {
    this.activeUser = user ? { ...user } : null;
    Bus.emit("session:changed", this.activeUser);
  },

  /**
   * Clears active employee state and broadcasts terminal lock/sign-out
   */
  clear() {
    this.activeUser = null;
    Bus.emit("session:changed", null);
  },

  /**
   * Returns a copy of current active user object or null
   * @returns {Object|null}
   */
  get() {
    return this.activeUser ? { ...this.activeUser } : null;
  },

  /**
   * Verifies whether an authenticated staff member is currently logged in
   * @returns {boolean}
   */
  isAuthenticated() {
    return this.activeUser !== null;
  },

  /**
   * Evaluates if active user has administrative or managerial privileges
   * @returns {boolean}
   */
  isAdmin() {
    if (!this.activeUser || !this.activeUser.role) return false;
    const role = String(this.activeUser.role).toLowerCase();
    return role === "admin" || role === "manager";
  },

  /**
   * Safely returns active user's display name or fallback
   * @returns {string}
   */
  getUserName() {
    return this.activeUser && this.activeUser.name ? this.activeUser.name : "Not Signed In";
  },

  /**
   * Safely returns active user ID or fallback
   * @returns {string|number|null}
   */
  getUserId() {
    return this.activeUser && this.activeUser.id ? this.activeUser.id : null;
  },

  /**
   * Safely returns active role description
   * @returns {string}
   */
  getRole() {
    return this.activeUser && this.activeUser.role ? this.activeUser.role.toUpperCase() : "NONE";
  }
};

// REMARK: SESSION_JS_MODULARIZATION_COMPLETE