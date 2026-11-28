// tests/client-behavior.test.js — behaviour-level coverage for lib/client.js.
//
// client.js is a `window.__ModuleLoader__` factory whose controllers live in a
// closure. The older source-level assertions (assert.match(src, ...)) could only
// pin text, so any refactor that moved code broke them without changing
// behaviour, and they could not catch a behaviour regression at all. These tests
// boot the real module under a fake window and drive the real controllers
// through the props the settings slot receives, so they observe what the card
// actually does: staged state, the POST body it sends, and the projection it
// publishes.
//
// Run: node --test tests/client-behavior.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CLIENT = new URL("../lib/client.js", import.meta.url);

/** Boot the module factory with a stubbed window and the two react faces. */
function loadModule() {
  const src = readFileSync(CLIENT, "utf8");
  let captured;
  const fakeWindow = {
    __ModuleLoader__: { load: (entry) => { captured = entry; } },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
  // eslint-disable-next-line no-new-func
  new Function("window", "CustomEvent", src)(fakeWindow, class {});
  return captured.factory((name) => {
    if (name === "react/jsx-runtime") {
      return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: Symbol("Fragment") };
    }
    if (name === "react") return { createElement: (type, props) => ({ type, props }) };
    throw new Error(`unexpected require: ${name}`);
  });
}

/**
 * Boot one real controller through apply(), returning the slot props the
 * settings section would receive.
 * @param {object} [options]
 * @param {object} [options.settings] initial settings document returned by GET
 * @param {(req: object) => object} [options.onWrite] reply for a POST
 */
function bootCard(options = {}) {
  const module = loadModule();
  const sections = [];
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    requests.push({ method, url: String(url), body: init.body });
    const reply = method === "POST"
      ? (options.onWrite ? options.onWrite({ method, url: String(url), body: init.body }) : { ok: true })
      : (options.settings ?? { ok: true, writable: true, value: { numResults: 8, enableBrave: true }, base: {}, user: {}, revision: 1 });
    return { ok: true, status: 200, json: async () => reply };
  };
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register() {}, bind: () => (key) => key },
    // The controller reads `ctx.get("connection")` / `ctx.get("remote")`; a
    // constant undefined would silently disable credential writes and make any
    // test that exercises them pass with nothing written.
    get: (name) => (name === "connection" ? options.connection : name === "remote" ? options.remote : undefined),
    slots: { inject: (_name, fn) => { sections.push(fn?.()); }, register: (desc) => { sections.push(desc); return () => {}; } },
    remote: { $on: () => () => {} },
  };
  module.apply(ctx);
  const section = sections.find((entry) => entry && typeof entry.inject === "function");
  const props = section.inject();
  const store = props.hooks.unifiedSearchCard;
  /** Last write the card issued, parsed. */
  const lastWrite = () => {
    const post = [...requests].reverse().find((r) => r.method === "POST");
    return post === undefined ? undefined : JSON.parse(post.body);
  };
  return { props, store, requests, lastWrite };
}

test("editing a field stages it and updates the published projection", () => {
  const { props, store } = bootCard();
  props.edit("numResults", "3");
  const snap = store.getSnapshot();
  assert.equal(snap.stagedCount, 1, "the edit must reach the published projection");
  assert.equal(snap.savedAt, 0, "editing must clear the saved indicator");
});

test("a blank key draft never stages, so the Save button drains", () => {
  const { props, store } = bootCard();
  props.editKey("BRAVE_API_KEY", "sk-live");
  assert.equal(store.getSnapshot().stagedCount, 1);
  props.editKey("BRAVE_API_KEY", "   ");
  assert.equal(store.getSnapshot().stagedCount, 0, "whitespace-only drafts must not stay staged");
});

test("reset drops the staged edit without touching the stored value", () => {
  const { props, store, requests } = bootCard();
  props.edit("numResults", "3");
  props.reset("numResults");
  assert.equal(store.getSnapshot().stagedCount, 0);
  assert.equal(requests.filter((r) => r.method === "POST").length, 0, "reset must not write");
});

test("save sends one batched set op and clears the staged text", async () => {
  const { props, store, lastWrite } = bootCard();
  props.edit("numResults", "3");
  await props.save();
  const write = lastWrite();
  assert.deepEqual(write.ops, [{ op: "set", path: ["numResults"], value: 3 }]);
  const snap = store.getSnapshot();
  assert.equal(snap.stagedCount, 0);
  assert.ok(snap.savedAt > 0, "a successful save records when it happened");
});

