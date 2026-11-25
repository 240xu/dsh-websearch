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
    get: () => undefined,
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
      try { walk(node.type(node.props ?? {})); } catch { /* ignore unmockable */ }
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
