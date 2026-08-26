/**
 * @module dsh-websearch/util/log
 *
 * Per-backend request/outcome diagnostics.
 *
 * IMPORTANT: these intentionally go to the HOST logger (ctx.logger), NOT to
 * the session ledger. The session event vocabulary is a closed, generated set
 * (@deepseek-ai/dsh-session known-event-types): the persistence read path
 * refuses to interpret ANY session containing an envelope type outside that
 * set unless the ENVELOPE carries ignorable: true -- and the runtime
 * session.append() API provides no way to set that envelope marker (its opts
 * carry only sourceEventSeqs/surfaceOp). A third-party plugin writing custom
 * types therefore poisons the whole session log: writes succeed, the next
 * continue/load refuses. Mirroring the in-repo web/deepseek-search-llm-request
 * pattern is not available to out-of-repo packages by construction.
 *
 * Both emitters are best-effort and never throw: diagnostics must not break
 * search.
 */

/** One-line summary safe for the host log. */
function summarize(request) {
  try {
    const body = request && request.body ? JSON.stringify(request.body) : "";
    const trimmed = body.length > 200 ? body.slice(0, 200) + "..." : body;
    return String((request && request.endpoint) || "") +
      (request && request.toolName ? " tool=" + request.toolName : "") +
      (trimmed ? " body=" + trimmed : "");
  } catch {
    return String(request && request.endpoint);
  }
}

/**
 * Record one backend request to the host log.
 *
 * @param {object} ctx - the Cordis plugin context (ctx.logger).
 * @param {string} backendId - e.g. exa / parallel / brave.
 * @param {object} request - { endpoint, toolName, body } - never includes secrets.
 */
export function recordBackendRequest(ctx, backendId, request) {
  try {
    const logger = ctx && ctx.logger;
    if (!logger || typeof logger.debug !== "function") return;
    logger.debug("[websearch:" + backendId + "] request " + summarize(request));
  } catch {
    // best-effort; never fatal
  }
}

/**
 * Record a backend's final outcome (sources count / error message) to the host log.
 */
export function recordBackendOutcome(ctx, backendId, outcome) {
  try {
    const logger = ctx && ctx.logger;
    if (!logger) return;
    const status = outcome && typeof outcome.status === "string" ? outcome.status : "";
    const line = "[websearch:" + backendId + "] outcome " + JSON.stringify(outcome ?? {}).slice(0, 500);
    if (status === "error" && typeof logger.warn === "function") logger.warn(line);
    else if (typeof logger.debug === "function") logger.debug(line);
  } catch {
    // best-effort
  }
}