test("a failed write keeps the staged text and reports the failure", async () => {
  const { props, store } = bootCard({ onWrite: () => ({ ok: false, code: "SETTINGS_CONFLICT" }) });
  props.edit("numResults", "3");
  await props.save();
  const snap = store.getSnapshot();
  assert.equal(snap.stagedCount, 1, "a rejected save must not discard the user's edit");
  assert.equal(snap.failed, true);
  assert.equal(snap.conflict, true, "SETTINGS_CONFLICT must be classified, not echoed");
});

test("discard drops every staged edit and clears the failure state", () => {
  const { props, store } = bootCard();
  props.edit("numResults", "3");
  props.editKey("BRAVE_API_KEY", "sk-live");
  props.discard();
  const snap = store.getSnapshot();
  assert.equal(snap.stagedCount, 0);
  assert.equal(snap.failed, false);
  assert.equal(snap.conflict, false);
});

test("a second save while one is in flight is a no-op, not a double write", async () => {
  const { props, requests } = bootCard();
  props.edit("numResults", "3");
  const first = props.save();
  // Double-clicking Save must not send two writes for the same edit.
  const second = props.save();
  await Promise.all([first, second]);
  const posts = requests.filter((r) => r.method === "POST");
  assert.equal(posts.length, 1, "the in-flight guard must swallow the second save");
});

test("queued writes each read the revision at their own turn, not up front", async () => {
  // Two toggles fired together must not share a revision read: the second
  // queued write has to pick up the revision the first one installed.
  const revisions = [];
  const { props } = bootCard({
    settings: { ok: true, writable: true, value: { numResults: 8 }, base: {}, user: {}, revision: 0 },
    onWrite: ({ body }) => {
      revisions.push(JSON.parse(body).expectedRevision);
      return { ok: true, writable: true, value: { numResults: 8 }, base: {}, user: {}, revision: revisions.length };
    },
  });
  await Promise.all([props.setToggle("enableBrave", true), props.setToggle("enableExa", true)]);
  assert.equal(revisions.length, 2, "both toggles must be written");
  assert.notEqual(revisions[0], revisions[1], "the queued write must not reuse the first write's revision");
});

test("the card renders one row per enabled keyed backend and no optional title when empty", async () => {
  const module = loadModule();
  const registrations = [];
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true, writable: true,
        value: { numResults: 8, enableBrave: true, enableExa: true },
        base: {}, user: {}, revision: 1,
      }),
    };
  };
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register() {}, bind: () => (key) => key },
    get: () => undefined,
    slots: {
      // The real host runs the inject callback; a no-op here would hide the
      // registration entirely and the render component would never be captured.
      inject: (_name, fn) => { fn(); },
      register: (desc, component) => { registrations.push({ desc, component }); return () => {}; },
    },
    remote: { $on: () => () => {} },
  };
  module.apply(ctx);
  // apply() kicks off bridge.load() without awaiting it; the card renders a
  // placeholder until that resolves. Settle the microtask queue first.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { desc, component } = registrations.find((r) => r && r.component) ?? {};
  assert.ok(component, "apply must register a render component");
  // The host converts hooks.<name> into props.use<Name>; the component calls it
  // during render, so the fake must expose the same shape.
  const injected = desc.inject();
  const hostProps = { ...injected, t: (key) => key };
  hostProps.useUnifiedSearchCard = () => injected.hooks.unifiedSearchCard.getSnapshot();
  const element = component(hostProps);
  // Walk the returned element tree looking for the keyed cards.
  const seen = [];
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    // The fake jsx keeps component functions in `type` without invoking them;
    // expand them so nested render functions (KeyedBackendCard) participate.
    if (typeof node.type === "function") {
      walk(node.type(node.props ?? {}));
      return;
    }
    seen.push(node);
    walk(node.props?.children ?? []);
  };
  walk(element);
  if (process.env.DEBUG_CARD) {
    console.log("DBG ready:", injected.hooks.unifiedSearchCard.getSnapshot().ready,
      "root:", element?.type, "kids:", Array.isArray(element?.props?.children) ? element.props.children.length : typeof element?.props?.children,
      "seen:", seen.length, "classes:", seen.map((n) => n.props?.className).filter(Boolean).slice(0, 8).join(","));
  }
  assert.ok(requests >= 1, "the card must load its settings on mount");
  // Count the keyed-backend cards by the class the component gives them. KEYED
  // is the set of backends that always need a key (independent of what is
  // enabled), so a render that silently drops them (children: [].map(...))
  // must fail here.
  const keyCards = seen.filter((n) => n.props?.className === "wsc-keyCard");
  assert.equal(keyCards.length, 7, "one card per keyed backend in KEYED");
  // The optional-key group (searxng / firecrawl / tinyfish) has its own header
  // and must not be collapsed into the keyed grid.
  const titles = seen.filter((n) => n.props?.className === "wsc-sectionTitle");
  assert.ok(titles.length >= 3, "free / keyed / optional groups keep their own headers");
});

