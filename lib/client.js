window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-websearch",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		const NS = "websearch.settings";
		const PLUGIN_NS = "unified-search";

		/** Backend metadata: id, default credential env ref, label. */
		const BACKENDS = [
			{ id: "exa", keyEnv: null, label: "Exa (MCP, 免费)" },
			{ id: "parallel", keyEnv: null, label: "Parallel (MCP, 免费)" },
			{ id: "ddg", keyEnv: null, label: "DuckDuckGo (HTML)" },
			{ id: "searxng", keyEnv: "SEARXNG_API_KEY", label: "SearXNG (元搜索)" },
			{ id: "brave", keyEnv: "BRAVE_API_KEY", label: "Brave Search" },
			{ id: "tavily", keyEnv: "TAVILY_API_KEY", label: "Tavily (AI)" },
			{ id: "serper", keyEnv: "SERPER_API_KEY", label: "Serper.dev" },
			{ id: "mojeek", keyEnv: "MOJEEK_API_KEY", label: "Mojeek" },
			{ id: "deepseek", keyEnv: "DEEPSEEK_API_KEY", label: "DeepSeek" },
			{ id: "anthropic", keyEnv: "ANTHROPIC_API_KEY", label: "Anthropic" },
			{ id: "openai", keyEnv: "OPENAI_API_KEY", label: "OpenAI" },
		];
		const GLOBAL_FIELDS = ["numResults", "concurrency", "backendTimeoutMs"];

		const zh = {
			title: "统一搜索 (Unified Search)",
			description: "聚合网络搜索：11 个后端并发 fan-out、URL 去重合并。开关后端、填 API Key、调参数，保存即生效。",
			save: "保存",
			discard: "放弃修改",
			dirty: "有未保存修改",
			saved: "已保存",
			saving: "保存中…",
			failed: "保存失败",
			reset: "重置",
			overridden: "已自定义",
			keyLabel: "{id} API Key",
			keyHint: "填入后保存到凭证库（对应环境变量引用）；留空表示不修改",
			keySet: "已配置",
			keyUnset: "未配置",
			togglesTitle: "启用后端",
			globalsTitle: "全局参数",
		};
		const en = {
			title: "Unified Search",
			description: "Aggregated web search: 11 backends fan out concurrently, URL-deduped. Toggle backends, set API keys, tune globals — saves apply immediately.",
			save: "Save",
			discard: "Discard",
			dirty: "Unsaved changes",
			saved: "Saved",
			saving: "Saving…",
			failed: "Save failed",
			reset: "Reset",
			overridden: "customized",
			keyLabel: "{id} API Key",
			keyHint: "Stored into the credential store on save; leave blank to keep current",
			keySet: "configured",
			keyUnset: "not set",
			togglesTitle: "Enabled backends",
			globalsTitle: "Global parameters",
		};

		//#region styles
		const css = ".wsc-card{display:flex;flex-direction:column;gap:14px}.wsc-sectionTitle{font-size:13px;font-weight:600;opacity:.75;margin:4px 0 0}.wsc-toggles{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px}.wsc-toggle{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-subtle);cursor:pointer;font-size:13px;color:var(--dsw-alias-label-primary);background:0 0}.wsc-toggle input{accent-color:var(--dsw-alias-accent-primary)}.wsc-input,.wsc-keyInput{box-sizing:border-box;width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-subtle);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit}.wsc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}.wsc-fieldHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px}.wsc-label{font-size:12px;opacity:.8}.wsc-badge{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-subtle)}.wsc-badgeOn{color:var(--dsw-alias-accent-primary);border-color:var(--dsw-alias-accent-primary)}.wsc-hint{font-size:11px;opacity:.55;margin:3px 0 0}.wsc-actions{display:flex;gap:8px;align-items:center}.wsc-btn{cursor:pointer;border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-family:inherit;background:var(--dsw-alias-accent-primary);color:#fff}.wsc-btnGhost{background:0 0;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-subtle)}.wsc-btn:disabled{opacity:.5;cursor:default}.wsc-status{font-size:12px;opacity:.7}";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"@deepseek-ai/dsh-websearch/card\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-websearch";
			tag.dataset.pluginCss = "@deepseek-ai/dsh-websearch/card";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		/** Build a snapshot store (same shape as client-runtime's createSnapshotStore). */
		function createStore(initial) {
			let snap = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => snap,
				subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
				set: (next) => { snap = next; listeners.forEach((l) => l()); },
			};
		}

		function useStore(store, selector = (s) => s) {
			return react.useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()));
		}

		/**
		 * Card state machine: reads the bound settings scope snapshot, stages edits,
		 * writes section fields through scope.set/unset and secrets via credentials.
		 */
		class UnifiedSearchCardController {
			constructor(scope, connection, remote) {
				this.scope = scope;
				this.connection = connection;
				this.remote = remote;
				this.staged = new Map();      // field -> { text } | { clear: true }
				this.stagedKeys = new Map();  // envRef -> text
				this.keyState = new Map();    // envRef -> {configured}
				this.saving = false;
				this.failed = false;
				this.store = createStore(this.projection());
				this.scope.subscribe(() => this.republish());
			}

			sectionValue(field) {
				return this.scope.getSnapshot().value?.[field];
			}

			fieldState(field) {
				const staged = this.staged.get(field);
				const current = this.sectionValue(field);
				if (staged === undefined) return { text: current === undefined ? "" : String(current), overridden: false };
				return { text: staged.clear ? "" : staged.text, overridden: !staged.clear };
			}

			projection() {
				const snap = this.scope.getSnapshot();
				return {
					ready: snap.status === "ready",
					writable: snap.writable,
					value: snap.value ?? {},
					keyState: Object.fromEntries(this.keyState),
					stagedKeys: Object.fromEntries([...this.stagedKeys].map(([k, v]) => [k, v.text])),
					stagedCount: this.staged.size + this.stagedKeys.size,
					stagedText: (field) => {
						const s = this.staged.get(field);
						return s ? (s.clear ? "" : s.text) : undefined;
					},
					saving: this.saving,
					failed: this.failed,
					version: (this.staged.size + ":" + [...this.staged.keys()].join(",")),
				};
			}

			republish() { this.store.set(this.projection()); }

			edit(field, text) { this.staged.set(field, { text }); this.republish(); }
			reset(field) { this.staged.delete(field); this.republish(); }
			editKey(envRef, text) { this.stagedKeys.set(envRef, { text }); this.republish(); }

			/** Toggles write immediately (no staging); globals/keys stage + save. */
			async setToggle(id, checked) {
				await this.scope.set("enable" + id.charAt(0).toUpperCase() + id.slice(1), checked);
				this.republish();
			}

			async readCredential(ref) {
				try {
					const res = await this.connection.api.credentials.describe({ refs: [ref] });
					if (!res.result.ok) return;
					const view = res.result.value.credentials[ref];
					this.keyState.set(ref, { configured: view?.configured ?? false });
				} catch { /* ignore */ }
				this.republish();
			}

			refreshAllCredentials() {
				for (const b of BACKENDS) if (b.keyEnv) this.readCredential(b.keyEnv);
			}

			async save() {
				if (this.saving) return;
				this.saving = true; this.failed = false; this.republish();
				const doneFields = [];
				const doneKeys = [];
				try {
					for (const [field, staged] of this.staged) {
						// Empty draft clears the override so the schema default applies again.
						if (staged.clear || staged.text === "") { await this.scope.unset(field); doneFields.push(field); continue; }
						if (GLOBAL_FIELDS.includes(field)) {
							const num = Number(staged.text);
							// Non-numeric input: keep the draft so the user can correct it.
							if (Number.isNaN(num)) { this.failed = true; continue; }
							await this.scope.set(field, num);
							doneFields.push(field);
						} else {
							await this.scope.set(field, staged.text);
							doneFields.push(field);
						}
					}
					for (const [ref, staged] of this.stagedKeys) {
						const value = staged.text.trim();
						if (value !== "") {
							await this.connection.api.credentials.set({ ref, value });
							this.keyState.set(ref, { configured: true });
							doneKeys.push(ref);
						}
					}
					for (const f of doneFields) this.staged.delete(f);
					for (const k of doneKeys) this.stagedKeys.delete(k);
				} catch { this.failed = true; }
				this.saving = false;
				this.republish();
			}

			inject() {
				return {
					hooks: {
						useCard: () => useStore(this.store),
						edit: (f, t) => this.edit(f, t),
						setToggle: (id, checked) => this.setToggle(id, checked),
						reset: (f) => this.reset(f),
						editKey: (r, t) => this.editKey(r, t),
						save: () => this.save(),
						discard: () => { this.staged.clear(); this.stagedKeys.clear(); this.failed = false; this.republish(); },
					},
				};
			}
		}

		/** Toggle row for one backend. */
		function ToggleRow(props) {
			const b = props.backend;
			// The Host serves schema-resolved values, so defaults arrive materialized;
			// no client-side default list to drift against the server.
			const checked = props.value === true;
			return react_jsx_runtime.jsxs("label", { className: "wsc-toggle", children: [
				react_jsx_runtime.jsx("input", {
					type: "checkbox",
					checked,
					onChange: (e) => props.onChange(e.target.checked),
				}),
				react_jsx_runtime.jsx("span", { children: b.label }),
			] });
		}

		/** The card root. */
		function UnifiedSearchCard(props) {
			const card = props.card;
			const state = card.useCard();
			if (!state.ready) {
				return react_jsx_runtime.jsx("p", { style: { margin: 0, fontSize: 12, opacity: .6 }, children: "…" });
			}

			const toggleField = (id) => "enable" + id.charAt(0).toUpperCase() + id.slice(1);

			return react_jsx_runtime.jsxs("div", { className: "wsc-card", children: [
				react_jsx_runtime.jsx("p", { style: { margin: 0, fontSize: 12, opacity: .65 }, children: props.t("description") }),
				react_jsx_runtime.jsx("h4", { className: "wsc-sectionTitle", children: props.t("togglesTitle") }),
				react_jsx_runtime.jsx("div", { className: "wsc-toggles", children: BACKENDS.map((b) =>
					react_jsx_runtime.jsx(ToggleRow, {
						backend: b,
						value: state.value[toggleField(b.id)],
						onChange: (checked) => card.setToggle(b.id, checked),
					}, b.id)
				) }),
				react_jsx_runtime.jsx("h4", { className: "wsc-sectionTitle", children: props.t("globalsTitle") }),
				react_jsx_runtime.jsxs("div", { className: "wsc-grid", children: [
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsx("div", { className: "wsc-fieldHead", children: react_jsx_runtime.jsx("span", { className: "wsc-label", children: "numResults" }) }),
						react_jsx_runtime.jsx("input", { className: "wsc-input", value: state.stagedText("numResults") ?? String(state.value.numResults ?? ""), onChange: e => card.edit("numResults", e.target.value), inputMode: "numeric" }),
					] }),
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsx("div", { className: "wsc-fieldHead", children: react_jsx_runtime.jsx("span", { className: "wsc-label", children: "concurrency" }) }),
						react_jsx_runtime.jsx("input", { className: "wsc-input", value: state.stagedText("concurrency") ?? String(state.value.concurrency ?? ""), onChange: e => card.edit("concurrency", e.target.value), inputMode: "numeric" }),
					] }),
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsx("div", { className: "wsc-fieldHead", children: react_jsx_runtime.jsx("span", { className: "wsc-label", children: "backendTimeoutMs" }) }),
						react_jsx_runtime.jsx("input", { className: "wsc-input", value: state.stagedText("backendTimeoutMs") ?? String(state.value.backendTimeoutMs ?? ""), onChange: e => card.edit("backendTimeoutMs", e.target.value), inputMode: "numeric" }),
					] }),
				] }),
				react_jsx_runtime.jsx("h4", { className: "wsc-sectionTitle", children: "API Keys" }),
				react_jsx_runtime.jsx("div", { className: "wsc-grid", children: BACKENDS.filter((b) => b.keyEnv).map((b) =>
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsxs("div", { className: "wsc-fieldHead", children: [
							react_jsx_runtime.jsx("span", { className: "wsc-label", children: props.t("keyLabel", { id: b.id }) }),
							react_jsx_runtime.jsx("span", { className: "wsc-badge" + (state.keyState[b.keyEnv]?.configured ? " wsc-badgeOn" : ""), children: state.keyState[b.keyEnv]?.configured ? props.t("keySet") : props.t("keyUnset") }),
						] }),
						react_jsx_runtime.jsx("input", {
							className: "wsc-keyInput", type: "password", autoComplete: "off",
							placeholder: b.keyEnv,
							value: state.stagedKeys[b.keyEnv] ?? "",
							onChange: (e) => card.editKey(b.keyEnv, e.target.value),
						}),
						react_jsx_runtime.jsx("p", { className: "wsc-hint", children: props.t("keyHint") }),
					] }, b.id)
				) }),
				react_jsx_runtime.jsxs("div", { className: "wsc-actions", children: [
					react_jsx_runtime.jsx("button", { className: "wsc-btn", disabled: state.saving, onClick: () => card.save(), children: state.saving ? props.t("saving") : props.t("save") }),
					(state.stagedCount > 0) && react_jsx_runtime.jsx("button", { className: "wsc-btn wsc-btnGhost", onClick: () => card.discard(), children: props.t("discard") }),
					state.failed && react_jsx_runtime.jsx("span", { className: "wsc-status", children: props.t("failed") }),
				] }),
			] });
		}

		/** Plugin entry: register the card into the settings plugins page. */
		const inject = ["slots", "locale", "connection", "remote", "settingsScope"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "websearch: copy dictionaries");
			const controller = new UnifiedSearchCardController(
				ctx.settingsScope.bind({ namespace: PLUGIN_NS }),
				ctx.get("connection"),
				ctx.get("remote"),
			);
			ctx.effect(() => ctx.remote.$on("credentials/updated", () => controller.refreshAllCredentials()), "websearch: credential invalidations");
			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register({
					name: "settings.plugin.item",
					key: PLUGIN_NS,
					locale: NS,
					inject: () => controller.inject(),
				}, UnifiedSearchCard);
			});
			controller.refreshAllCredentials();
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
