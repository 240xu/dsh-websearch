// tests/ark.test.js — 火山方舟 (Volcengine Ark) backend: registry, defaults,
// config surface and delegation to the shared Responses transport.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Config, resolveOptions } from "../lib/index.js";
import { arkBackend } from "../lib/backends/ark.js";
import { openaiBackend } from "../lib/backends/openai.js";

const stubCtx = { get: () => undefined };

test("ark backend registers under id 'ark' and is key-gated", () => {
  assert.equal(arkBackend.id, "ark");
  assert.equal(arkBackend.requiresCredential, true);
  assert.equal(typeof arkBackend.search, "function");
});

test("ark availability mirrors the shared Responses transport", () => {
  // Missing credential → unavailable, exactly like the OpenAI backend.
  assert.equal(arkBackend.available({ baseURL: "https://ark.cn-beijing.volces.com/api/v3" }), false);
  // Credential resolver present + parseable base URL → available.
  assert.equal(
    arkBackend.available({
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      resolveApiKey: async () => "ark-test",
    }),
    true,
  );
  // Unparseable base URL stays unavailable rather than throwing.
  assert.equal(arkBackend.available({ baseURL: "not a url", resolveApiKey: async () => "k" }), false);
});

test("Config exposes the Ark surface with documented defaults", () => {
  const dict = Config.dict ?? {};
  assert.equal(dict.enableArk?.meta?.default, false);
  assert.equal(dict.arkApiKeyEnv?.meta?.default, "ARK_API_KEY");
  assert.equal(dict.arkBaseURL?.meta?.default, "https://ark.cn-beijing.volces.com/api/v3");
  assert.equal(dict.arkModel?.meta?.default, "doubao-seed-2.1-pro");
  // Every new field must carry a description: the 0.2.0 settings form falls
  // back to the raw key name otherwise (see v281-form.test.js).
  for (const key of ["enableArk", "arkApiKeyEnv", "arkBaseURL", "arkModel"]) {
    assert.ok(String(dict[key]?.meta?.description ?? "").trim().length > 0, `${key} needs a description`);
  }
  // The credential reference is rendered as a key field, not free text.
  assert.equal(dict.arkApiKeyEnv?.meta?.role, "credential-ref");
});

test("enabling only Ark yields exactly the Ark backend with its own defaults", () => {
  const opts = resolveOptions(stubCtx, { enableArk: true });
  assert.deepEqual(opts.enabledBackends, ["ark"]);
  const ark = opts.backends.ark;
  assert.equal(ark.apiKeyEnv, "ARK_API_KEY");
  assert.equal(ark.baseURL, "https://ark.cn-beijing.volces.com/api/v3");
  assert.equal(ark.model, "doubao-seed-2.1-pro");
  assert.equal(ark.requiresKey, true);
});

test("Ark config overrides reach the resolved backend options", () => {
  const opts = resolveOptions(stubCtx, {
    enableArk: true,
    arkBaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
    arkModel: "doubao-seed-2.0-lite",
    arkApiKeyEnv: "MY_ARK_KEY",
  });
  assert.deepEqual(opts.enabledBackends, ["ark"]);
  assert.equal(opts.backends.ark.baseURL, "https://ark.cn-beijing.volces.com/api/plan/v3");
  assert.equal(opts.backends.ark.model, "doubao-seed-2.0-lite");
  assert.equal(opts.backends.ark.apiKeyEnv, "MY_ARK_KEY");
});

test("ark delegates its search call to the shared Responses transport", async () => {
  const original = openaiBackend.search;
  const seen = [];
  openaiBackend.search = async (request, signal, options, hooks) => {
    seen.push({ request, options, hooks });
    return { sources: [{ url: "https://example.com/", title: "Example" }] };
  };
  try {
    const request = { query: "volcengine ark", maxResults: 3 };
    const options = { apiKey: "ark-test", baseURL: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2.1-pro" };
    const result = await arkBackend.search(request, undefined, options, {});
    assert.equal(seen.length, 1, "delegates exactly once");
    assert.equal(seen[0].request, request);
    assert.equal(seen[0].options, options);
    assert.equal(result.sources.length, 1);
  } finally {
    openaiBackend.search = original;
  }
});