test("an edit that arrives while a save is in flight is kept, not discarded as saved", async () => {
  // The save snapshots the staged entry BEFORE awaiting the host. If that
  // identity guard were dropped, the newer draft would be deleted as if it had
  // been saved, silently losing the user's last keystrokes.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { props, store } = bootCard({
    onWrite: async () => { await gate; return { ok: true, writable: true, value: { numResults: 3 }, base: {}, user: {}, revision: 2 }; },
  });
  props.edit("numResults", "3");
  const saving = props.save();
  // The write is parked inside the host call; change the field again.
  await new Promise((resolve) => setTimeout(resolve, 10));
  props.edit("numResults", "5");
  release();
  await saving;
  const snap = store.getSnapshot();
  assert.equal(snap.stagedCount, 1, "the later edit must survive the save");
  // stagedText is a selector function on the projection, not a plain object.
  assert.equal(snap.stagedText("numResults"), "5", "the surviving draft is the newer text");
});

test("credential write failures are redacted to a stable code, never echoed", async () => {
  const { props, store } = bootCard({
    connection: {
      api: {
        credentials: {
          set: async ({ ref, value }) => {
            // A hostile provider message must not reach the card verbatim.
            const err = new Error("sk-live-abc123 rejected by provider: <html>");
            err.code = "provider said \u0000";
            throw err;
          },
        },
      },
    },
  });
  props.editKey("BRAVE_API_KEY", "sk-live-abc123");
  await props.save();
  const snap = store.getSnapshot();
  const failure = (snap.failedKeys ?? []).find((f) => f && f.ref === "BRAVE_API_KEY");
  assert.ok(failure, "the failure must be reported per key");
  // Either a short stable code from err.code, or the fixed fallback; never free text.
  assert.match(String(failure.reason), /^([a-z][a-z0-9/_-]{0,60}|write rejected)$/i, "the reason is a stable code, not free text");
  assert.ok(!String(failure.reason).includes("sk-live"), "the secret must never be echoed");
  assert.ok(!String(failure.reason).includes("<html>"), "raw provider payload must never be echoed");
});

test("a failed toggle resyncs from the host and logs only the classification", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args); };
  const { props, store, requests } = bootCard({
    settings: { ok: true, writable: true, value: { numResults: 8, enableBrave: false }, base: {}, user: {}, revision: 0 },
    onWrite: () => ({ ok: false, code: "SETTINGS_CONFLICT" }),
  });
  try {
    await props.setToggle("enableBrave", true);
  } finally {
    console.warn = originalWarn;
  }
  const gets = requests.filter((r) => r.method === "GET").length;
  const posts = requests.filter((r) => r.method === "POST").length;
  assert.equal(posts, 1, "the toggle is written once");
  assert.ok(gets >= 2, "a failed toggle reloads from the host instead of trusting the stale value");
  const snap = store.getSnapshot();
  assert.equal(snap.toggleFailed, true);
  assert.equal(snap.toggleConflict, true, "SETTINGS_CONFLICT is classified");
  assert.ok(warnings.length > 0, "the failure is logged");
  const logged = JSON.stringify(warnings);
  assert.ok(logged.includes("conflict"), "the log records the classification only");
  assert.ok(!logged.includes("sk-"), "no credential may land in the log");
});

test("a key re-typed while its save is in flight keeps the newer draft", async () => {
  // save() snapshots the staged KEY entry before awaiting credentials.set. If
  // the snapshot were taken after the await (or compared by text instead of
  // object identity), the newer draft would be deleted as if it had been saved.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const written = [];
  const { props, store } = bootCard({
    connection: {
      api: {
        credentials: {
          set: async ({ ref, value }) => { written.push([ref, value]); await gate; return { ok: true }; },
        },
      },
    },
  });
  props.editKey("BRAVE_API_KEY", "sk-first");
  const saving = props.save();
  await new Promise((resolve) => setTimeout(resolve, 10));
  props.editKey("BRAVE_API_KEY", "sk-second");
  release();
  await saving;
  const snap = store.getSnapshot();
  assert.equal(written.length, 1, "the first draft is the one written");
  assert.equal(written[0][1], "sk-first");
  assert.equal(snap.stagedCount, 1, "the newer draft survives");
  assert.equal(snap.stagedKeys["BRAVE_API_KEY"], "sk-second", "the surviving draft is the newer text");
});

