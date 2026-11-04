// tests/v28x-settings-bridge.test.js — regression for the DSH 0.2.x settings
// contract: on 0.2.x there is no installSection, and the entry-level `config`
// handed to apply() can carry only schema defaults. The provider must still
// resolve the profile-patch / settings-service values, and a plain-http base
// URL on a private (RFC1918) host must pass the baseURL trust gate.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "dsh-websearch-test-"));

const { apply } = await import("../lib/index.js");

const BASE = "http://192.168.0.105:8385"; // 192.168/16 must be accepted as private
const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const href = String(url);
  seen.push(href);
  if (href.startsWith(BASE)) {
    return new Response(JSON.stringify({ results: [{ url: "https://example.test/a", title: "A" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("backend disabled in this test", { status: 500 });
};

const settings = {
  describe: () => [{ ns: "unified-search", value: { searxngBaseURL: BASE, safeSearch: false }, base: {}, user: {} }],
  mutate: async () => {},
};

let provider;
const ctx = {
  get: () => undefined,
  inject: (deps, cb) => {
    if (deps.includes("settings")) cb({ settings });
  },
  logger: { info() {}, warn() {}, debug() {}, error() {} },
  web: { registerSearchProvider: (p) => { provider = p; } },
};

try {
  // Empty config = what a DSH 0.2.2 entry actually hands to apply().
  apply(ctx, {});
  await provider.search({ query: "settings bridge", maxResults: 3 }, new AbortController().signal).catch(() => {});
  const hits = seen.filter((u) => u.startsWith(BASE));
  assert.equal(hits.length, 1, "searxng must be queried at the settings-service baseURL, got: " + JSON.stringify(seen));
  assert.ok(!hits[0].includes("searx.be"), "must not fall back to the built-in public instance");
  assert.ok(hits[0].includes("safesearch=0"), "safeSearch=false from the settings service must apply");
} finally {
  globalThis.fetch = realFetch;
}

console.log("v28x-settings-bridge: ok");
