// tests/host-trust.test.js — plain-http base URLs are private-host only.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createUnifiedSearchProvider } from "../lib/provider.js";

function providerWith(baseURL) {
  const calls = [];
  const backend = {
    id: "mock",
    available: () => true,
    search: async () => {
      calls.push(baseURL);
      return { sources: [{ url: "https://example.com/", title: "Example" }] };
    },
  };
  return {
    calls,
    provider: createUnifiedSearchProvider({
      ctx: {},
      resolveOptions: () => ({
        enabledBackends: ["mock"],
        numResults: 4,
        backends: { mock: { baseURL } },
        ctx: {},
      }),
      backends: { mock: backend },
    }),
  };
}

for (const [label, baseURL] of [
  ["private-network suffix", "http://searxng.youban.internal"],
  ["RFC1918 literal", "http://192.168.1.100:8080"],
  ["loopback", "http://127.0.0.1:8080"],
]) {
  test(`plain http is allowed for a ${label} (${baseURL})`, async () => {
    const { provider, calls } = providerWith(baseURL);
    await provider.search({ query: "q", maxResults: 4 }, undefined);
    assert.equal(calls.length, 1, "backend must run");
  });
}

test("plain http is rejected for a public host", async () => {
  const { provider, calls } = providerWith("http://searx.example.com");
  await assert.rejects(() => provider.search({ query: "q", maxResults: 4 }, undefined), /invalid baseURL/);
  assert.equal(calls.length, 0, "backend must not run");
});

test("https is always allowed", async () => {
  const { provider, calls } = providerWith("https://searx.example.com");
  await provider.search({ query: "q", maxResults: 4 }, undefined);
  assert.equal(calls.length, 1);
});