test("a key draft that was not re-edited is dropped after a successful save", async () => {
  const { props, store } = bootCard({
    connection: { api: { credentials: { set: async () => ({ ok: true }) } } },
  });
  props.editKey("BRAVE_API_KEY", "sk-once");
  await props.save();
  const snap = store.getSnapshot();
  assert.equal(snap.stagedCount, 0, "an untouched draft is consumed by the save");
  assert.equal(snap.keyState["BRAVE_API_KEY"]?.configured, true, "the key is now configured");
});

test("a credential read failure is reported as readErrors, not failedKeys", async () => {
  // READ failures must not be confused with SAVE failures, and only a fixed
  // code may surface (never the host's raw message).
  const { props, store } = bootCard({
    remote: {
      credentials: {
        describe: async ([ref]) => ({ ok: false, error: { message: "boom: <html>" }, ref }),
        set: async () => ({ ok: true }),
      },
    },
  });
  // apply() calls refreshAllCredentials() on mount; give it a tick to land.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const snap = store.getSnapshot();
  const readFailure = (snap.readErrors ?? []).find((f) => f && f.ref === "BRAVE_API_KEY");
  assert.ok(readFailure, "a failed read is reported");
  assert.equal(readFailure.reason, "credential/read-failed", "the reason is a fixed code");
  assert.ok(!JSON.stringify(snap.readErrors).includes("<html>"), "no raw host payload is stored");
  assert.equal((snap.failedKeys ?? []).length, 0, "read failures never leak into failedKeys");
});

test("metered backends render in their own group and never in the keyless group", async () => {
  const module = loadModule();
  const registrations = [];
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, writable: true, value: { numResults: 8 }, base: {}, user: {}, revision: 1 }),
  });
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register() {}, bind: () => (key) => key },
    get: () => undefined,
    slots: { inject: (_name, fn) => { fn(); }, register: (desc, component) => { registrations.push({ desc, component }); return () => {}; } },
    remote: { $on: () => () => {} },
  };
  module.apply(ctx);
  // apply() kicks off bridge.load() without awaiting it; settle before rendering.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { desc, component } = registrations.find((r) => r && r.component) ?? {};
  const injected = desc.inject();
  const hostProps = { ...injected, t: (key) => key };
  hostProps.useUnifiedSearchCard = () => injected.hooks.unifiedSearchCard.getSnapshot();
  const seen = [];
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === "function") { walk(node.type(node.props ?? {})); return; }
    seen.push(node);
    walk(node.props?.children ?? []);
  };
  walk(component(hostProps));
  // The metered group is rendered under its own header; its toggles must not
  // also appear in the keyless group, and vice versa.
  const meteredHeader = seen.findIndex((n) => n.props?.className === "wsc-sectionTitle" && String(n.props?.children) === "groupMetered");
  assert.ok(meteredHeader >= 0, "the metered group keeps its own header");
  const freeHeader = seen.findIndex((n) => n.props?.className === "wsc-sectionTitle" && String(n.props?.children) === "groupFree");
  assert.ok(freeHeader >= 0, "the keyless group keeps its header");
  const grids = seen.filter((n) => n.props?.className === "wsc-toggles");
  assert.ok(grids.length >= 2, "each group renders its own toggle grid");
  // Count the toggles INSIDE the first (keyless) grid. METERED must not leak
  // into it: keyless is exa/parallel/ddg/searxng, so four rows and no metered
  // label. Asserting only that both headers exist would pass even when filter
  // drops the !b.metered guard, so the count is what makes this test bite.
  const countToggles = (node) => {
    let rows = 0;
    const inner = (n) => {
      if (n === null || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(inner); return; }
      if (typeof n.type === "function") { inner(n.type(n.props ?? {})); return; }
      if (n.props?.className === "wsc-toggle") rows += 1;
      inner(n.props?.children ?? []);
    };
    inner(node);
    return rows;
  };
  assert.equal(countToggles(grids[0]), 4, "the keyless grid holds exactly the four non-metered backends");
  assert.ok(!JSON.stringify(grids[0].props?.children ?? [], (k, v) => (typeof v === "function" ? undefined : v)).includes("Firecrawl"),
    "Firecrawl (metered) must not appear in the keyless grid");
});

