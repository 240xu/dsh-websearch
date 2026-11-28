// tests/lead-20261106.test.js — regression tests for the lead-owned fixes.
// Run: node --test tests/lead-20261106.test.js
//
// NOTE ON DEPENDENCIES: the backends import `@deepseek-ai/dsh-web` (WebError).
// At runtime DSH host injects that package; a bare `node --test` from the
// installed npm package cannot resolve it (true for all 11 original backends,
// not just these two). Run this file from `.artifacts/websearch-research/
// src-work/plugin/`, where `node_modules/@deepseek-ai/*` are symlinks to the
// published CLI copies used only for testing. The installed `lib/` stays
// pristine — see the byte-identical check in the execution log.
//
// Added 2026-11-06 by dsh-websearch / lead. Pure fixtures only: NO live
// network, NO API keys. These cover:
//   1. the two new OpenCode v2 keyless MCP backends (parse functions);
//   2. the CONNECT-tunnel Host restoration (via source inspection, since
//      httpsViaConnect is module-private and needs a real proxy socket).
//      Offline A/B run on 2026-11-06 with a local CONNECT proxy + TLS server:
//        patched  -> Host "localhost:<port>" (explicit target.host)
//        original -> Host "localhost"       (Node auto-synthesis, no port)
//      Both carry a Host header; the fix makes it explicit/port-qualified.
//
// Companion evidence:
//   .artifacts/websearch-research/22-execution-drafts.md §1.2 (live A/B:
//   WITHOUT Host: 403 / WITH Host: 200) and §3.2 (fixture draft).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseFirecrawlResult } from "../lib/backends/firecrawl.js";
import { parseTinyfishResult } from "../lib/backends/tinyfish.js";

const HERE = new URL(".", import.meta.url);

test("parseFirecrawlResult: {success,data.web[]} JSON text → sources", () => {
  const inner = JSON.stringify({
    success: true,
    data: {
      web: [
        { url: "https://a.example", title: "A", description: "desc A" },
        { url: "https://b.example", title: null, description: null },
      ],
    },
  });
  const got = parseFirecrawlResult({ content: [{ text: inner }] }, 8);
  assert.equal(got.length, 2);
  assert.equal(got[0].url, "https://a.example");
  assert.equal(got[0].title, "A");
  assert.equal(got[0].snippet, "desc A");
  assert.equal(got[1].url, "https://b.example");
  assert.equal(got[1].title, undefined);
  assert.equal(got[1].snippet, undefined);
});

test("parseFirecrawlResult: success:false / bad JSON / missing web → []", () => {
  assert.deepEqual(parseFirecrawlResult({ content: [{ text: "not json" }] }, 8), []);
  assert.deepEqual(parseFirecrawlResult({ content: [{ text: '{"success":false}' }] }, 8), []);
  assert.deepEqual(parseFirecrawlResult({ content: [{ text: '{"data":{}}' }] }, 8), []);
  assert.deepEqual(parseFirecrawlResult({ content: [] }, 8), []);
});

test("parseFirecrawlResult: honours maxResults and skips url-less rows", () => {
  const inner = JSON.stringify({
    success: true,
    data: { web: [
      { url: "https://1.example" },
      { title: "no url" },
      { url: "https://2.example" },
      { url: "https://3.example" },
    ] },
  });
  const got = parseFirecrawlResult({ content: [{ text: inner }] }, 2);
  assert.deepEqual(got.map((s) => s.url), ["https://1.example", "https://2.example"]);
});

test("parseTinyfishResult: {results[]} JSON text → sources", () => {
  const inner = JSON.stringify({
    results: [
      { url: "https://t1.example", title: "T1", snippet: "snip 1" },
      { url: "https://t2.example", title: "T2", snippet: "" },
    ],
  });
  const got = parseTinyfishResult({ content: [{ text: inner }] }, 8);
  assert.equal(got.length, 2);
  assert.equal(got[0].url, "https://t1.example");
  assert.equal(got[0].snippet, "snip 1");
  assert.equal(got[1].snippet, undefined);
});

