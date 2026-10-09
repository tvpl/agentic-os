/**
 * @mordomo/contracts — what crosses the engine / API / UI boundary.
 * Depends on zod only; safe to import from the browser.
 */
export * from "./settings.js";
export * from "./preferences.js";
export * from "./policy.js";
export * from "./runs.js";
export * from "./records.js";
export * from "./events.js";
// Door 1 of adaptadores-tipados: the two stream schemas (and their types), the session id they constrain and the type names they know; the pieces stay module-internal.
export { ClaudeStreamMessage, CodexStreamEvent, KnownStreamTypes, SessionId } from "./providerStreams.js";