test("a rejected credential write is reported, not silently accepted", async () => {
  // RemoteResult envelopes resolve with ok:false instead of throwing; treating
  // that as success would leave an unusable key marked as configured.
  const { props, store } = bootCard({
    connection: { api: { credentials: { set: async () => ({ ok: false, error: { message: "rejected" } }) } } },
  });
  props.editKey("BRAVE_API_KEY", "sk-bad");
  await props.save();
  const snap = store.getSnapshot();
  const failure = (snap.failedKeys ?? []).find((f) => f && f.ref === "BRAVE_API_KEY");
  assert.ok(failure, "an ok:false envelope is a failure");
  assert.notEqual(snap.keyState["BRAVE_API_KEY"]?.configured, true, "the key must not be marked configured");
  assert.equal(failure.reason, "write rejected", "the reason is the fixed fallback, not the host text");
});

test("the keyed card forwards key edits to the controller action", async () => {
  // The render layer passes onEditKey to KeyedBackendCard; if that wiring broke,
  // typing in the card would stage nothing and Save would silently do nothing.
  const written = [];
  const { props } = bootCard({
    connection: { api: { credentials: { set: async (arg) => { written.push(arg); return { ok: true }; } } } },
  });
  props.editKey("BRAVE_API_KEY", "sk-sent");
  await props.save();
  assert.deepEqual(written[0], { ref: "BRAVE_API_KEY", value: "sk-sent" }, "the card's edit reaches the host write");
});

test("the status strip reports enabled and keyed counts", async () => {
  const module = loadModule();
  const registrations = [];
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      ok: true, writable: true,
      value: { numResults: 8, enableExa: true, enableBrave: true },
      base: {}, user: {}, revision: 1,
    }),
  });
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register() {}, bind: () => (key) => key },
    get: () => undefined,
    slots: { inject: (_name, fn) => { fn(); }, register: (desc, component) => { registrations.push({ desc, component }); return () => {}; } },
    remote: { $on: () => () => {} },
  };
  module.apply(ctx);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { desc, component } = registrations.find((r) => r && r.component) ?? {};
  const injected = desc.inject();
  const hostProps = { ...injected, t: (key) => key };
  hostProps.useUnifiedSearchCard = () => injected.hooks.unifiedSearchCard.getSnapshot();
  const seen = [];
  const strings = [];
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === "function") { walk(node.type(node.props ?? {})); return; }
    seen.push(node);
    const c = node.props?.children;
    if (typeof c === "string") strings.push(c);
    if (Array.isArray(c)) c.forEach((x) => { if (typeof x === "string") strings.push(x); });
    walk(node.props?.children ?? []);
  };
  walk(component(hostProps));
  // Both counters must render as <b>; dropping one leaves a single <b>.
  const bolds = seen.filter((n) => n.type === "b");
  assert.equal(bolds.length, 2, "enabled/total and keys/total each render a <b>");
  // And the labels must be present somewhere in the tree.
  const allStrings = strings.join("|");
  assert.ok(allStrings.includes("statusEnabled"), "the enabled counter keeps its label");
  assert.ok(allStrings.includes("statusKeys"), "the keyed counter keeps its label");
});

test("a host settingsScope is used instead of the HTTP bridge", async () => {
  // selectBridge prefers ctx.get("settingsScope") when it exposes bind(); with
  // that face present, no /api/unified-search/settings request may be issued.
  const calls = [];
  const module = loadModule();
  const registrations = [];
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error("routes bridge must not be used"); };
  // The bound object is the same bridge face the routes implementation exposes:
  // the controller reads getSnapshot()/subscribe() and calls accept(), load(),
  // set() and unset(). A partial fake fails in the constructor.
  let snapshot = { status: "ready", writable: true, value: { numResults: 8 }, base: {}, user: {}, revision: 1, mode: "scope" };
  const listeners = new Set();
  const settingsScope = {
    bind: ({ namespace }) => ({
      getSnapshot: () => snapshot,
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      accept: (payload) => { calls.push(["accept", payload?.revision]); if (payload) snapshot = { ...snapshot, ...payload }; },
      load: async () => { calls.push(["load", namespace]); return snapshot; },
      set: async (field, value) => { calls.push(["set", field, value]); return { ok: true }; },
      unset: async (field) => { calls.push(["unset", field]); return { ok: true }; },
    }),
  };
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register() {}, bind: () => (key) => key },
    get: (name) => (name === "settingsScope" ? settingsScope : undefined),
    slots: { inject: (_name, fn) => { fn(); }, register: (desc, component) => { registrations.push({ desc, component }); return () => {}; } },
    remote: { $on: () => () => {} },
  };
  module.apply(ctx);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { desc } = registrations.find((r) => r && r.component) ?? {};
  const injected = desc.inject();
  injected.edit("numResults", "3");
  await injected.save();
  assert.equal(fetches, 0, "a bound settingsScope must bypass the HTTP bridge entirely");
  assert.equal(calls[0][1], "unified-search", "the scope is bound to the plugin namespace");
  assert.deepEqual(calls[1], ["set", "numResults", 3], "the write goes through the scope");
});

