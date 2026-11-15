/**
 * Fenced settings bridge for the browser settings card.
 *
 * The card needs three things from the host: the resolved value of every
 * field, the revision that guards concurrent saves, and a way to write path
 * ops back into the same profile entry the provider reads. On the 0.2.x
 * settings line there is no `settingsScope` client service and the settings
 * shell renders client slot sections only — so this module servers that data
 * over the plugin's own HTTP surface instead.
 *
 * Data flow: the host keeps plugin config in its `settings` service
 * (`SettingsForms.describe` / `mutate`, keyed by the profile entry id). This
 * route is a thin bridge to it: writes land in the volatile config entry the
 * provider resolves from on the next call, so there is no second store and no
 * out-of-band state. Mutations are validated against the plugin's own schema
 * here because the host only checks the volatile path, not the value shape.
 *
 * Both routes sit behind the host connection admission fence (the same
 * decision the kernel applies to its own `/api` routes, including the browser
 * auth cookie), so a LAN or tunnel page holding a valid session can save
 * settings, and nothing weaker than the app can.
 *
 *   GET  /api/unified-search/settings -> { ok, namespace, writable, revision,
 *                                          value, base, user, reason? }
 *   POST /api/unified-search/settings -> { ok } + fresh payload on success,
 *                                        409 { code: 'SETTINGS_CONFLICT' },
 *                                        400 invalid op value/field,
 *                                        503 settings service unavailable.
 *
 * Headless / CI profiles never mount `webServer`, so registration is skipped
 * and nothing here runs.
 *
 * @module lib/settings-api.js
 */
import { rejectionFor } from "./trust.js";
import { findPluginRow } from "./util/namespace.js";

const SETTINGS_PATH = "/api/unified-search/settings";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_OPS = 64;

/**
 * Register the (exact) settings route on the late-mounted webServer.
 * @param {{ register?: (route: { kind: string, path: string, handler: Function }) => void }} ws
 * @param {{ getSettings: () => unknown, getConfig: () => unknown, getConnection?: () => unknown }} deps
 */
export function registerSettingsRoutes(ws, deps) {
  if (!ws || typeof ws.register !== "function") return [];
  const disposer = ws.register({
    kind: "exact",
    path: SETTINGS_PATH,
    handler: guarded(deps, (req, res) => {
      const url = new URL(String(req.url ?? "/"), "http://localhost");
      if (url.pathname !== SETTINGS_PATH) {
        sendJson(res, 404, { ok: false, error: "not found" });
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const payload = describe(deps);
        sendJson(res, payload.ok ? 200 : 503, payload);
        return;
      }
      if (req.method === "POST") {
        // Return the promise so guarded()'s catch handles write() failures
        // instead of leaving an unhandled rejection with no response.
        return write(req, res, deps);
      }
      res.setHeader("allow", "GET, POST");
      sendJson(res, 405, { ok: false, error: "method not allowed (GET/POST)" });
    }),
  });
  return typeof disposer === "function" ? [disposer] : [];
}

/* ------------------------------------------------------------------ */
/* handlers                                                            */
/* ------------------------------------------------------------------ */

function guarded(deps, handler) {
  return (req, res) => {
    const rejection = rejectionFor(req, typeof deps.getConnection === "function" ? deps.getConnection() : undefined);
    if (rejection !== undefined) {
      sendJson(res, rejection, { ok: false, error: rejection === 503 ? "admission unavailable" : "untrusted request" });
      return;
    }
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((err) => {
        const status = err && Number.isInteger(err.status) ? err.status : 500;
        sendJson(res, status, { ok: false, error: sanitize(err) });
      });
  };
}

/** Read the plugin's volatile form snapshot from the host settings service.
 * `revision` counts value changes, not write requests: setting a field to its
 * current value returns 200 without advancing it. Pass the returned revision
 * as expectedRevision on the next write for optimistic-concurrency checks. */
function describe(deps) {
  const settings = typeof deps.getSettings === "function" ? deps.getSettings() : undefined;
  if (settings === undefined || settings === null || typeof settings.describe !== "function") {
    return { ok: false, writable: false, reason: "settings-unavailable" };
  }
  let descriptors;
  try {
    descriptors = settings.describe();
  } catch {
    return { ok: false, writable: false, reason: "settings-unavailable" };
  }
  const view = findNamespace(descriptors);
  if (view === undefined) return { ok: false, writable: false, reason: "namespace-not-found" };
  return {
    ok: true,
    namespace: view.ns,
    writable: true,
    applies: view.applies,
    revision: view.revision,
    value: view.value,
    base: view.base,
    user: view.user,
  };
}

/**
 * Locate the plugin's settings row. Delegates to the shared resolver so the
 * HTTP bridge and the provider resolve the same namespace in the same way.
 * @param {unknown} descriptors - `settings.describe()` output.
 * @returns {object|undefined} the matching row.
 */
function findNamespace(descriptors) {
  return findPluginRow(descriptors);
}

