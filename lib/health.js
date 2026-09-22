// health.js — read-only health surface for the unified-search plugin.
//
// GET /api/unified-search/health reports which backends are enabled / keyless
// and the LAST per-backend telemetry captured during a real search. It never
// probes anything by itself (quota safety) and never echoes credential
// material: error strings are truncated to 40-120 chars (matching the
// provider's own telemetry truncation) and run through a defensive redaction
// pass for token-like fragments.

const MAX_ERROR_CHARS = 120;

/** Token-like fragments that must never appear in a health payload. */
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /(api[_-]?key|token|secret|password)\s*[=:]\s*\S{6,}/gi,
];

/**
 * Truncate + redact an error string for safe display.
 * Returns "" for falsy input; length bounded to 40-120 chars.
 */
export function sanitizeError(err) {
  if (err === null || err === undefined) return "";
  let s = String(err instanceof Error ? err.message : err);
  for (const re of SECRET_PATTERNS) s = s.replace(re, "[redacted]");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > MAX_ERROR_CHARS) s = s.slice(0, MAX_ERROR_CHARS);
  return s;
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
      // reachable: true/false from the latest search telemetry; null = never probed.
      reachable: t ? t.ok === true : null,
      lastOk: t && typeof t.lastOkAt === "number" ? t.lastOkAt : null,
      lastError: t && t.ok !== true ? sanitizeError(t.error) || "unknown error" : null,
    };
  });

  const enabledList = list.filter((b) => b.enabled);
  return {
    ok: true,
    enabled: enabledList.length,
    keyless: enabledList.filter((b) => b.keyless).length,
    backends: list,
    updatedAt: Date.now(),
  };
}

/**
 * Register the read-only health route on the (late-mounted) webServer.
 * GET only; never probes backends; response is JSON with no credentials.
 */
export function registerHealthRoute(ws, deps) {
  if (!ws || typeof ws.register !== "function") return;
  ws.register({
    kind: "exact",
    path: "/api/unified-search/health",
    handler: (req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
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
}
