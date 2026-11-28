// history.js — v2.7.0 append-only search history (zero deps).
//
// Ring buffer of the most recent maxEntries searches, persisted as one JSON
// file under the plugin's cache dir. Writes are atomic (tmp + rename) and
// append-only: existing entries are never rewritten, only prepended; the
// oldest entry beyond the cap is dropped. Exposure is strictly read-only via
// GET /api/websearch/history; POST /api/websearch/history/clear empties it.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rejectionFor, rejectionBody } from "./trust.js";

/** Ring-buffer cap (spec: 50). */
export const HISTORY_MAX_ENTRIES = 50;

/** Sanitize a history entry to the exact public shape (no credentials/URLs). */
function toPublicEntry(entry) {
  return {
    query: String(entry?.query ?? "").slice(0, 500),
    time: Number.isFinite(entry?.time) ? entry.time : Date.now(),
    resultCount: Math.max(0, Math.floor(Number(entry?.resultCount) || 0)),
    backendsOk: Math.max(0, Math.floor(Number(entry?.backendsOk) || 0)),
    backendsTotal: Math.max(0, Math.floor(Number(entry?.backendsTotal) || 0)),
  };
}

/**
 * Create an append-only history store.
 *
 * @param {object} opts
 * @param {string} opts.dir         directory holding history.json (created lazily)
 * @param {number} [opts.maxEntries] ring cap (default 50)
 * @returns {{ record, list, clear }}
 */
export function createHistoryStore({ dir, maxEntries = HISTORY_MAX_ENTRIES }) {
  const cap = Math.max(1, Math.floor(Number(maxEntries) || HISTORY_MAX_ENTRIES));
  const file = () => path.join(dir, "history.json");
  // Serialize every write through a promise chain: record() is called from
  // concurrent search completions; without the chain, two interleaved
  // read-modify-write cycles lose updates (arch-review P2-2). The body stays
  // synchronous (atomic tmp+rename), so the chain is the only lock needed
  // within this process; cross-process writers are out of scope and each
  // write is still atomic for readers.
  let writeChain = Promise.resolve();

  function readAll() {
    try {
      if (!existsSync(file())) return [];
      const parsed = JSON.parse(readFileSync(file(), "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function atomicWriteAll(list) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { chmodSync(dir, 0o700); } catch { /* existing dir owned by another mode */ }
    const f = file();
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, f);
  }

  return {
    /** Append one search (best-effort; fs errors are swallowed). Newest first. */
    record(entry) {
      writeChain = writeChain.then(() => {
        try {
          const list = readAll();
          list.unshift(toPublicEntry(entry));
          if (list.length > cap) list.length = cap;
          atomicWriteAll(list);
        } catch {
          // history write failures are non-fatal by design
        }
      });
      return writeChain;
    },

    /** Read the current history, newest first (defensive copy). */
    list() {
      return readAll().slice(0, cap).map(toPublicEntry);
    },

    /** Empty the history. Serialised with record() so a pending append cannot
     *  resurrect an entry after the clear. */
    clear() {
      writeChain = writeChain.then(() => {
        try {
          if (existsSync(file())) unlinkSync(file());
        } catch {
          // nothing to do
        }
      });
      return writeChain;
    },
  };
}

/**
 * Project the module-level backend health map into a small observability
 * payload (v2.8.0 P2): per-backend last real success/failure, latency and
 * breaker state — no error strings, no credentials, safe for the GUI.
 */
export function toBackendObservability(healthMap, nowMs = Date.now()) {
  const out = [];
  if (healthMap instanceof Map) {
    for (const [id, e] of healthMap) {
      out.push({
        id,
        ok: e?.ok === true,
        ms: Number.isFinite(e?.ms) ? e.ms : null,
        at: Number.isFinite(e?.at) ? e.at : null,
        failCount: Number.isFinite(e?.failCount) ? e.failCount : 0,
        cooled: Number.isFinite(e?.cooledUntil) && e.cooledUntil > nowMs,
        cooledUntilMs: Number.isFinite(e?.cooledUntil) && e.cooledUntil > nowMs ? e.cooledUntil : null,
        rateLimited: e?.rateLimited === true,
        keylessRejected: e?.keylessRejected === true,
        credentialMissing: e?.credentialMissing === true,
      });
    }
  }
  return out;
}

/**
 * Register the read-only history routes on the (late-mounted) webServer.
 * GET  /api/websearch/history        -> { ok, entries, backends }
 *   backends: per-backend last real outcome/latency/breaker state (v2.8.0),
 *   so fallback redundancy is observable without a separate endpoint.
 * POST /api/websearch/history/clear  -> { ok, cleared: true }
 * Both routes sit behind the host connection admission fence (the same
 * decision the kernel applies to its own /api routes).
 */
export function registerHistoryRoutes(ws, { getStore, getBackendHealth, getConnection }) {
  if (!ws || typeof ws.register !== "function") return [];
  const send = (res, code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const guarded = (handler) => (req, res) => {
    const rejection = rejectionFor(req, typeof getConnection === "function" ? getConnection() : undefined);
    if (rejection !== undefined) {
      send(res, rejection, rejectionBody(rejection));
      return;
    }
    handler(req, res);
  };
  const disposers = [];
  try {
    disposers.push(ws.register({
      kind: "exact",
      path: "/api/websearch/history",
      handler: guarded((req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          send(res, 405, { ok: false, error: "method not allowed (GET only)" });
          return;
        }
        const store = getStore();
        send(res, 200, {
          ok: true,
          entries: store ? store.list() : [],
          backends: toBackendObservability(typeof getBackendHealth === "function" ? getBackendHealth() : getBackendHealth),
        });
      }),
    }));
    disposers.push(ws.register({
      kind: "exact",
      path: "/api/websearch/history/clear",
      handler: guarded((req, res) => {
        if (req.method !== "POST") {
          send(res, 405, { ok: false, error: "method not allowed (POST only)" });
          return;
        }
        const store = getStore();
        // clear() is serialised behind the write chain, so the 200 must wait for
        // it: otherwise the client's next GET can still see the old entries.
        const cleared = store?.clear();
        Promise.resolve(cleared).then(
          () => send(res, 200, { ok: true, cleared: true }),
          () => send(res, 500, { ok: false, error: "clear failed" }),
        );
      }),
    }));
  } catch (err) {
    // If the second route collides, the first registration must be rolled
    // back here; the outer route installer cannot see unreturned disposers.
    for (const dispose of disposers.reverse()) {
      try { dispose(); } catch { /* best-effort rollback */ }
    }
    throw err;
  }
  return disposers.filter((d) => typeof d === "function");
}