async function write(req, res, deps) {
  const type = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!type.includes("application/json")) {
    sendJson(res, 400, { ok: false, error: "content-type must be application/json" });
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    sendJson(res, err && Number.isInteger(err.status) ? err.status : 400, { ok: false, error: sanitize(err) || "request body is not valid JSON" });
    return;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    sendJson(res, 400, { ok: false, error: "request body must be a JSON object" });
    return;
  }
  const wanted = Array.isArray(body.ops) ? body.ops : undefined;
  if (wanted === undefined || wanted.length === 0 || wanted.length > MAX_OPS) {
    sendJson(res, 400, { ok: false, error: `ops must be a non-empty array of at most ${MAX_OPS} entries` });
    return;
  }
  const settings = typeof deps.getSettings === "function" ? deps.getSettings() : undefined;
  if (settings === undefined || settings === null || typeof settings.mutate !== "function") {
    sendJson(res, 503, { ok: false, error: "settings service unavailable" });
    return;
  }
  const config = typeof deps.getConfig === "function" ? deps.getConfig() : undefined;
  const fields = config !== undefined && config !== null && config.dict !== undefined && config.dict !== null
    ? config.dict
    : {};
  const view = findNamespace(safeDescribe(settings));
  if (view === undefined) {
    sendJson(res, 503, { ok: false, error: "settings namespace unavailable" });
    return;
  }
  const expected = Number.isInteger(body.expectedRevision) ? body.expectedRevision : undefined;
  // Report a stale revision before field validation: otherwise a caller that
  // both lost a race and sent a bad value sees a misleading 400 and retries
  // forever. The host mutate() still performs the authoritative CAS below,
  // so a revision that changes between here and there remains covered.
  if (expected !== undefined && Number.isInteger(view.revision) && expected !== view.revision) {
    sendJson(res, 409, { ok: false, code: "SETTINGS_CONFLICT", error: "settings changed elsewhere; reload and retry" });
    return;
  }
  const ops = [];
  for (const raw of wanted) {
    const parsed = validateOp(raw, fields);
    if (typeof parsed === "string") {
      sendJson(res, 400, { ok: false, error: parsed });
      return;
    }
    ops.push(parsed);
  }
  try {
    await settings.mutate(view.ns, ops, expected);
  } catch (err) {
    if (isConflict(err)) {
      sendJson(res, 409, { ok: false, code: "SETTINGS_CONFLICT", error: "settings changed elsewhere; reload and retry" });
      return;
    }
    sendJson(res, 400, { ok: false, error: sanitize(err) || "settings write failed" });
    return;
  }
  const payload = describe(deps);
  sendJson(res, payload.ok ? 200 : 503, payload);
}

/**
 * Shape-check one path op against the live schema. The host validates only
 * that the path is inside the volatile subtree; a wrong-typed value would be
 * written into the profile patch and break the entry's next reload, so the
 * value must be validated here.
 * @returns {object|string} the op to forward, or a fixed reason string
 */
function validateOp(raw, fields) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "ops entries must be objects";
  const op = raw.op === "set" || raw.op === "unset" ? raw.op : undefined;
  if (op === undefined) return "unsupported op (expected set|unset)";
  const path = Array.isArray(raw.path) ? raw.path : undefined;
  if (path === undefined || path.length !== 1 || typeof path[0] !== "string" || path[0] === "") {
    return "path must be a one-element array holding a field name";
  }
  const field = path[0];
  if (!Object.hasOwn(fields, field)) return `unknown settings field "${field}"`;
  if (op === "unset") return { op, path: [field] };
  if (!Object.hasOwn(raw, "value")) return `op "set" on "${field}" requires a value`;
  const schema = fields[field];
  if (typeof schema !== "function") return `field "${field}" is not writable`;
  let checked;
  try {
    checked = schema(raw.value);
  } catch {
    return `invalid value for "${field}"`;
  }
  return { op, path: [field], value: checked };
}

function isConflict(err) {
  if (err === null || err === undefined) return false;
  if (typeof err === "object" && typeof err.code === "string" && err.code === "SETTINGS_CONFLICT") return true;
  const message = typeof err === "object" && "message" in err ? String(err.message) : String(err);
  return /SETTINGS_CONFLICT/.test(message);
}

function safeDescribe(settings) {
  try {
    return settings.describe();
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* plumbing                                                            */
/* ------------------------------------------------------------------ */

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    const onEnd = () => resolveBody(Buffer.concat(chunks).toString("utf8"));
    const onError = rejectBody;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const oversize = new Error("request body too large");
        oversize.status = 413;
        rejectBody(oversize);
        // Stop consuming and release the stream so a keep-alive connection is
        // not left waiting for an `end` that can still arrive.
        req.removeAllListeners("data");
        req.removeListener("end", onEnd);
        req.removeListener("error", onError);
        // Drain the remaining body instead of destroying the socket: the 413
        // response still has to be written, and destroying here makes the
        // client see ECONNRESET (65 号 N1, a regression of the drain fix).
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function sendJson(res, status, payload) {
  if (res.writableEnded === true) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

/** Fixed-shape diagnostics only: never echo header text or raw error details. */
function sanitize(err) {
  const raw = err === null || err === undefined ? "" : String(err && err.message ? err.message : err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 160);
}
