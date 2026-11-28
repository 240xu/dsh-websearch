// health.js — read-only health surface for the unified-search plugin.
//
// GET /api/unified-search/health reports which backends are enabled / keyless
// and the LAST per-backend telemetry captured during a real search. It never
// probes anything by itself (quota safety) and never echoes credential
// material: error strings are truncated to 40-120 chars (matching the
// provider's own telemetry truncation) and run through a defensive redaction
// pass for token-like fragments.

import { rejectionFor, rejectionBody } from "./trust.js";

import { sanitizeError as redactError } from "./util/redact.js";

const MAX_ERROR_CHARS = 120;

/**
 * Truncate + redact an error string for safe display.
 * Returns "" for falsy input; length bounded to 40-120 chars.
 */
export function sanitizeError(err) {
  return redactError(err, MAX_ERROR_CHARS);
}

/**
 * Build the health report body (pure — no ctx, no I/O; unit-testable).
 *
 * @param {object} deps
 * @param {Function} deps.resolveOptions  () => resolved options snapshot
 * @param {object} deps.backends          keyed backend registry (BACKENDS)
 * @param {Map|Function} deps.getBackendHealth  telemetry map or () => map
 *   entries: { ok: boolean, at: ms, ms: duration, error?: string,
 *              lastOkAt?: ms|null }
 * @returns {object} JSON-serializable health payload
 */
export function buildHealthReport({ resolveOptions, backends, getBackendHealth }) {
  const opts = resolveOptions();
  const healthMap = typeof getBackendHealth === "function" ? getBackendHealth() : getBackendHealth;
  const tel = healthMap instanceof Map ? healthMap : new Map();
  const nowMs = Date.now();

  const enabledSet = new Set(
    (opts.enabledBackends ?? []).filter((id) => backends[id] !== undefined),
  );

  const list = Object.keys(backends).map((id) => {
    const beOpts = opts.backends?.[id] ?? {};
    const enabled = enabledSet.has(id);
    const keyless = beOpts.requiresKey !== true;
    const t = tel.get(id);
    return {
      id,
      enabled,
      keyless,
      optionalKey: beOpts.optionalKey === true,
      metered: beOpts.metered === true,
      // Observability: expose the breaker classification so callers can tell
      // a quota cooldown from an ordinary outage or a missing key without
      // parsing lastError. Additive fields; existing keys keep their meaning.
      rateLimited: t?.rateLimited === true,
      keylessRejected: t?.keylessRejected === true,
      cooledUntilMs: Number.isFinite(t?.cooledUntil) && t.cooledUntil > nowMs ? t.cooledUntil : null,
      // reachable: true/false from the latest search telemetry; null = never probed.
      reachable: t ? t.ok === true : null,
      credentialMissing: t?.credentialMissing === true,
      lastOk: t && typeof t.lastOkAt === "number" ? t.lastOkAt : null,
      lastError: t && t.ok !== true ? sanitizeError(t.error) || "unknown error" : null,
    };
  });

  // Config-declared custom backends are not in the static registry; report
  // them with the same redacted telemetry keyed by their namespaced id.
  for (const def of opts.customBackends ?? []) {
    const id = "custom:" + def.id;
    const t = tel.get(id);
    list.push({
      id,
      enabled: enabledSet.has(id) || (def.enabled === true && (opts.enabledBackends ?? []).includes(id)),
      keyless: def.authRef === "",
      optionalKey: false,
      metered: false,
      custom: true,
      rateLimited: t?.rateLimited === true,
      keylessRejected: t?.keylessRejected === true,
      cooledUntilMs: Number.isFinite(t?.cooledUntil) && t.cooledUntil > nowMs ? t.cooledUntil : null,
      reachable: t ? t.ok === true : null,
      credentialMissing: t?.credentialMissing === true,
      lastOk: t && typeof t.lastOkAt === "number" ? t.lastOkAt : null,
      lastError: t && t.ok !== true ? sanitizeError(t.error) || "unknown error" : null,
    });
  }

  const enabledList = list.filter((b) => b.enabled);
  return {
    ok: true,
    enabled: enabledList.length,
    keyless: enabledList.filter((b) => b.keyless).length,
    // The deployment cap and the user's numResults combine as
    // min(hostCap, userMax) in provider.search(); expose the user value here
    // so an observer can explain why a search returned fewer results.
    requestedMaxResults: Number.isFinite(opts.numResults) ? opts.numResults : null,
    backends: list,
    updatedAt: Date.now(),
  };
}

/**
 * Register the read-only health route on the (late-mounted) webServer.
 * GET only; never probes backends; response is JSON with no credentials.
 */
export function registerHealthRoute(ws, deps) {
  if (!ws || typeof ws.register !== "function") return [];
  const disposer = ws.register({
    kind: "exact",
    path: "/api/unified-search/health",
    handler: (req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const rejection = rejectionFor(req, typeof deps.getConnection === "function" ? deps.getConnection() : undefined);
      if (rejection !== undefined) {
        send(rejection, rejectionBody(rejection));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(405, { ok: false, error: "method not allowed (GET only)" });
        return;
      }
      try {
        send(200, buildHealthReport(deps));
      } catch (err) {
        send(500, { ok: false, error: sanitizeError(err) || "health report failed" });
      }
    },
  });
  return typeof disposer === "function" ? [disposer] : [];
}
