/**
 * @module dsh-websearch/util/log
 *
 * Emit a structured "search/backend-request" event onto the current session,
 * so debugging / token-cost attribution is possible from the dsh session log.
 * Mirrors the official dsh-web-search-deepseek `recordRequest` pattern but
 * is per-backend (each backend records its own endpoint + body so it is
 * auditable which backend fired which request).
 *
 * Resilient to missing agents plane — if the session ledger is unavailable,
 * the call silently no-ops (we MUST NOT break search just because we can't
 * record an audit row).
 */

/**
 * Record one backend request to the current session's event ledger.
 *
 * @param {object} ctx - the Cordis plugin context (`ctx.get("agents")`).
 * @param {string} backendId - e.g. "exa" / "parallel" / "ddg" / "deepseek" / "anthropic" / "openai".
 * @param {object} request - { endpoint, toolName, body, headers? } — headers are
 *   filtered by the caller (do not pass Authorization/x-api-key here).
 */
export function recordBackendRequest(ctx, backendId, request) {
  try {
    const agents = ctx.get?.("agents");
    const initiator = agents?.currentInitiator?.();
    const session = initiator?.session;
    if (session?.append) {
      session.append("web/unified-search-backend-request", { backendId, ...request });
    }
  } catch {
    // audit logging is best-effort; never fatal
  }
}

/**
 * Record a backend's final outcome (number of sources returned / error message).
 * Pairs with recordBackendRequest; useful for token-cost attribution.
 */
export function recordBackendOutcome(ctx, backendId, outcome) {
  try {
    const agents = ctx.get?.("agents");
    const initiator = agents?.currentInitiator?.();
    const session = initiator?.session;
    if (session?.append) {
      session.append("web/unified-search-backend-outcome", { backendId, ...outcome });
    }
  } catch {
    // best-effort
  }
}
