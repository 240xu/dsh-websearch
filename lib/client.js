window.__ModuleLoader__.load({
	id: "@240xu/dsh-websearch",
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
			{ id: "searxng", keyEnv: "SEARXNG_API_KEY", optionalKey: true, label: "SearXNG (元搜索)" },
			{ id: "brave", keyEnv: "BRAVE_API_KEY", label: "Brave Search" },
			{ id: "tavily", keyEnv: "TAVILY_API_KEY", label: "Tavily (AI)" },
			{ id: "serper", keyEnv: "SERPER_API_KEY", label: "Serper.dev" },
			{ id: "mojeek", keyEnv: "MOJEEK_API_KEY", label: "Mojeek" },
			{ id: "deepseek", keyEnv: "DEEPSEEK_API_KEY", label: "DeepSeek" },
			{ id: "anthropic", keyEnv: "ANTHROPIC_API_KEY", label: "Anthropic" },
			{ id: "openai", keyEnv: "OPENAI_API_KEY", label: "OpenAI" },
			// these two are metered, opt-in backends. They are
			// deliberately NOT in KEYLESS: listing them under "keyless, ready to
			// use" would imply zero cost / zero limits, while the hosted keyless
			// tier is rate limited and its exact ceiling is not published. They
			// still accept an optional key (OPTIONAL_KEYS) to raise limits.
			{ id: "firecrawl", keyEnv: "FIRECRAWL_API_KEY", optionalKey: true, metered: true, label: "Firecrawl (免 Key · 有额度 · 默认关)" },
			{ id: "tinyfish", keyEnv: "TINYFISH_API_KEY", optionalKey: true, metered: true, label: "TinyFish (免 Key · 30/分·50/日 · 默认关)" },
		];
		const GLOBAL_FIELDS = ["numResults", "concurrency", "backendTimeoutMs"];
		/** Enum-valued settings (validated client-side, saved as strings). */
		const SELECT_FIELDS = {
			recency: ["any", "day", "week", "month", "year"],
			dedupStrategy: ["url", "url+title"],
		};
		/** Boolean settings staged as "true"/"false" strings by the selects. */
		const BOOLEAN_FIELDS = ["rerank", "safeSearch", "resultTelemetry"];
		// split metered, opt-in backends out of the
		// "keyless / ready to use" group. They work without a key but are rate
		// limited and default OFF, so a separate section with an explicit hint
		// prevents the misleading impression of a free unlimited backend.
		const METERED = BACKENDS.filter((b) => b.metered);
		const KEYLESS = BACKENDS.filter((b) => (!b.keyEnv || b.optionalKey) && !b.metered);
		const KEYED = BACKENDS.filter((b) => b.keyEnv && !b.optionalKey);
		const OPTIONAL_KEYS = BACKENDS.filter((b) => b.keyEnv && b.optionalKey);

		/** Where the user goes to get/rotate each key. */
		const KEY_URLS = {
			brave: "https://api-dashboard.search.brave.com/app/keys",
			tavily: "https://app.tavily.com/home",
			serper: "https://serper.dev/api-key",
			mojeek: "https://www.mojeek.com/services/search/web-search-api/",
			deepseek: "https://platform.deepseek.com/api_keys",
			anthropic: "https://console.anthropic.com/settings/keys",
			openai: "https://platform.openai.com/api-keys",
		};

		const zh = {
			nav: "搜索",
			groupFree: "免密钥（开箱即用）",
			groupKeyed: "需要 API Key",
			// metered/opt-in section copy (zh).
			groupMetered: "计量型（免 Key 但有额度，默认关）",
			meteredHint: "官方 hosted keyless tier 按 IP/日限额并可能返回 429；启用前请确认额度。填可选 Key 可提升限额。",
			statusEnabled: "已启用后端",
			statusKeys: "已配置密钥",
			// status bar labels for the metered section.
			statusMetered: "计量型",
			statusOffByDefault: "默认关",
			keyMissing: "缺密钥",
			unsavedHint: "有未保存的修改", savedOk: "已保存 ✓",
			title: "统一搜索 (Unified Search)",
			description: "聚合网络搜索：多后端并发 fan-out、URL 去重合并（含 2 个默认关的计量型后端）。开关后端、填 API Key、调参数，保存即生效。",
			save: "保存",
			discard: "放弃修改",
			dirty: "有未保存修改",
			saved: "已保存",
			saving: "保存中…",
			failed: "保存失败",
			reset: "重置",
			overridden: "已自定义",
			keyLabel: "{id} API Key",
			getKey: "获取 Key ↗",
			// the switch is immediate, the key needs Save.
			keySaveModeHint: "开关即时生效；密钥填写后需点「保存」写入凭证库",
			keySet: "已配置",
			keyUnset: "未配置",
			togglesTitle: "启用后端",
			globalsTitle: "全局参数",
			numResultsLabel: "结果条数",
			concurrencyLabel: "并发数",
			timeoutLabel: "后端超时 (ms)",
			saveFailed: "保存失败",
			conflictHint: "其他端已修改，请先刷新",
			shapingTitle: "结果策略",
			recencyLabel: "时间范围",
			langLabel: "搜索语言",
			safeSearchLabel: "安全搜索",
			dedupLabel: "去重策略",
			rerankLabel: "相关性重排",
			on: "开",
			off: "关",
			recencyAny: "不限",
			recencyDay: "一天内",
			recencyWeek: "一周内",
			recencyMonth: "一月内",
			recencyYear: "一年内",
			dedupUrl: "按链接",
			dedupTitle: "链接 + 标题（合并转载）",
			langPlaceholder: "如 en、zh-CN，留空为默认",
						envProvided: "环境变量提供",			readOnly: "只读，无需填写",			conflict: "设置已在其他端被修改，请重试",			keyFailed: "该 Key 保存失败",
			keyReadFailed: "密钥状态读取失败，请稍后重试",
			telemetryLabel: "结果健康遥测",
			fallbackHint: "全部后端已关闭：搜索将回退到默认免 Key 后端（计量型仍保持关闭）",
			invalidFields: "以下字段未通过校验：",
			readOnlyScope: "当前配置只读（可能由宿主锁定）",
			unavailable: "设置暂不可用：宿主没有返回配置快照（服务未就绪或路由未挂载）。",
			retry: "重试",
			toggleFailed: "开关未生效",
			optionalTitle: "可选 Key（私有实例 / 提升计量型额度）",
		};
		const en = {
			nav: "Web Search",
			groupFree: "Keyless (ready to use)",
			groupKeyed: "Requires API key",
			// metered/opt-in section copy (en).
			groupMetered: "Metered (keyless but rate limited, off by default)",
			meteredHint: "The hosted keyless tier is limited per IP/day and may return 429; check quotas before enabling. An optional API key raises the limits.",
			statusEnabled: "Backends enabled",
			statusKeys: "Keys configured",
			// status bar labels for the metered section.
			statusMetered: "Metered",
			statusOffByDefault: "off by default",
			keyMissing: "key missing",
			unsavedHint: "You have unsaved changes", savedOk: "Saved ✓",
			title: "Unified Search",
			description: "Aggregated web search: multiple backends fan out concurrently, URL-deduped (incl. 2 metered backends that are off by default). Toggle backends, set API keys, tune globals — saves apply immediately.",
			save: "Save",
			discard: "Discard",
			dirty: "Unsaved changes",
			saved: "Saved",
			saving: "Saving…",
			failed: "Save failed",
			reset: "Reset",
			overridden: "customized",
			keyLabel: "{id} API Key",
			getKey: "Get key ↗",
			// the switch is immediate, the key needs Save.
			keySaveModeHint: "The switch applies immediately; the key is written to the credential store when you press Save",
			keySet: "configured",
			keyUnset: "not set",
			togglesTitle: "Enabled backends",
			globalsTitle: "Global parameters",
			numResultsLabel: "Results",
			concurrencyLabel: "Concurrency",
			timeoutLabel: "Backend timeout (ms)",
			saveFailed: "Save failed",
			conflictHint: "Changed elsewhere — refresh first",
			shapingTitle: "Result shaping",
			recencyLabel: "Recency",
			langLabel: "Language",
			safeSearchLabel: "Safe search",
			dedupLabel: "Dedup strategy",
			rerankLabel: "Relevance rerank",
			on: "On",
			off: "Off",
			recencyAny: "Any time",
			recencyDay: "Past day",
			recencyWeek: "Past week",
			recencyMonth: "Past month",
			recencyYear: "Past year",
			dedupUrl: "By URL",
			dedupTitle: "URL + title (merge syndication)",
			langPlaceholder: "e.g. en, zh-CN; blank = backend default",
			envProvided: "provided by env",
			readOnly: "read-only, nothing to fill",
			conflict: "Changed elsewhere - please retry",
			keyFailed: "failed to save this key",
			keyReadFailed: "could not read key status, please retry later",
			telemetryLabel: "Result health telemetry",
			fallbackHint: "All backends off: search falls back to the default keyless four (metered backends stay off).",
			invalidFields: "Fields failed validation:",
			readOnlyScope: "Configuration is read-only (locked by host?)",
			unavailable: "Settings are unavailable: the host returned no configuration snapshot (service not ready or route not mounted).",
			retry: "Retry",
			toggleFailed: "Toggle failed",
			optionalTitle: "Optional keys (private instance / higher metered limits)",
		};

		//#region styles
		const css = ".wsc-card{display:flex;flex-direction:column;gap:14px}.wsc-sectionTitle{font-size:13px;font-weight:600;opacity:.75;margin:4px 0 0}.wsc-toggles{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px}.wsc-toggle{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;font-size:13px;color:var(--dsw-alias-label-primary);background:0 0}.wsc-toggle input{accent-color:var(--dsw-alias-brand-primary)}.wsc-input,.wsc-keyInput{box-sizing:border-box;width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit}.wsc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}.wsc-fieldHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px}.wsc-label{font-size:12px;opacity:.8}.wsc-badge{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}.wsc-badgeOn{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}.wsc-hint{font-size:11px;opacity:.55;margin:3px 0 0}.wsc-actions{display:flex;gap:8px;align-items:center}.wsc-btn{cursor:pointer;border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-family:inherit;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}.wsc-btn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.wsc-btnGhost{background:0 0;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2)}.wsc-btn:disabled{opacity:.5;cursor:default}.wsc-status{font-size:12px;opacity:.7}";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-websearch/card\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@240xu/dsh-websearch";
			tag.dataset.pluginCss = "dsh-websearch/card";
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

		/**
		 * Settings bridge for 0.2.x builds where the legacy `settingsScope`
		 * client service is gone: the same snapshot/subscribe/set/unset surface
		 * the card controller expects, backed by this plugin's fenced settings
		 * route. Writes land in the volatile profile entry the host provider
		 * resolves from on the next call -- no second settings store.
		 */
		class SettingsRoutesBridge {
			constructor() {
				this.store = createStore({
					status: "loading",
					writable: false,
					value: undefined,
					base: undefined,
					user: undefined,
					revision: undefined,
					mode: "routes",
					unavailable: false,
					reason: undefined,
				});
				// Serialise writes: a queued write must read the revision only
				// when its turn comes, otherwise two concurrent toggles both
				// send revision=0 and the second is rejected as a conflict.
				this.writeQueue = Promise.resolve();
				// A load starts before a write but can land after it; applying
				// that snapshot would roll the UI back and restore a stale
				// revision (the next write is then rejected as a conflict).
				this.loadSeq = 0;
			}

			getSnapshot() { return this.store.getSnapshot(); }
			subscribe(listener) { return this.store.subscribe(listener); }

			accept(payload) {
				if (payload === null || typeof payload !== "object" || payload.ok !== true) {
					// Keep the card rendered (status ready) but explain the actual state:
					// a 404/503 is "settings unavailable", not "you configured nothing".
					this.store.set({
						status: "ready",
						writable: false,
						value: {},
						base: undefined,
						user: undefined,
						revision: undefined,
						mode: "routes",
						unavailable: true,
						reason: payload !== null && typeof payload === "object" && typeof payload.reason === "string"
							? payload.reason
							: "settings-unavailable",
					});
					return;
				}
				if (payload.writable === false) {
					// The host answered with a real snapshot but marked it read-only.
					this.store.set({
						status: "ready",
						writable: false,
						value: payload.value ?? {},
						base: payload.base,
						user: payload.user,
						revision: payload.revision,
						mode: "routes",
						unavailable: false,
						reason: payload.reason,
					});
					return;
				}
				this.store.set({
					status: "ready",
					writable: true,
					value: payload.value,
					base: payload.base,
					user: payload.user,
					revision: payload.revision,
					mode: "routes",
					unavailable: false,
					reason: undefined,
				});
			}

			async load() {
				const seq = ++this.loadSeq;
				try {
					const response = await fetch("/api/unified-search/settings", { credentials: "same-origin", headers: { accept: "application/json" } });
					const payload = await response.json().catch(() => undefined);
					if (seq !== this.loadSeq) return;
					this.accept(response.status === 404 ? undefined : payload);
				} catch (_noRoutes) {
					if (seq === this.loadSeq) this.accept(undefined);
				}
			}

			write(ops) {
				const run = () => this.writeNow(ops);
				const result = this.writeQueue.then(run, run);
				this.writeQueue = result.then(() => undefined, () => undefined);
				return result;
			}

			async writeNow(ops) {
				const expectedRevision = this.store.getSnapshot().revision;
				const response = await fetch("/api/unified-search/settings", {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json", accept: "application/json" },
					// eslint-disable-next-line object-shorthand
					body: JSON.stringify(expectedRevision === undefined ? { ops } : { ops, expectedRevision }),
				});
				const payload = await response.json().catch(() => undefined);
				if (response.status === 409 || (payload !== undefined && payload.code === "SETTINGS_CONFLICT")) throw new Error("SETTINGS_CONFLICT");
				if (!response.ok || payload === undefined || payload.ok !== true) {
					throw new Error(payload !== undefined && payload.error !== undefined ? String(payload.error) : "settings request failed (" + response.status + ")");
				}
				this.loadSeq += 1;
				this.accept(payload);
			}

			set(field, value) { return this.write([{ op: "set", path: [field], value }]); }
			unset(field) { return this.write([{ op: "unset", path: [field] }]); }
		}

		/**
		 * Card state machine: reads the bound settings scope snapshot, stages edits,
		 * writes section fields through scope.set/unset and secrets via credentials.
		 */
		// Host errors can carry internal paths and reference names. Only a
		// stable, shape-checked error code is safe to display in the card.
		function safeFailureReason(err) {
			const code = err && typeof err === "object" && typeof err.code === "string" ? err.code : "";
			return /^[a-z][a-z0-9/_-]{0,60}$/i.test(code) ? code : "write rejected";
		}

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
				this.conflict = false;
				// A toggle write is independent of Save; its failure must not be
				// cleared only by a later Save, nor persist after a retry succeeds.
				this.toggleFailed = false;
				this.toggleConflict = false;
				this.failedKeys = new Map(); // envRef -> failure reason
				// Credential READ failures, distinct from SAVE failures above.
				// Only a fixed code is stored; raw host errors are never kept.
				this.readErrors = new Map();
				this.failedFields = new Set();
				this.savedAt = 0;
				// Per-ref read sequence: a describe() started before a successful
				// write must not repaint that key as "not configured".
				this.credSeq = new Map();
				this.disposed = false;
				this.store = createStore(this.projection());
				this.unsubscribe = this.scope.subscribe(() => this.republish());
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

			/**
			 * Project the controller state into the snapshot the card renders from.
			 * Everything the render layer needs is derived here, so the store never
			 * exposes the raw staging maps.
			 */
			projection() {
				const snap = this.scope.getSnapshot();
				return {
					ready: snap.status === "ready",
					writable: snap.writable,
					unavailable: snap.unavailable === true,
					reason: snap.reason,
					revision: snap.revision,
					value: snap.value ?? {},
					keyState: Object.fromEntries(this.keyState),
					stagedKeys: Object.fromEntries([...this.stagedKeys].map(([k, v]) => [k, v.text])),
					stagedCount: this.staged.size + this.stagedKeys.size,
					savedAt: this.savedAt,
					stagedText: (field) => {
						const s = this.staged.get(field);
						return s ? (s.clear ? "" : s.text) : undefined;
					},
					conflict: this.conflict,
					failedKeys: [...this.failedKeys].map(([ref, reason]) => ({ ref, reason })),
					readErrors: [...this.readErrors].map(([ref, reason]) => ({ ref, reason })),
					failedFields: [...this.failedFields],
					saving: this.saving,
					failed: this.failed,
					toggleFailed: this.toggleFailed,
					toggleConflict: this.toggleConflict,
					version: (this.staged.size + ":" + [...this.staged.keys()].join(",")),
				};
			}

			/** Push the current projection to the store and notify subscribers. */
			republish() {
				if (this.disposed) return;
				this.store.set(this.projection());
			}

			/** Detach from the host scope; late responses must not publish. */
			dispose() {
				this.disposed = true;
				if (typeof this.unsubscribe === "function") this.unsubscribe();
			}

			/** Re-read the settings snapshot (used by the unavailable-state retry). */
			reload() {
				return typeof this.scope.load === "function" ? this.scope.load() : undefined;
			}

			/** Stage a field edit (clears the saved marker so the card shows "unsaved"). */
			edit(field, text) { this.savedAt = 0; this.staged.set(field, { text }); this.republish(); }
			/** Drop a staged field edit; the stored value is untouched. */
			reset(field) { this.staged.delete(field); this.republish(); }
			/** Stage a credential draft; a blank draft is never staged so Save can drain. */
			editKey(envRef, text) {
				this.savedAt = 0;
				// A blank draft is not a pending change; staging it would keep
				// the Save button enabled with nothing to write.
				if (String(text).trim() === "") this.stagedKeys.delete(envRef);
				else this.stagedKeys.set(envRef, { text });
				this.republish();
			}

			/** Toggles write immediately (no staging); globals/keys stage + save. */
			async setToggle(id, checked) {
				// A retry supersedes the previous toggle error. Keep the message
				// while the new write is in flight so the card does not flicker.
				this.toggleFailed = false;
				this.toggleConflict = false;
				try {
					await this.scope.set("enable" + id.charAt(0).toUpperCase() + id.slice(1), checked);
				} catch (err) {
					this.toggleFailed = true;
					this.toggleConflict = String(err).includes("SETTINGS_CONFLICT");
					this.failed = false;
					this.conflict = false;
					// The host may have committed the write even when the
					// response failed. Resync instead of leaving the stale
					// pre-write value on screen. Report only the conflict
					// classification, never the raw error text.
					if (typeof console !== "undefined" && typeof console.warn === "function") {
						console.warn("websearch: toggle write failed", { conflict: this.conflict });
					}
					if (typeof this.scope.load === "function") {
						try { await this.scope.load(); } catch { /* keep current snapshot */ }
					}
				}
				this.republish();
			}

			async readCredential(ref) {
				const seq = (this.credSeq.get(ref) ?? 0) + 1;
				this.credSeq.set(ref, seq);
				let readFailed = false;
				let reason;
				try {
					let view;
					// Guard the namespace access: an undeclared remote service throws on
					// access, and a swallowed error would leave the configured badge dark.
					let api;
					try { api = this.remote === undefined ? undefined : this.remote.credentials; } catch { api = undefined; }
					if (api !== undefined && typeof api.describe === "function") {
						// 0.2.x remote face: RemoteResult<Record<ref, CredentialInfo>>.
						const res = await api.describe([ref]);
						// Judge the RemoteResult envelope before unwrapping: `ok:false` is a
						// read failure, not an unconfigured credential. Do not fall
						// through to the legacy connection branch, which could surface
						// a stale value. failedKeys is reserved for save failures.
						if (res !== null && typeof res === "object" && res.ok === false) {
							readFailed = true;
							reason = "credential/read-failed";
						} else {
							const record = res !== null && typeof res === "object" && res.value !== undefined ? res.value : res;
							const byRef = record !== null && typeof record === "object" && record.credentials !== undefined ? record.credentials : record;
							view = byRef !== null && typeof byRef === "object" ? byRef[ref] : undefined;
						}
					}
					if (!readFailed && view === undefined && this.connection !== undefined && this.connection.api !== undefined && this.connection.api.credentials !== undefined) {
						// Older line: the connection controller's credentials API.
						const res = await this.connection.api.credentials.describe({ refs: [ref] });
						if (res?.result?.ok) view = res.result.value.credentials[ref];
					}
					if (!readFailed && view !== undefined && seq === this.credSeq.get(ref)) {
						this.keyState.set(ref, { configured: view.configured === true, writable: view.writable !== false });
						this.readErrors.delete(ref);
					}
				} catch {
					reason = "credential/read-failed";
				} finally {
					// Only a fixed code is stored; host error text may contain
					// internal paths or credential reference names.
					if (reason !== undefined && seq === this.credSeq.get(ref)) {
						this.readErrors.set(ref, safeFailureReason({ code: reason }));
					}
					this.republish();
				}
			}

			async writeCredential(ref, value) {
				// The namespace access may throw on hosts that do not register
				// `remote.credentials`; guard it so the older connection API can
				// still serve as fallback. `set()` resolves with a RemoteResult
				// envelope instead of throwing on rejection, so `ok === false`
				// must be treated as a failure.
				let api;
				try { api = this.remote === undefined ? undefined : this.remote.credentials; } catch { api = undefined; }
				if (api !== undefined && typeof api.set === "function") {
					const res = await api.set(ref, value);
					const rejected = res !== null && typeof res === "object" && res.ok === false;
					if (rejected) throw new Error(res.error?.message ?? "credential write rejected");
					this.credSeq.set(ref, (this.credSeq.get(ref) ?? 0) + 1);
					return;
				}
				if (this.connection !== undefined && this.connection.api !== undefined && this.connection.api.credentials !== undefined && typeof this.connection.api.credentials.set === "function") {
					const res = await this.connection.api.credentials.set({ ref, value });
					const rejected = res !== null && typeof res === "object" && (res.ok === false || res.result?.ok === false);
					if (rejected) throw new Error(res.error?.message ?? res.result?.error?.message ?? "credential write rejected");
					this.credSeq.set(ref, (this.credSeq.get(ref) ?? 0) + 1);
					return;
				}
				throw new Error("credentials service unavailable");
			}

			refreshAllCredentials() {
				for (const b of BACKENDS) if (b.keyEnv) this.readCredential(b.keyEnv);
			}

			/**
			 * Commit every staged field and credential draft.
			 *
			 * Entries are snapshotted before each await so an edit that arrives while a
			 * write is in flight keeps its own unsaved state instead of being deleted
			 * as if it had been saved. A second call while one is running is a no-op.
			 */
			async save() {
				if (this.saving) return;
				this.saving = true; this.failed = false;
			this.conflict = false; this.failedFields.clear(); this.republish();
				const doneFields = [];
				const doneKeys = [];
				// Snapshot the staged entry object for each field/key we save.
				// edit()/editKey() replace the entry with a NEW object, so comparing
				// by identity tells us whether the user typed again while the
				// awaits were in flight. Those newer edits must not be discarded
				// or reported as saved.
				const savedFieldRefs = new Map();
				const savedKeyRefs = new Map();
				try {
					for (const [field, staged] of this.staged) {
						// Snapshot the entry BEFORE any await. edit() replaces the staged
						// entry with a new object, so identity comparison later detects an edit
						// that arrived while the awaits were in flight. Recording after the
						// await would capture the NEW edit and delete it as if saved.
						savedFieldRefs.set(field, staged);
						// Empty draft clears the override so the schema default applies again.
						if (staged.clear || staged.text === "") { await this.scope.unset(field); doneFields.push(field); continue; }
						if (SELECT_FIELDS[field]) {
							if (!SELECT_FIELDS[field].includes(staged.text)) { this.failed = true; this.failedFields.add(field); continue; }
							await this.scope.set(field, staged.text);
							doneFields.push(field);
							continue;
						}
						if (BOOLEAN_FIELDS.includes(field)) {
							if (staged.text !== "true" && staged.text !== "false") { this.failed = true; this.failedFields.add(field); continue; }
							await this.scope.set(field, staged.text === "true");
							doneFields.push(field);
							continue;
						}
						if (GLOBAL_FIELDS.includes(field)) {
							const num = Number(staged.text);
							// Mirror the server schema bounds client-side so bad input is
							// caught in the UI instead of a failed Host round-trip.
							const BOUNDS = {
								numResults: [1, 50],
								concurrency: [1, 10],
								backendTimeoutMs: [1000, 120000],
							};
							const [lo, hi] = BOUNDS[field] ?? [-Infinity, Infinity];
							if (!Number.isFinite(num) || num < lo || num > hi) { this.failed = true; this.failedFields.add(field); continue; }
							await this.scope.set(field, num);
							doneFields.push(field);
						} else {
							await this.scope.set(field, staged.text);
							doneFields.push(field);
						}
					}
					for (const [ref, staged] of this.stagedKeys) {
						// Snapshot before any await, same reason as the field loop.
						savedKeyRefs.set(ref, staged);
						const value = staged.text.trim();
						if (value !== "") {
							try {
								await this.writeCredential(ref, value);
								this.keyState.set(ref, { configured: true, writable: true });
								doneKeys.push(ref);
								this.failedKeys.delete(ref);
							} catch (keyErr) {
								// env-shadowed reference (fail-loud doctrine): isolate so other keys still land.
								this.failed = true;
								this.failedKeys.set(ref, safeFailureReason(keyErr));
								void keyErr;
							}
						} else {
							// Consume a blank draft so the Save button drains.
							doneKeys.push(ref);
						}
					}
					for (const f of doneFields) {
						if (this.staged.get(f) === savedFieldRefs.get(f)) this.staged.delete(f);
					}
					for (const k of doneKeys) {
						if (this.stagedKeys.get(k) === savedKeyRefs.get(k)) this.stagedKeys.delete(k);
					}
					// Only claim "saved" when nothing is left pending. An edit
					// that arrived during the awaits keeps its own unsaved state.
					if (!this.failed && (doneFields.length > 0 || doneKeys.length > 0)
					    && this.staged.size === 0 && this.stagedKeys.size === 0) this.savedAt = Date.now();
				} catch (err) {
					this.failed = true;
					this.conflict = String(err).includes("SETTINGS_CONFLICT");
					// Without a reload the stale expectedRevision makes every
					// subsequent Save fail the same way. Staged edits survive, so
					// the user can inspect and retry after the refresh.
					if (this.conflict) {
						try { await this.reload(); } catch { /* keep the conflict notice */ }
					}
				}
				this.saving = false;
				this.republish();
			}

			/**
			 * Props handed to the settings section: the store as an observable hook
			 * plus the actions the card calls.
			 */
			inject() {
				// Slot contract: hooks.{name} must be an observable store; the renderer
				// converts it into props.use{Name} (observableHook). Actions go top-level.
				return {
					hooks: { unifiedSearchCard: this.store },
					edit: (f, t) => this.edit(f, t),
					setToggle: (id, checked) => this.setToggle(id, checked),
					reset: (f) => this.reset(f),
					editKey: (r, t) => this.editKey(r, t),
					save: () => this.save(),
					retry: () => this.reload(),
					discard: () => { this.staged.clear(); this.stagedKeys.clear(); this.failed = false; this.conflict = false; this.failedFields.clear(); this.failedKeys.clear(); this.republish(); },
				};
			}
		}

		/** Toggle row for one backend (keyless / metered backends). */
		function ToggleRow(props) {
			const b = props.backend;
			// The Host serves schema-resolved values, so defaults arrive materialized;
			// no client-side default list to drift against the server.
			const checked = props.value === true;
			// Status dot: green keyless-or-keyed, amber enabled-but-key-missing.
			const needsKey = !!b.keyEnv && !b.optionalKey && !props.keyConfigured;
			const dotColor = needsKey ? (checked ? "#e6a700" : "#888") : "#2ea043";
			return react_jsx_runtime.jsxs("label", { className: "wsc-toggle", style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
				react_jsx_runtime.jsx("input", {
					type: "checkbox",
					checked,
					onChange: (e) => props.onChange(e.target.checked),
				}),
				react_jsx_runtime.jsx("span", { style: { width: 8, height: 8, borderRadius: "50%", background: dotColor, display: "inline-block" } }),
				react_jsx_runtime.jsx("span", { children: b.label }),
				needsKey && checked && react_jsx_runtime.jsx("span", { style: { fontSize: 10, opacity: .65 }, children: props.t("keyMissing") }),
			] });
		}

		/**
		 * Combined card for a key-gated backend: switch, status badge, get-key
		 * link, input, hint and per-key error in one place so the credential is
		 * matched to its toggle without scrolling.
		 *
		 * The switch writes immediately (setToggle), the key is staged until
		 * Save (editKey) — `keySaveModeHint` states this so the two behaviours
		 * are not mistaken for one atomic action.
		 */
		function KeyedBackendCard(props) {
			const b = props.backend;
			const state = props.state;
			const checked = props.value === true;
			const configured = !!state.keyState[b.keyEnv]?.configured;
			const readOnly = configured && state.keyState[b.keyEnv]?.writable === false;
			// failedKeys is an array of { ref, reason }, NOT an array of strings.
			const failure = (state.failedKeys ?? []).find((f) => f && f.ref === b.keyEnv);
			const readFailure = (state.readErrors ?? []).find((f) => f && f.ref === b.keyEnv);
			const needsKey = !configured;
			const dotColor = needsKey ? (checked ? "#e6a700" : "#888") : "#2ea043";
			return react_jsx_runtime.jsxs("div", { className: "wsc-keyCard", style: { display: "flex", flexDirection: "column", gap: 6, padding: "9px 10px", borderRadius: 10, border: "1px solid var(--dsw-alias-border-l2)" }, children: [
				react_jsx_runtime.jsxs("label", { className: "wsc-toggle", style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: 0, border: "none", borderRadius: 0 }, children: [
					react_jsx_runtime.jsx("input", { type: "checkbox", checked, onChange: (e) => props.onToggle(e.target.checked) }),
					react_jsx_runtime.jsx("span", { style: { width: 8, height: 8, borderRadius: "50%", background: dotColor, display: "inline-block" } }),
					react_jsx_runtime.jsx("span", { children: b.label }),
					needsKey && checked && react_jsx_runtime.jsx("span", { style: { fontSize: 10, opacity: .65 }, children: props.t("keyMissing") }),
				] }),
				react_jsx_runtime.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, children: [
					react_jsx_runtime.jsx("span", { className: "wsc-badge" + (configured ? " wsc-badgeOn" : ""), children: configured ? props.t("keySet") : props.t("keyUnset") }),
					readOnly && react_jsx_runtime.jsx("span", { className: "wsc-badge", style: { opacity: .75 }, children: props.t("envProvided") }),
					KEY_URLS[b.id] && react_jsx_runtime.jsx("a", {
						href: KEY_URLS[b.id], target: "_blank", rel: "noreferrer",
						style: { fontSize: 11, color: "var(--dsw-alias-link)", textDecoration: "none" },
						children: props.t("getKey"),
					}),
				] }),
				react_jsx_runtime.jsx("input", {
					className: "wsc-keyInput", type: "password", autoComplete: "off",
					disabled: readOnly,
					placeholder: readOnly ? props.t("readOnly") : b.keyEnv,
					value: state.stagedKeys[b.keyEnv] ?? "",
					onChange: (e) => props.onEditKey(b.keyEnv, e.target.value),
				}),
				react_jsx_runtime.jsx("p", { className: "wsc-hint", children: props.t("keySaveModeHint") }),
				failure && react_jsx_runtime.jsx("p", { className: "wsc-hint", style: { color: "#e5534b" }, children: props.t("keyFailed") + (failure.reason ? ": " + failure.reason : "") }),
				readFailure && react_jsx_runtime.jsx("p", { className: "wsc-hint", style: { color: "#e6a700" }, children: props.t("keyReadFailed") }),
			] });
		}

		/** Labeled <select> for enum / boolean settings. */
		function SelectField(props) {
			return react_jsx_runtime.jsxs("div", { children: [
				react_jsx_runtime.jsx("div", { className: "wsc-fieldHead", children: react_jsx_runtime.jsx("span", { className: "wsc-label", children: props.label }) }),
				react_jsx_runtime.jsx("select", {
					className: "wsc-input",
					value: props.value,
					onChange: (e) => props.onChange(e.target.value),
					children: props.options.map((o) =>
						react_jsx_runtime.jsx("option", { value: o.value, children: o.label }, o.value)
					),
				}),
			] });
		}

		/** The card root. */
		/**
		 * Status strip above the settings form: enabled / keyed counts plus the
		 * three advisories (all-off fallback, read-only scope, metered default-off).
		 * @param {object} props { state, enabledCount, keysReady, t }
		 */
		function StatusSummary(props) {
			const { state, enabledCount, keysReady, t } = props;
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
				react_jsx_runtime.jsx("div", { style: { display: "flex", gap: 14, alignItems: "center", padding: "10px 12px", marginBottom: 10, borderRadius: 8, background: "var(--dsw-alias-bg-module-platform)" }, children: [
					react_jsx_runtime.jsxs("span", { children: [t("statusEnabled"), ": ", react_jsx_runtime.jsx("b", { children: enabledCount + "/" + BACKENDS.length })] }),
					react_jsx_runtime.jsxs("span", { children: [t("statusKeys"), ": ", react_jsx_runtime.jsx("b", { children: keysReady + "/" + KEYED.length })] }),
					METERED.length > 0 && react_jsx_runtime.jsxs("span", { style: { opacity: .65 }, children: [
						t("statusMetered"), ": ", METERED.length, " ", t("statusOffByDefault"),
					] }),
				] }),
				react_jsx_runtime.jsx("p", { style: { margin: 0, fontSize: 12, opacity: .65 }, children: t("description") }),
				(enabledCount === 0) && react_jsx_runtime.jsx("p", { style: { margin: 0, fontSize: 12, color: "#e6a700" }, children: t("fallbackHint") }),
				(state.writable === false) && react_jsx_runtime.jsx("p", { style: { margin: 0, fontSize: 12, color: "#e6a700" }, children: t("readOnlyScope") }),
			] });
		}

		/**
		 * The three backend groups: keyless toggles, keyed cards, and the metered
		 * opt-in section. The metered group keeps its own header and hint so it is
		 * never silently mixed into "keyless".
		 * @param {object} props { state, card, toggleField, t }
		 */
		function BackendToggles(props) {
			const { state, card, toggleField, t } = props;
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
				react_jsx_runtime.jsx("h5", { className: "wsc-sectionTitle", children: t("groupFree") }),
				react_jsx_runtime.jsx("div", { className: "wsc-toggles", children: KEYLESS.map((b) =>
					react_jsx_runtime.jsx(ToggleRow, {
						backend: b,
						value: state.value[toggleField(b.id)],
						keyConfigured: true,
						t,
						onChange: (checked) => card.setToggle(b.id, checked),
					}, b.id)
				) }),
				react_jsx_runtime.jsx("h5", { className: "wsc-sectionTitle", children: t("groupKeyed") }),
				// The switch and the credential input are one card per backend.
				react_jsx_runtime.jsx("div", { className: "wsc-grid", children: KEYED.map((b) =>
					react_jsx_runtime.jsx(KeyedBackendCard, {
						backend: b,
						state,
						value: state.value[toggleField(b.id)],
						t,
						onToggle: (checked) => card.setToggle(b.id, checked),
						onEditKey: (ref, text) => card.editKey(ref, text),
					}, b.id)
				) }),
				METERED.length > 0 && react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
					react_jsx_runtime.jsx("h5", { className: "wsc-sectionTitle", children: t("groupMetered") }),
					react_jsx_runtime.jsx("p", { style: { margin: "0 0 6px", fontSize: 11, opacity: .6 }, children: t("meteredHint") }),
					react_jsx_runtime.jsx("div", { className: "wsc-toggles", children: METERED.map((b) =>
						react_jsx_runtime.jsx(ToggleRow, {
							backend: b,
							value: state.value[toggleField(b.id)],
							keyConfigured: true,
							t,
							onChange: (checked) => card.setToggle(b.id, checked),
						}, b.id)
					) }),
				] }),
			] });
		}

		/**
		 * Global limits and result-shaping fields (rendered as inputs and selects).
		 * @param {object} props { state, card, t }
		 */
		function SettingsFields(props) {
			const { state, card, t } = props;
			const selVal = (f, dflt) => state.stagedText(f) ?? String(state.value[f] ?? dflt);
			const recencyOptions = [
				{ value: "any", label: t("recencyAny") },
				{ value: "day", label: t("recencyDay") },
				{ value: "week", label: t("recencyWeek") },
				{ value: "month", label: t("recencyMonth") },
				{ value: "year", label: t("recencyYear") },
			];
			const dedupOptions = [
				{ value: "url", label: t("dedupUrl") },
				{ value: "url+title", label: t("dedupTitle") },
			];
			const boolOptions = [
				{ value: "true", label: t("on") },
				{ value: "false", label: t("off") },
			];
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
				react_jsx_runtime.jsx("h4", { className: "wsc-sectionTitle", children: t("globalsTitle") }),
				react_jsx_runtime.jsxs("div", { className: "wsc-grid", children: [
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsx("div", { className: "wsc-fieldHead", children: react_jsx_runtime.jsx("span", { className: "wsc-label", children: t("numResultsLabel") }) }),
						react_jsx_runtime.jsx("input", { className: "wsc-input", value: state.stagedText("numResults") ?? String(state.value.numResults ?? ""), onChange: (e) => card.edit("numResults", e.target.value), inputMode: "numeric" }),
					] }),
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsx("div", { className: "wsc-fieldHead", children: react_jsx_runtime.jsx("span", { className: "wsc-label", children: t("concurrencyLabel") }) }),
						react_jsx_runtime.jsx("input", { className: "wsc-input", value: state.stagedText("concurrency") ?? String(state.value.concurrency ?? ""), onChange: (e) => card.edit("concurrency", e.target.value), inputMode: "numeric" }),
					] }),
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsx("div", { className: "wsc-fieldHead", children: react_jsx_runtime.jsx("span", { className: "wsc-label", children: t("timeoutLabel") }) }),
						react_jsx_runtime.jsx("input", { className: "wsc-input", value: state.stagedText("backendTimeoutMs") ?? String(state.value.backendTimeoutMs ?? ""), onChange: (e) => card.edit("backendTimeoutMs", e.target.value), inputMode: "numeric" }),
					] }),
				] }),
				react_jsx_runtime.jsx("h4", { className: "wsc-sectionTitle", children: t("shapingTitle") }),
				react_jsx_runtime.jsxs("div", { className: "wsc-grid", children: [
					// A language tag is free text ("en", "zh-CN", …), not an enum: keeping
					// it as a select with no options threw on render.
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsx("div", { className: "wsc-fieldHead", children: react_jsx_runtime.jsx("span", { className: "wsc-label", children: t("langLabel") }) }),
						react_jsx_runtime.jsx("input", {
							className: "wsc-input",
							placeholder: t("langPlaceholder"),
							value: state.stagedText("language") ?? String(state.value.language ?? ""),
							onChange: (e) => card.edit("language", e.target.value),
						}),
					] }),
					react_jsx_runtime.jsx(SelectField, { label: t("recencyLabel"), value: selVal("recency", "any"), options: recencyOptions, onChange: (v) => card.edit("recency", v) }),
					react_jsx_runtime.jsx(SelectField, { label: t("dedupLabel"), value: selVal("dedupStrategy", "url"), options: dedupOptions, onChange: (v) => card.edit("dedupStrategy", v) }),
					react_jsx_runtime.jsx(SelectField, { label: t("rerankLabel"), value: selVal("rerank", "false"), options: boolOptions, onChange: (v) => card.edit("rerank", v) }),
					react_jsx_runtime.jsx(SelectField, { label: t("safeSearchLabel"), value: selVal("safeSearch", "true"), options: boolOptions, onChange: (v) => card.edit("safeSearch", v) }),
					react_jsx_runtime.jsx(SelectField, { label: t("telemetryLabel"), value: selVal("resultTelemetry", "true"), options: boolOptions, onChange: (v) => card.edit("resultTelemetry", v) }),
				] }),
			] });
		}

		/**
		 * The optional-key grid (private instances / metered limits) and the save bar.
		 * @param {object} props { state, card, t }
		 */
		function OptionalKeysAndActions(props) {
			const { state, card, t } = props;
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
				react_jsx_runtime.jsx("h5", { className: "wsc-sectionTitle", children: t("optionalTitle") }),
				react_jsx_runtime.jsx("div", { className: "wsc-grid", children: OPTIONAL_KEYS.map((b) => {
					// failedKeys is [{ref, reason}], not a string array: the old
					// `.includes(b.keyEnv)` never matched, so failures stayed silent.
					const failure = (state.failedKeys ?? []).find((f) => f && f.ref === b.keyEnv);
					const readFailure = (state.readErrors ?? []).find((f) => f && f.ref === b.keyEnv);
					return react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsxs("div", { className: "wsc-fieldHead", children: [
							react_jsx_runtime.jsx("span", { className: "wsc-label", children: t("keyLabel", { id: b.label }) }),
							react_jsx_runtime.jsx("span", { className: "wsc-badge" + (state.keyState[b.keyEnv]?.configured ? " wsc-badgeOn" : ""), children: state.keyState[b.keyEnv]?.configured ? t("keySet") : t("keyUnset") }),
						] }),
						react_jsx_runtime.jsx("input", {
							className: "wsc-keyInput", type: "password", autoComplete: "off",
							disabled: state.keyState[b.keyEnv]?.configured && state.keyState[b.keyEnv]?.writable === false,
							placeholder: b.keyEnv,
							value: state.stagedKeys[b.keyEnv] ?? "",
							onChange: (e) => card.editKey(b.keyEnv, e.target.value),
						}),
						react_jsx_runtime.jsx("p", { className: "wsc-hint", children: t("keySaveModeHint") }),
						failure && react_jsx_runtime.jsx("p", { className: "wsc-hint", style: { color: "#e5534b" }, children: t("keyFailed") + (failure.reason ? ": " + failure.reason : "") }),
						readFailure && react_jsx_runtime.jsx("p", { className: "wsc-hint", style: { color: "#e6a700" }, children: t("keyReadFailed") }),
					] }, b.id);
				}) }),
				state.stagedCount > 0 && react_jsx_runtime.jsx("p", { style: { margin: 0, fontSize: 12, opacity: .65 }, children: t("unsavedHint") }),
				react_jsx_runtime.jsxs("div", { className: "wsc-actions", children: [
					react_jsx_runtime.jsx("button", { className: "wsc-btn", disabled: state.saving || state.stagedCount === 0 || state.writable === false, onClick: () => card.save(), children: state.saving ? t("saving") : t("save") }),
					(state.stagedCount > 0) && react_jsx_runtime.jsx("button", { className: "wsc-btn wsc-btnGhost", disabled: state.saving, onClick: () => card.discard(), children: t("discard") }),
					state.failed && react_jsx_runtime.jsx("span", { className: "wsc-status", style: { color: "#e5534b" }, children: state.conflict ? t("conflict") : t("saveFailed") }),
					state.toggleFailed && react_jsx_runtime.jsx("span", { className: "wsc-status", style: { color: "#e5534b" }, children: t("toggleFailed") + (state.toggleConflict ? " — " + t("conflict") : "") }),
					(state.failedFields.length > 0) && react_jsx_runtime.jsx("span", { className: "wsc-status", style: { color: "#e6a700" }, children: t("invalidFields") + " " + state.failedFields.join(", ") }),
					state.conflict && react_jsx_runtime.jsx("span", { className: "wsc-status", style: { color: "#e6a700" }, children: t("conflictHint") }),
					!state.failed && !state.saving && state.savedAt > 0 && react_jsx_runtime.jsx("span", { className: "wsc-status", style: { color: "#2ea043" }, children: t("savedOk") }),
				] }),
			] });
		}

		function UnifiedSearchSection(props) {
			const state = props.useUnifiedSearchCard((snapshot) => snapshot);
			const card = { edit: props.edit, setToggle: props.setToggle, reset: props.reset, editKey: props.editKey, save: props.save, discard: props.discard };
			// Occupants of settings.plugin.item render inside the tab's <ul>; use <li>.
			if (!state.ready) {
				return react_jsx_runtime.jsx("div", { className: "wsc-card", style: { fontSize: 12, opacity: .6 }, children: "…" });
			}
			// No snapshot at all (404/503): showing "0/13 enabled" plus live
			// controls would be a fabricated state. Explain it and offer a retry.
			if (state.unavailable) {
				return react_jsx_runtime.jsxs("div", { className: "wsc-card", children: [
					react_jsx_runtime.jsx("p", { style: { margin: 0, fontSize: 12, opacity: .75 }, children: props.t("unavailable") }),
					react_jsx_runtime.jsx("div", { className: "wsc-actions", children: react_jsx_runtime.jsx("button", { className: "wsc-btn", onClick: () => props.retry(), children: props.t("retry") }) }),
				] });
			}

			const toggleField = (id) => "enable" + id.charAt(0).toUpperCase() + id.slice(1);

			// Status summary: enabled backends + configured keys at a glance.
			const enabledCount = BACKENDS.filter((b) => state.value[toggleField(b.id)] === true).length;
			const keysReady = KEYED.filter((b) => state.keyState[b.keyEnv]?.configured).length;

			const recencyOptions = [
				{ value: "any", label: props.t("recencyAny") },
				{ value: "day", label: props.t("recencyDay") },
				{ value: "week", label: props.t("recencyWeek") },
				{ value: "month", label: props.t("recencyMonth") },
				{ value: "year", label: props.t("recencyYear") },
			];
			const dedupOptions = [
				{ value: "url", label: props.t("dedupUrl") },
				{ value: "url+title", label: props.t("dedupTitle") },
			];
			const boolOptions = [
				{ value: "true", label: props.t("on") },
				{ value: "false", label: props.t("off") },
			];
			const selVal = (f, dflt) => state.stagedText(f) ?? String(state.value[f] ?? dflt);

			return react_jsx_runtime.jsxs("div", { className: "wsc-card", children: [
				react_jsx_runtime.jsx(StatusSummary, { state, enabledCount, keysReady, t: props.t }),
				// A read-only snapshot (scope locked by the host) must not render
				// live toggles: fieldset disabled disables every descendant input,
				// select and button without relying on each call site.
				react_jsx_runtime.jsxs("fieldset", { disabled: state.writable === false, style: { border: 0, margin: 0, padding: 0, minWidth: 0 }, children: [
					react_jsx_runtime.jsx(BackendToggles, { state, card, toggleField, t: props.t }),
					react_jsx_runtime.jsx(SettingsFields, { state, card, t: props.t }),
					react_jsx_runtime.jsx(OptionalKeysAndActions, { state, card, t: props.t }),
				] }),
			] });
		}

		/**
		 * Plugin entry: register the card into the settings plugins page.
		 * Compatibility: the legacy `settingsScope` client service was removed on
		 * the 0.2.x line; the card binds whichever data source the build offers
		 * (see selectBridge) and registers the section unconditionally.
		 */
		// DSH 0.2.x registers each remote namespace as its own service key
		// (`remote.<namespace>`). Undeclared access throws instead of returning
		// undefined, so the namespace must be declared in inject for key saves
		// and credential reads. The official settings models plugin declares
		// the same key.
		const inject = ["slots", "locale", "connection", "remote", "remote.credentials"];
		/**
		 * Resolve the settings data source for this build, in order:
		 *  1. the legacy `settingsScope` service (DSH <= 0.1.6 line, or a shim);
		 *  2. this plugin's own fenced settings routes (0.2.x line, where the
		 *     client service was removed and the settings shell renders client
		 *     slot sections only);
		 *  3. an unavailable bridge -- the section still registers and the card
		 *     explains itself through its read-only banner.
		 */
		function selectBridge(ctx) {
			try {
			const scope = ctx.get("settingsScope");
			if (scope !== undefined && typeof scope.bind === "function") return scope.bind({ namespace: PLUGIN_NS });
			} catch (_noSettingsScope) { /* fall through to the routes bridge */ }
			return new SettingsRoutesBridge();
		}
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "websearch: copy dictionaries");
			const bridge = selectBridge(ctx);
			if (typeof bridge.load === "function") void bridge.load();
			const controller = new UnifiedSearchCardController(
				bridge,
				ctx.get("connection"),
				ctx.get("remote"),
			);
			// The store subscription and late fetch responses outlive the section
			// unless the controller is detached with the plugin.
			ctx.effect(() => () => controller.dispose(), "websearch: card controller");
			// Credential invalidations: 0.2.x forwards `credentials/reference-updated`;
			// older lines forwarded `credentials/updated`. Subscribe to whichever
			// event face this build exposes; a missing face must not abort apply().
			for (const event of ["credentials/reference-updated", "credentials/updated"]) {
				try {
				ctx.effect(() => ctx.remote.$on(event, () => controller.refreshAllCredentials()), "websearch: credential invalidations");
				} catch (_noEventFace) { /* this build does not forward that event */ }
			}
			// Re-read when another client saves this namespace (settings document
			// revisions travel through the remote event face on 0.2.x).
			try {
				ctx.effect(() => ctx.remote.$on("settings/document-updated", () => { if (typeof bridge.load === "function") void bridge.load(); }), "websearch: settings document invalidations");
			} catch (_noSettingsEvent) { /* settings events unavailable */ }
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "websearch",
				order: 16,
				label: () => ctx.locale.bind(NS)("nav"),
				locale: NS,
				inject: () => controller.inject(),
			}, UnifiedSearchSection));
			controller.refreshAllCredentials();

			// Interop: devkit (and any third-party plugin) dispatches the window
			// event "dsh-websearch:open-settings" to surface this plugin's
			// settings. The host exposes no section-jump API, so: if devkit's
			// toast is available, point the user at the path; otherwise log.
			// (fe-ui C3 keeps devkit toast as the ecosystem standard notifier.)
			const onOpenSettings = () => {
				const hint = "统一搜索设置位于：设置 → 左侧栏「搜索 / Web Search」";
				try {
					if (window.__dshDevkit && typeof window.__dshDevkit.toast === "function") {
						window.__dshDevkit.toast(hint, { kind: "info" });
					} else {
						console.info("[dsh-websearch] " + hint);
					}
				} catch (e) { /* best-effort notification */ }
				try {
					window.dispatchEvent(new CustomEvent("dsh-websearch:open-settings:ack"));
				} catch (e) { /* CustomEvent unavailable */ }
			};
			// Probe contract (devkit 0.1.1): ready flag + ack event, so the
			// palette can tell "listener present" from "gracefully absent".
			try {
				window.__dshWebsearchSettingsReady = true;
				// Remove the exact function that was added: an anonymous listener
				// cannot be removed, so every reload used to stack another one.
				window.addEventListener("dsh-websearch:open-settings", onOpenSettings);
				ctx.effect(() => () => {
					window.removeEventListener("dsh-websearch:open-settings", onOpenSettings);
					window.__dshWebsearchSettingsReady = false;
				}, "websearch: open-settings listener");
			} catch (e) { /* non-window env */ }
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