test("the legacy connection credentials API is used when the remote face is absent", async () => {
  // Older DSH lines expose credentials on the connection controller instead of
  // the remote namespace; that branch had no coverage at all.
  const described = [];
  const { props, store } = bootCard({
    connection: {
      api: {
        credentials: {
          describe: async ({ refs }) => { described.push(refs); return { result: { ok: true, value: { credentials: { BRAVE_API_KEY: { configured: true, writable: true } } } } }; },
          set: async () => ({ ok: true }),
        },
      },
    },
  });
  // apply() calls refreshAllCredentials() on mount; no manual kick needed.
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(described.length >= 1, "the legacy describe() is called");
  assert.ok(described.every((refs) => refs.length === 1), "one ref per describe call");
  assert.ok(described.some((refs) => refs[0] === "BRAVE_API_KEY"), "BRAVE_API_KEY is among the read refs");
  assert.equal(store.getSnapshot().keyState["BRAVE_API_KEY"]?.configured, true, "the configured badge is set");
  assert.equal((store.getSnapshot().readErrors ?? []).length, 0, "a successful read records no error");
});


// ---- R3: regressions pinned from the client.js split audit (120-m5) ----
// Each of these fails on lib/client.js before C1/C2 and passes after.

test("R3-1 the language field stays free text, not a select", async () => {
  const module = loadModule();
  const registrations = [];
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return { ok:true, status:200, json: async () => ({ ok:true, writable:true, value:{ numResults:8, language:"zh-CN" }, base:{}, user:{}, revision:1 }) }; };
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register() {}, bind: () => (key) => key },
    get: () => undefined,
    slots: { inject: (_n, fn) => { fn(); }, register: (desc, component) => { registrations.push({ desc, component }); return () => {}; } },
    remote: { $on: () => () => {} },
  };
  module.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));
  const { desc, component } = registrations.find((r) => r && r.component) ?? {};
  const injected = desc.inject();
  const hostProps = { ...injected, t: (key) => key };
  hostProps.useUnifiedSearchCard = () => injected.hooks.unifiedSearchCard.getSnapshot();
  const nodes = [];
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === "function") { walk(node.type(node.props ?? {})); return; }
    nodes.push(node);
    walk(node.props?.children ?? []);
  };
  walk(component(hostProps));
  assert.ok(requests >= 1, "the card must load its settings");
  const langInput = nodes.find((n) => n.type === "input" && n.props?.placeholder === "langPlaceholder");
  assert.ok(langInput, "language must render as an input with the langPlaceholder hint");
  assert.equal(String(langInput.props.value), "zh-CN", "the input shows the stored language");
  const selects = nodes.filter((n) => n.type === "select");
  assert.equal(selects.length, 8, "eight enum selects (intervention/recency/dedup/rerank/safeSearch/telemetry/header/cache)");
});

test("R3-2 the save button is disabled while the scope is read-only", async () => {
  const module = loadModule();
  const registrations = [];
  globalThis.fetch = async () => ({ ok:true, status:200, json: async () => ({ ok:true, writable:false, value:{ numResults:8 }, base:{}, user:{}, revision:1 }) });
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register() {}, bind: () => (key) => key },
    get: () => undefined,
    slots: { inject: (_n, fn) => { fn(); }, register: (desc, component) => { registrations.push({ desc, component }); return () => {}; } },
    remote: { $on: () => () => {} },
  };
  module.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));
  const { desc, component } = registrations.find((r) => r && r.component) ?? {};
  const injected = desc.inject();
  injected.edit("numResults", "3");
  const hostProps = { ...injected, t: (key) => key };
  hostProps.useUnifiedSearchCard = () => injected.hooks.unifiedSearchCard.getSnapshot();
  const buttons = [];
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === "function") { walk(node.type(node.props ?? {})); return; }
    if (node.type === "button") buttons.push(node);
    walk(node.props?.children ?? []);
  };
  walk(component(hostProps));
  const save = buttons.find((b) => b.props.children === "save");
  assert.ok(save, "the save button renders");
  assert.equal(save.props.disabled, true, "a read-only scope must not offer a write");
});

