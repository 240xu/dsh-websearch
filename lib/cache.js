// cache.js — v2.7.0 disk cache for unified search results (zero dependencies).
//
// Cache key: sha256 over the canonical JSON of {query (already shaped),
// filters, maxResults} — exactly the dimensions that change a search outcome.
// Entries live as one JSON file per key under <dir>, written atomically
// (tmp file + rename) so a crash mid-write never leaves a corrupt cache.
// Eviction: when the entry count exceeds maxEntries, the oldest-by-mtime
// files are deleted first. Every fs error is swallowed by the caller-facing
// API (get/set never throw) — a broken cache must never break a search.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** Defaults (overridable per instance; settings feed these from index.js). */
export const CACHE_DEFAULTS = {
  ttlMs: 900_000, // 900s
  maxEntries: 200,
};

/**
 * Compute the deterministic cache key for a search.
 * Includes the enabledBackends selection set (sorted): switching the backend
 * mix must never serve a stale result produced by a different combination
 * (arch-review P1-1). Pure function; exported for tests and host reuse.
 */
export function cacheKeyFor({ query, filters, maxResults, backends }) {
  const backendSet = Array.isArray(backends) ? [...backends].sort().join(",") : "";
  const canonical = JSON.stringify({
    q: typeof query === "string" ? query : "",
    f: filters ?? {},
    n: Number(maxResults) || 0,
    b: backendSet,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** Age of a record in whole seconds (bounded >= 0). */
function ageSeconds(record, nowMs) {
  return Math.max(0, Math.floor((nowMs - (record?.time ?? 0)) / 1000));
}

/**
 * Create a disk-backed result cache.
 *
 * @param {object} opts
 * @param {string} opts.dir         cache directory (created lazily)
 * @param {number} [opts.ttlMs]     entry TTL in ms (default 900_000)
 * @param {number} [opts.maxEntries] entry cap (default 200)
 * @returns {{ get, set, clear }}  get/set/clear never throw
 */
export function createSearchCache({ dir, ttlMs = CACHE_DEFAULTS.ttlMs, maxEntries = CACHE_DEFAULTS.maxEntries }) {
  // ttlMs may be a number or () => number (settings can change at runtime).
  const ttlOf = typeof ttlMs === "function" ? ttlMs : () => Number(ttlMs) || 0;
  const cap = Math.max(1, Math.floor(Number(maxEntries) || CACHE_DEFAULTS.maxEntries));

  const fileFor = (key) => path.join(dir, `${key}.json`);

  function ensureDir() {
    mkdirSync(dir, { recursive: true });
  }

  /** Atomic write: tmp sibling + rename (same filesystem, atomic on POSIX). */
  function atomicWrite(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, data, "utf8");
    renameSync(tmp, file);
  }

  /** List current entries as [{key, file, mtime}] sorted oldest first. */
  function listEntries() {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || name.includes(".tmp")) continue;
      const file = path.join(dir, name);
      try {
        out.push({ key: name.slice(0, -5), file, mtime: statSync(file).mtimeMs });
      } catch {
        // raced delete — skip
      }
    }
    return out.sort((a, b) => a.mtime - b.mtime);
  }

  function evict() {
    const entries = listEntries();
    for (let i = 0; i < entries.length - cap; i++) {
      try { unlinkSync(entries[i].file); } catch { /* raced */ }
    }
  }

  return {
    /**
     * Look up a cached result.
     * @returns {{ value: object, age: number } | null} age in seconds; null on miss/expiry
     */
    get(key, nowMs = Date.now()) {
      try {
        const file = fileFor(key);
        if (!existsSync(file)) return null;
        const record = JSON.parse(readFileSync(file, "utf8"));
        if (!record || typeof record !== "object" || !record.value) return null;
        const age = ageSeconds(record, nowMs);
        const ttl = Math.max(0, Number(ttlOf()) || 0);
        if (age * 1000 > ttl) {
          try { unlinkSync(file); } catch { /* raced */ }
          return null;
        }
        return { value: record.value, age };
      } catch {
        return null;
      }
    },

    /** Store a result (best-effort; fs errors are swallowed). */
    set(key, value, nowMs = Date.now()) {
      try {
        ensureDir();
        atomicWrite(fileFor(key), JSON.stringify({ key, time: nowMs, value }));
        evict();
      } catch {
        // cache write failures are non-fatal by design
      }
    },

    /** Drop every cached entry (best-effort). */
    clear() {
      try {
        for (const e of listEntries()) {
          try { unlinkSync(e.file); } catch { /* raced */ }
        }
      } catch {
        // nothing to do
      }
    },
  };
}