test("parseTinyfishResult: bad JSON / missing results → []", () => {
  assert.deepEqual(parseTinyfishResult({ content: [{ text: "oops" }] }, 8), []);
  assert.deepEqual(parseTinyfishResult({ content: [{ text: "{}" }] }, 8), []);
  assert.deepEqual(parseTinyfishResult(undefined, 8), []);
});

test("egress-fetch: httpsViaConnect restores Host after normalizeHeaders strips it", () => {
  // Source-level regression: normalizeHeaders() must keep `delete host`, and
  // BOTH proxy transports must add it back with the same expression. This
  // pins the fix without requiring a live CONNECT socket (covered by the
  // manual A/B in 22-execution-drafts.md §1.2).
  const src = readFileSync(new URL("../lib/util/egress-fetch.js", HERE), "utf8");
  assert.match(src, /delete headers\["host"\]/);
  // Count only real code lines (the lead comment quotes the same expression).
  const restorations = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .filter((line) => line.includes("headers.host ?? target.host"));
  assert.equal(restorations.length, 2, "httpViaProxy and httpsViaConnect must both restore Host");
});

test("mcp-client: skipInitialize option keeps the default handshake", () => {
  const src = readFileSync(new URL("../lib/util/mcp-client.js", HERE), "utf8");
  assert.match(src, /options\.skipInitialize \? undefined : await ensureSession/);
  assert.match(src, /export async function mcpCall\([^)]*options = \{\}/);
});

// lead (2026-11-06 UX polish): the Settings panel is a bundled client module,
// so assert its grouping/labels statically rather than rendering React.
test("client.js UX: metered backends are separate, labelled and i18n-complete", () => {
  const src = readFileSync(new URL("../lib/client.js", HERE), "utf8");

  // 1. The metered/keyless split is covered behaviourally by
  // client-behavior.test.js ("metered backends render in their own group"):
  // it counts the toggles inside the keyless grid (exactly 4) and asserts no
  // metered label leaks into it. Dropping `&& !b.metered` fails that test.

  // 2. Description no longer hardcodes the stale "11 backends".
  assert.doesNotMatch(src, /11 个后端/);
  assert.doesNotMatch(src, /11 backends/);

  // 3. Every newly added copy key is defined in BOTH dictionaries and used.
  for (const key of ["groupMetered", "meteredHint", "statusMetered", "statusOffByDefault"]) {
    const defs = (src.match(new RegExp(`^\\s*${key}:`, "gm")) ?? []).length;
    assert.equal(defs, 2, `${key} must be defined in zh and en`);
    assert.ok(src.includes(`t("${key}")`), `${key} must be referenced via props.t`);
  }

  // 4. Status bar explains why enabled/total is intentionally low.
  assert.match(src, /statusMetered/);
  // 5. Fallback hint does not imply metered backends auto-enable.
  assert.match(src, /计量型仍保持关闭/);
  assert.match(src, /metered backends stay off/);
});

// lead (2026-11-06 UX round 2): a key-gated backend's switch and its API-key
// input must be ONE card, and failing key saves must actually be visible.
test("client.js UX: key switch merged with key input; failedKeys bug fixed", () => {
  const src = readFileSync(new URL("../lib/client.js", HERE), "utf8");

  // 1. The combined card is covered behaviourally by client-behavior.test.js:
  // "the card renders one row per ..." counts the wsc-keyCard elements, and
  // "the keyed card forwards key edits" asserts a typed key reaches
  // credentials.set. Dropping the card render or the onEditKey wiring fails one
  // of those tests; no source pin is needed here.

  // 2. The old separate "API keys" grid is gone (no duplicate inputs).
  assert.doesNotMatch(src, /children: props\.t\("keysTitle"\)/);
  // 3. The old `.includes(b.keyEnv)` bug (failedKeys is [{ref,reason}]) is gone.
  assert.doesNotMatch(src, /state\.failedKeys\.includes\(b\.keyEnv\)/);
  // Both key sections now resolve failures by ref.
  const finds = (src.match(/\(state\.failedKeys \?\? \[\]\)\.find\(\(f\) => f && f\.ref === b\.keyEnv\)/g) ?? []).length;
  assert.equal(finds, 2, "KeyedBackendCard and OPTIONAL_KEYS must both resolve failures by ref");

  // 4. The immediate-switch / staged-key distinction is explained once, in
  // both locales, instead of repeating the same sentence under every key card.
  const defs = (src.match(/^\s*saveModelHint:/gm) ?? []).length;
  assert.equal(defs, 2);
  assert.equal((src.match(/t\("saveModelHint"\)/g) ?? []).length, 1);

  // 5. Dead copy keys removed (they were only defined, never rendered).
  for (const dead of ["keysTitle", "keyHint"]) {
    assert.equal((src.match(new RegExp(`^\\s*${dead}:`, "gm")) ?? []).length, 0, `${dead} should not linger`);
  }
});

