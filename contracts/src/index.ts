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
// Door 1 of contratos-rest: the route table and what it is checked with; the shapes it describes move here from the core.
export * from "./api/index.js";
export * from "./routines.js";
export * from "./skills.js";
export * from "./connectors.js";
// Door 3 and 4: the registry of event types and versions (also at `./events`, without zod) and the schemas of the events.
export * from "./eventRegistry.js";
export * from "./eventSchemas.js";
