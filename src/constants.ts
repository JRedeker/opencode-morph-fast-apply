/**
 * Canonical marker string used for lazy edit placeholders.
 */
export const EXISTING_CODE_MARKER = "// ... existing code ...";

/**
 * Agents that are blocked from using morph_edit by default.
 * Users can override by setting MORPH_ALLOW_READONLY_AGENTS=true.
 */
export const READONLY_AGENTS = ["plan", "explore"];

/**
 * Whether readonly agents are permitted to use morph_edit.
 */
export const ALLOW_READONLY_AGENTS =
  process.env.MORPH_ALLOW_READONLY_AGENTS === "true";

/** Plugin version */
export const PLUGIN_VERSION = "1.10.1";

// Get API key from the OpenCode/plugin process environment.
export const MORPH_API_KEY = process.env.MORPH_API_KEY;
export const MORPH_API_URL = process.env.MORPH_API_URL || "https://api.morphllm.com";
export const MORPH_MODEL = process.env.MORPH_MODEL || "morph-v3-fast";
export const MORPH_TIMEOUT = parseInt(process.env.MORPH_TIMEOUT || "30000", 10);