// lead-fix (2026-11-06): github.com/240xu/dsh-websearch/issues/8 — on DSH
// 0.2.x, `ctx.remote.credentials` throws unless `remote.credentials` is in
// `inject`, so EVERY key save failed and the configured badge never lit; also
// `set()` resolves with `{ok:false}` instead of throwing, causing false
// "Saved" feedback. Pin all three fixes statically (bundled client module).
test("client.js issue #8: credential save path is actually usable on DSH 0.2.x", () => {
  const src = readFileSync(new URL("../lib/client.js", HERE), "utf8");

  // 1. Namespace declared in inject (matches the official settings-models plugin).
  assert.ok(
    src.includes('const inject = ["slots", "locale", "connection", "remote", "remote.credentials"];'),
    "inject must declare remote.credentials (issue #8 root cause)",
  );

  // 2. Both read and write guard the property access (no naked throw).
  const guards = (src.match(/try \{ api = this\.remote === undefined \? undefined : this\.remote\.credentials; \} catch \{ api = undefined; \}/g) ?? []).length;
  assert.equal(guards, 2, "readCredential and writeCredential must both guard the access");
  assert.doesNotMatch(src, /if \(this\.remote !== undefined && this\.remote\.credentials !== undefined/);

  // 3. `set()` envelope is checked, so a rejected write is not shown as saved.
  assert.match(src, /res\.ok === false/);
  assert.match(src, /throw new Error\(res\.error\?\.message \?\? "credential write rejected"\)/);

  // 4. package.json dsh.client.inject is a PACKAGE-level list; adding the
  //    service key there would be wrong. Assert we did not.
  const pkg = JSON.parse(readFileSync(new URL("../package.json", HERE), "utf8"));
  const pkgInject = pkg?.dsh?.client?.inject ?? [];
  assert.ok(!pkgInject.includes("remote.credentials"));

  // 5. lead-fix (2026-11-07, review 33): readCredential must judge the
  //    RemoteResult envelope before unwrapping. Otherwise `{ok:false}` falls
  //    through to the legacy connection branch and can surface a stale value.
  assert.match(src, /let readFailed = false;/);
  assert.match(src, /if \(res !== null && typeof res === "object" && res\.ok === false\) \{\s*readFailed = true;/);
  assert.match(src, /if \(!readFailed && view === undefined && this\.connection/);
  assert.match(src, /if \(!readFailed && view !== undefined && seq === this\.credSeq\.get\(ref\)\)/);
});

// The real writeCredential lives inside the bundled client module. Pin the
// production check at source level (no mirrored copy of the logic here) and
// exercise the real shared error factory behaviourally.
test("issue #8: ok:false envelope is rejected, not reported as saved", async () => {
  // The ok:false envelope handling is covered behaviourally by
  // client-behavior.test.js ("a rejected credential write is reported"): it
  // returns { ok: false } from credentials.set and asserts the key is reported
  // as failed, not marked configured. Hard-coding `rejected = false` fails it.
  const { webErrorFromResponse } = await import("../lib/util/web-error.js");
  const { rateLimited } = await import("../lib/util/failure-label.js");
  const err = webErrorFromResponse(new Response("rate limited", { status: 429 }), "rate limited", "Exa");
  // A rate-limited response is classified from its structured code, not by
  // re-parsing a copied message string.
  assert.equal(rateLimited(err), true);
  assert.equal(err.code, "RATE_LIMIT");
});
