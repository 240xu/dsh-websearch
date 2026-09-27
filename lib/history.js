// history.js — v2.7.0 append-only search history (zero deps).
//
// Ring buffer of the most recent maxEntries searches, persisted as one JSON
// file under the plugin's cache dir. Writes are atomic (tmp + rename) and
// append-only: existing entries are never rewritten, only prepended; the
// oldest entry beyond the cap is dropped. Exposure is strictly read-only via
// GET /api/websearch/history; POST /api/websearch/history/clear empties it.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

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
    mkdirSync(dir, { recursive: true });
    const f = file();
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
    renameSync(tmp, f);
  }

  return {
    /** Append one search (best-effort; fs errors are swallowed). Newest first. */
    record(entry) {
      try {
        const list = readAll();
        list.unshift(toPublicEntry(entry));
        if (list.length > cap) list.length = cap;
        atomicWriteAll(list);
      } catch {
        // history write failures are non-fatal by design
      }
    },

    /** Read the current history, newest first (defensive copy). */
    list() {
      return readAll().slice(0, cap).map(toPublicEntry);
    },

    /** Empty the history (removes the file; best-effort). */
    clear() {
      try {
        if (existsSync(file())) unlinkSync(file());
      } catch {
        // nothing to do
      }
    },
  };
}

/**
 * Register the read-only history routes on the (late-mounted) webServer.
 * GET  /api/websearch/history        -> { ok, entries }
 * POST /api/websearch/history/clear  -> { ok, cleared: true }
 */
export function registerHistoryRoutes(ws, { getStore }) {
  if (!ws || typeof ws.register !== "function") return;
  const send = (res, code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  ws.register({
    kind: "exact",
    path: "/api/websearch/history",
    handler: (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, { ok: false, error: "method not allowed (GET only)" });
        return;
      }
      const store = getStore();
      send(res, 200, { ok: true, entries: store ? store.list() : [] });
    },
  });
  ws.register({
    kind: "exact",
    path: "/api/websearch/history/clear",
    handler: (req, res) => {
      if (req.method !== "POST") {
        send(res, 405, { ok: false, error: "method not allowed (POST only)" });
        return;
      }
      const store = getStore();
      store?.clear();
      send(res, 200, { ok: true, cleared: true });
    },
  });
}
