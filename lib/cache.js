// cache.js — v2.7.0 disk cache for unified search results (zero dependencies).
//
// Cache key: sha256 over the canonical JSON of the shaped query, filters,
// effective maxResults, ordered backend set, cache mode and result options.
// Entries live as one JSON file per key under <dir>, written atomically
// (tmp file + rename) so a crash mid-write never leaves a corrupt cache.
// Eviction: when the entry count exceeds maxEntries, the oldest-by-mtime
// files are deleted first. Every fs error is swallowed by the caller-facing
// API (get/set never throw) — a broken cache must never break a search.

import { createHash } from "node:crypto";
import {
  chmodSync,
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
 * The key covers the shaped query, filters, the effective maxResults, the
 * enabledBackends selection **in fan-out order**, the cache mode, and every
 * non-function result option: switching the mix or reordering it can change
 * which duplicate's title/snippet wins, so both must miss (arch-review P1-1).
 * Pure function; exported for tests and host reuse.
 */
export function cacheKeyFor({ query, filters, maxResults, backends, mode, resultOptions }) {
  const backendSet = Array.isArray(backends) ? backends.join(",") : "";
  let shaped = {};
  if (resultOptions && typeof resultOptions === "object") {
    const keys = Object.keys(resultOptions).filter((k) =>
      typeof resultOptions[k] !== "function" && !k.startsWith("resolve"));
    for (const k of keys.sort()) shaped[k] = resultOptions[k] ?? null;
  }
  const canonical = JSON.stringify({
    q: typeof query === "string" ? query : "",
    f: filters ?? {},
    n: Number(maxResults) || 0,
    b: backendSet,
    m: typeof mode === "string" ? mode : "",
    o: shaped,
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
  // ttl 0 means "do not store": no read, no write, no diagnostic note.
  const noStore = () => {
    try { return Math.max(0, Number(ttlOf()) || 0) === 0; } catch { return false; }
  };
  const cap = Math.max(1, Math.floor(Number(maxEntries) || CACHE_DEFAULTS.maxEntries));

  const fileFor = (key) => path.join(dir, `${key}.json`);

  function ensureDir() {
    // Query text and results are user data; keep them owner-only.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { chmodSync(dir, 0o700); } catch { /* existing dir owned by another mode */ }
  }

  /**
   * Atomic write: tmp sibling + rename. Atomic on POSIX (rename(2) replaces
   * atomically) and on Windows via libuv's MoveFileExW(MOVEFILE_REPLACE_
   * EXISTING) — see README "权威依据与取舍" for the Windows caveat.
   */
  function atomicWrite(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, data, { encoding: "utf8", mode: 0o600 });
      renameSync(tmp, file);
    } catch (err) {
      // A failed rename must not leave an orphan tmp counted outside the cap.
      try { unlinkSync(tmp); } catch { /* already gone */ }
      throw err;
    }
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

  /** Count entry names without stat()ing them (the common, under-cap path). */
  function countEntries() {
    if (!existsSync(dir)) return 0;
    let n = 0;
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".json") && !name.includes(".tmp")) n += 1;
    }
    return n;
  }

  // maxEntries is a hard bound. Checking it costs one readdir of names; only
  // an over-cap write pays the stat() of every entry. Trimming to a low-water
  // mark (10%, at least one) keeps that scan amortized over ~cap/10 writes
  // instead of running synchronously on every single write.
  /** Remove crash-orphaned tmp files; the cap only counts `.json`. */
  function sweepTmp(maxAgeMs = 3600_000) {
    if (!existsSync(dir)) return;
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      if (!name.includes(".tmp")) continue;
      const file = path.join(dir, name);
      try {
        if (now - statSync(file).mtimeMs >= maxAgeMs) unlinkSync(file);
      } catch { /* raced */ }
    }
  }

  function evict() {
    sweepTmp();
    if (countEntries() <= cap) return;
    const entries = listEntries();
    const lowWater = Math.max(1, cap - Math.max(1, Math.ceil(cap * 0.1)));
    const remove = entries.length - lowWater;
    for (let i = 0; i < remove; i++) {
      try { unlinkSync(entries[i].file); } catch { /* raced */ }
    }
  }

  return {
    /**
     * Look up a cached result.
     * @returns {{ value: object, age: number } | null} age in seconds; null on miss/expiry
     */
    get(key, nowMs = Date.now()) {
      if (noStore()) return null;
      const file = fileFor(key);
      let record;
      try {
        if (!existsSync(file)) return null;
        record = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        // Corrupt/unreadable entry: drop it. A transient TTL error below must
        // NOT delete a valid entry, so it is outside this catch.
        try { unlinkSync(file); } catch { /* raced */ }
        return null;
      }
      if (!record || typeof record !== "object" || !record.value) {
        try { unlinkSync(file); } catch { /* raced */ }
        return null;
      }
      let ttl;
      try { ttl = Math.max(0, Number(ttlOf()) || 0); } catch { return null; }
      const age = ageSeconds(record, nowMs);
      if (age * 1000 > ttl) return null;
      return { value: record.value, age };
    },

    /** Store a result (best-effort; fs errors are swallowed). */
    set(key, value, nowMs = Date.now()) {
      if (noStore()) return;
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
        sweepTmp(0);
        for (const e of listEntries()) {
          try { unlinkSync(e.file); } catch { /* raced */ }
        }
      } catch {
        // nothing to do
      }
    },
  };
}
