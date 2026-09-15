/**
 * Module Description: Register Visual Theme Controller
 * Manages active styling modes (Basic High-Contrast Industrial vs Modern Rounded Elevation).
 * Persists theme choice to localStorage, synchronizes data-theme attributes on the document
 * body, and updates active button states across terminal controls.
 */

export const Theme = {
  current: localStorage.getItem("pos_theme") || "modern",

  /**
   * Applies the requested theme, updates document attributes, and saves preference
   * @param {string} name - Theme name ('basic' or 'modern')
   */
  set(name) {
    this.current = name;
    document.body.setAttribute("data-theme", name);
    localStorage.setItem("pos_theme", name);

    // Synchronize active class on theme switcher buttons
    document.querySelectorAll(".btn-theme").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === name);
    });
  },

  /**
   * Initializes visual theme state on application startup
   */
  init() {
    this.set(this.current);
  }
};

// REMARK: THEME_JS_MODULARIZATION_COMPLETE