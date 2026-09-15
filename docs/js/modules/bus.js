/**
 * Module Description: Application-wide Pub/Sub Event Bus
 * Provides an isolated, decoupled Publish/Subscribe event dispatching
 * mechanism across all POS micro-modules. Eliminates tight coupling,
 * supports safe unsubscription callbacks, and shields listeners with
 * defensive iteration and localized exception boundaries.
 */

const registry = new Map();

export const Bus = {
  /**
   * Subscribes a listener callback to a specific domain event
   * @param {string} event - Event name identifier
   * @param {Function} handler - Callback function invoked on dispatch
   * @returns {Function} Unsubscribe closure
   */
  on(event, handler) {
    if (!registry.has(event)) {
      registry.set(event, new Set());
    }
    registry.get(event).add(handler);
    return () => this.off(event, handler);
  },

  /**
   * Removes a subscribed listener callback from a domain event
   * @param {string} event - Event name identifier
   * @param {Function} handler - Registered callback reference
   */
  off(event, handler) {
    if (registry.has(event)) {
      registry.get(event).delete(handler);
      if (registry.get(event).size === 0) {
        registry.delete(event);
      }
    }
  },

  /**
   * Broadcasts a domain event and payload to all registered listeners
   * @param {string} event - Event name identifier
   * @param {*} payload - Data object passed to subscribers
   */
  emit(event, payload) {
    if (registry.has(event)) {
      // Create defensive snapshot array to prevent mutation issues during emission
      const handlers = [...registry.get(event)];
      handlers.forEach((handler) => {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[Bus Error] Exception in handler for "${event}":`, err);
        }
      });
    }
  },

  /**
   * Clears all registered events or handlers for testing and resets
   */
  clear() {
    registry.clear();
  }
};

// REMARK: BUS_JS_MODULARIZATION_COMPLETE