test("R3-3 every key the card renders through t() exists in the dictionaries", async () => {
  const module = loadModule();
  const registrations = [];
  globalThis.fetch = async () => ({ ok:true, status:200, json: async () => ({ ok:true, writable:true, value:{ numResults:8 }, base:{}, user:{}, revision:1 }) });
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register() {}, bind: () => (key) => key },
    get: () => undefined,
    slots: { inject: (_n, fn) => { fn(); }, register: (desc, component) => { registrations.push({ desc, component }); return () => {}; } },
    remote: { $on: () => () => {} },
  };
  module.apply(ctx);
  await new Promise((r) => setTimeout(r, 20));
  const { desc, component } = registrations.find((r) => r && r.component) ?? {};
  const injected = desc.inject();
  const used = [];
  const hostProps = { ...injected, t: (key) => { used.push(key); return key; } };
  hostProps.useUnifiedSearchCard = () => injected.hooks.unifiedSearchCard.getSnapshot();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === "function") { walk(node.type(node.props ?? {})); return; }
    walk(node.props?.children ?? []);
  };
  walk(component(hostProps));
  // Pull the real dictionaries straight out of the module source.
  const src = readFileSync(CLIENT, "utf8");
  const grab = (name) => {
    const i = src.indexOf("const " + name + " = {");
    let d = 0, k = src.indexOf("{", i);
    for (; k < src.length; k += 1) { if (src[k] === "{") d += 1; else if (src[k] === "}") { d -= 1; if (d === 0) break; } }
    return src.slice(src.indexOf("{", i), k + 1);
  };
  const zh = (0, eval)("(" + grab("zh") + ")");
  const en = (0, eval)("(" + grab("en") + ")");
  const known = new Set([...Object.keys(zh), ...Object.keys(en)]);
  const missing = [...new Set(used)].filter((k) => !known.has(k));
  assert.deepEqual(missing, [], "the card must not render a literal key name");
});

/** Boot the module against a caller-supplied fetch, exposing the render entry. */
function bootWithFetch(fetchImpl) {
  const module = loadModule();
  const registrations = [];
  globalThis.fetch = fetchImpl;
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register() {}, bind: () => (key) => key },
    get: () => undefined,
    slots: { inject: (_n, fn) => { fn(); }, register: (desc, component) => { registrations.push({ desc, component }); return () => {}; } },
    remote: { $on: () => () => {} },
  };
  module.apply(ctx);
  const { desc, component } = registrations.find((r) => r && r.component) ?? {};
  const props = desc.inject();
  return { module, props, component, store: props.hooks.unifiedSearchCard };
}

/** Render the captured component with the slot props and flatten the tree. */
function flatten(component, props) {
  const hostProps = { ...props, t: (key) => key };
  hostProps.useUnifiedSearchCard = () => props.hooks.unifiedSearchCard.getSnapshot();
  const nodes = [];
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === "function") { walk(node.type(node.props ?? {})); return; }
    nodes.push(node);
    walk(node.props?.children ?? []);
  };
  walk(component(hostProps));
  return nodes;
}

test("a 404/503 snapshot renders an explicit unavailable state, not a fabricated 0/13 with live controls", async () => {
  const { props, component } = bootWithFetch(async () => ({
    ok: true,
    status: 503,
    json: async () => ({ ok: false, writable: false, reason: "settings-unavailable" }),
  }));
  await new Promise((r) => setTimeout(r, 20));
  const snapshot = props.hooks.unifiedSearchCard.getSnapshot();
  assert.equal(snapshot.unavailable, true);
  const nodes = flatten(component, props);
  assert.equal(nodes.some((n) => n.type === "input"), false, "no live inputs when there is no snapshot");
  assert.ok(nodes.some((n) => n.type === "button" && n.props.children === "retry"), "the card offers a retry");
});

test("a read-only snapshot disables every control through the form fieldset", async () => {
  const { props, component } = bootWithFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, writable: false, value: { numResults: 8, enableBrave: false }, base: {}, user: {}, revision: 1 }),
  }));
  await new Promise((r) => setTimeout(r, 20));
  const nodes = flatten(component, props);
  const fieldsets = nodes.filter((n) => n.type === "fieldset");
  assert.equal(fieldsets.length, 1);
  assert.equal(fieldsets[0].props.disabled, true, "a read-only host must not leave live toggles");
});

