/**
 * Module Description: POS Application Legacy Entrypoint Bridge & Facade Proxy
 * Preserves backward compatibility for build tooling, test suites, or HTML tags
 * referencing index.js. Delegates execution directly to the modular main.js
 * orchestrator and exposes all facade services.
 */
import "./main.js";
export * from "./facade.js";

// REMARK: INDEX_JS_LEGACY_BRIDGE_STANDARDIZED