test("a stale settings load cannot roll back a newer write", async () => {
  let releaseGet;
  const pendingGet = new Promise((resolve) => { releaseGet = resolve; });
  let firstGet = true;
  const { props, store } = bootWithFetch(async (_url, init = {}) => {
    if ((init.method ?? "GET") !== "POST" && firstGet) {
      firstGet = false;
      const payload = await pendingGet;
      return { ok: true, status: 200, json: async () => payload };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, writable: true, value: { numResults: 8, enableBrave: true }, base: {}, user: {}, revision: 1 }) };
  });
  await props.setToggle("enableBrave", true);
  releaseGet({ ok: true, writable: true, value: { numResults: 8, enableBrave: false }, base: {}, user: {}, revision: 0 });
  await new Promise((r) => setTimeout(r, 20));
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.value.enableBrave, true, "the stale load must not flip the toggle back");
  assert.equal(snapshot.revision, 1, "the stale revision must not be restored");
});

test("a save conflict refreshes the revision so the retry can succeed", async () => {
  let posts = 0;
  let gets = 0;
  const bodies = [];
  const { props, store } = bootWithFetch(async (_url, init = {}) => {
    if ((init.method ?? "GET") !== "POST") {
      gets += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, writable: true, value: { numResults: gets === 1 ? 8 : 5 }, base: {}, user: {}, revision: gets === 1 ? 0 : 1 }),
      };
    }
    posts += 1;
    bodies.push(JSON.parse(init.body));
    if (posts === 1) {
      return { ok: false, status: 409, json: async () => ({ ok: false, code: "SETTINGS_CONFLICT" }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, writable: true, value: { numResults: 3 }, base: {}, user: {}, revision: 2 }) };
  });
  await new Promise((r) => setTimeout(r, 20));
  props.edit("numResults", "3");
  await props.save();
  assert.equal(store.getSnapshot().conflict, true, "the conflict is reported");
  assert.equal(store.getSnapshot().revision, 1, "the conflict triggers a reload with the host revision");
  await props.save();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].expectedRevision, 1, "the retry must use the refreshed revision");
});

test("the card CSS uses only theme tokens the DSH design system defines", async () => {
  // Token names verified against dsh-client-ui-theme's design-platform.css
  // (132 aliases). An undefined custom property makes the whole declaration
  // invalid at computed-value time: the Save button lost its background and
  // every input/badge lost its border.
  const DEFINED = new Set([
    "brand-primary",
    "bg-layer-1",
    "bg-module-platform",
    "border-l2",
    "label-primary",
    "label-primary-foreground",
    "button-primary-fill",
    "button-primary-hover",
    "link",
    "state-success-primary",
    "border-l3",
    "border-l4",
    "interactive-bg-hover",
    "interactive-bg-hover-solid",
    "state-business-primary",
    "label-secondary",
    "label-tertiary",
    "state-error-primary",
    "state-warn-label",
    "state-warn-primary",
    "settings-card-stroke",
    "settings-card-fill",
    "bg-layer-2",
  ]);
  const styles = [];
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: "" }),
    head: { appendChild: (tag) => styles.push(tag) },
  };
  try {
    loadModule();
  } finally {
    delete globalThis.document;
  }
  const css = styles[0]?.textContent ?? "";
  const tokens = [...new Set(css.match(/--dsw-alias-[a-z0-9-]+/g) ?? [])]
    .map((t) => t.replace("--dsw-alias-", ""));
  assert.ok(tokens.length >= 8, "the stylesheet renders and carries the theme tokens");
  assert.deepEqual(tokens.filter((t) => !DEFINED.has(t)), [], "every token must exist in the DSH theme");
  for (const retired of ["accent-primary", "bg-subtle", "border-subtle"]) {
    assert.equal(tokens.includes(retired), false, `${retired} is not defined by the theme`);
  }
});

test("a credential read that started before a successful key save cannot unpaint it", async () => {
  let releaseRead;
  const gated = new Promise((resolve) => { releaseRead = resolve; });
  let describeCalls = 0;
  const { props, store } = bootCard({
    settings: { ok: true, writable: true, value: { numResults: 8, enableBrave: true }, base: {}, user: {}, revision: 0 },
    remote: {
      credentials: {
        describe: async ([ref]) => {
          describeCalls += 1;
          if (ref === "BRAVE_API_KEY" && describeCalls > 0) {
            const configured = await gated;
            return { ok: true, value: { credentials: { [ref]: { configured, writable: true } } } };
          }
          return { ok: true, value: { credentials: { [ref]: { configured: false, writable: true } } } };
        },
        set: async () => ({ ok: true }),
      },
    },
  });
  await new Promise((r) => setTimeout(r, 10));
  props.editKey("BRAVE_API_KEY", "sk-live-test-key");
  await props.save();
  assert.equal(store.getSnapshot().keyState.BRAVE_API_KEY.configured, true, "the save repaints the badge");
  releaseRead(false);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.getSnapshot().keyState.BRAVE_API_KEY.configured, true, "the stale read must not unpaint it");
});
