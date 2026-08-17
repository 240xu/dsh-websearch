/**
 * dsh-unified-search: unified free web search provider for the DSH web seam (ctx.web).
 * Registers provider id "unified". Configurable from the DSH Settings section;
 * API keys resolve through the credentials service (credentialRef) with env fallback.
 * Backends: exa / parallel / ddg (keyless), deepseek / anthropic / openai (key-gated).
 */
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";

export const name = "unified-search";
export const inject = ["web"];

const NAMESPACE = settingsNamespace("unified-search");
const DEFAULT_BACKENDS = ["exa", "parallel", "ddg", "deepseek", "anthropic", "openai"];
const UA = "dsh-unified-search/0.1";

export const Config = z.object({
  enabledBackends: z.array(z.string()),
  numResults: z.number().step(1).min(1).max(20),
  exaApiKeyEnv: z.string().role("credential-ref"),
  deepseekApiKeyEnv: z.string().role("credential-ref"),
  deepseekBaseURL: z.string(),
  deepseekModel: z.string(),
  anthropicApiKeyEnv: z.string().role("credential-ref"),
  anthropicBaseURL: z.string(),
  anthropicModel: z.string(),
  openaiApiKeyEnv: z.string().role("credential-ref"),
  openaiBaseURL: z.string(),
  openaiModel: z.string()
});

function resolveOptions(ctx, config) {
  return {
    enabledBackends: (config.enabledBackends && config.enabledBackends.length > 0) ? config.enabledBackends : DEFAULT_BACKENDS,
    numResults: config.numResults || 6,
    keyRefs: {
      exa: config.exaApiKeyEnv || "EXA_API_KEY",
      deepseek: config.deepseekApiKeyEnv || "DEEPSEEK_API_KEY",
      anthropic: config.anthropicApiKeyEnv || "ANTHROPIC_API_KEY",
      openai: config.openaiApiKeyEnv || "OPENAI_API_KEY"
    },
    bases: {
      deepseek: config.deepseekBaseURL || "https://api.deepseek.com/anthropic/v1",
      anthropic: config.anthropicBaseURL || "https://api.anthropic.com/v1",
      openai: config.openaiBaseURL || "https://api.openai.com/v1"
    },
    models: {
      deepseek: config.deepseekModel || "deepseek-v4-flash",
      anthropic: config.anthropicModel || "claude-sonnet-4-6",
      openai: config.openaiModel || "gpt-5-codex"
    },
    ctx
  };
}

async function resolveKey(ctx, refName) {
  const ref = credentialRef(refName);
  const credentials = ctx.get("credentials");
  if (credentials !== void 0) {
    try {
      const v = await credentials.resolve(ref);
      if (v && v.value) return v.value;
    } catch {}
  }
  const ambient = launchEnvironmentOf(ctx).get(refName);
  if (ambient !== void 0 && ambient.value && ambient.value.length > 0) return ambient.value;
  return void 0;
}

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(25000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status);
  for (const chunk of text.split("\n")) {
    const line = chunk.trim();
    const json = line.startsWith("data: ") ? line.slice(6).trim() : line;
    if (!json || !json.startsWith("{")) continue;
    try { const obj = JSON.parse(json); if (obj.result) return obj.result; if (obj.error) throw new Error(obj.error.message || "rpc"); } catch {}
  }
  throw new Error("unparseable rpc response");
}

async function backendExa(query, maxResults, opts) {
  const key = await resolveKey(opts.ctx, opts.keyRefs.exa);
  const url = "https://mcp.exa.ai/mcp" + (key ? "?exaApiKey=" + encodeURIComponent(key) : "");
  const r = await rpcCall(url, "tools/call", { name: "web_search_exa", arguments: { query, type: "auto", numResults: maxResults || 6, livecrawl: "fallback", contextMaxCharacters: 2000 } });
  const text = (r.content || []).map(c => c.text || "").join("\n");
  const out = [];
  const re = /Title: ([^\n]*)\nURL: (https?:\/\/[^\n]+)\nPublished: ([^\n]*)\nAuthor: ([^\n]*)\nHighlights:\n([\s\S]*?)(?=\n\nTitle: |\n\n?[A-Z][a-z]+:|$)/g;
  let m;
  while ((m = re.exec(text)) && out.length < (maxResults || 6)) {
    const s = { url: m[2].trim() };
    if (m[1].trim()) s.title = m[1].trim();
    const snip = (m[5] || "").trim().slice(0, 500);
    if (snip) s.snippet = snip;
    if (m[3].trim() && !/^N\/A$/i.test(m[3].trim())) s.publishedAt = m[3].trim();
    out.push(s);
  }
  return { sources: out, content: undefined };
}

async function backendParallel(query, maxResults, opts) {
  const r = await rpcCall("https://search.parallel.ai/mcp", "tools/call", { name: "web_search", arguments: { objective: query, search_queries: [query], session_id: "dsh", model_name: "dsh" } });
  const text = (r.content || []).map(c => c.text || "").join("\n");
  const out = [];
  try {
    const data = JSON.parse(text);
    for (const it of (data.results || []).slice(0, maxResults || 6)) {
      const s = { url: it.url || "" };
      if (it.title) s.title = it.title;
      const ex = (it.excerpts || []).join(" ").slice(0, 500);
      if (ex) s.snippet = ex;
      if (it.publish_date) s.publishedAt = it.publish_date;
      out.push(s);
    }
  } catch {}
  return { sources: out, content: undefined };
}

async function backendDdg(query, maxResults, opts) {
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error("DDG HTTP " + res.status);
  const html = await res.text();
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < (maxResults || 6)) {
    let url = m[1];
    if (url.startsWith("//")) url = "https://" + url;
    const uddg = "duckduckgo.com/l/?uddg=";
    const ui = url.indexOf(uddg);
    if (ui >= 0) { try { url = decodeURIComponent(url.slice(ui + uddg.length).split("&")[0]); } catch {} }
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    const snip = m[4] ? m[4].replace(/<[^>]+>/g, "").trim().slice(0, 400) : "";
    if (title) { const s = { url: url || "" }; s.title = title; if (snip) s.snippet = snip; out.push(s); }
  }
  return { sources: out, content: undefined };
}

async function anthropicLike(base, key, model, query) {
  let data;
  for (const toolType of ["web_search_20260318", "web_search_20250305"]) {
    const res = await fetch(base + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "User-Agent": UA },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: "user", content: query }], tools: [{ type: toolType, name: "web_search", max_uses: 1 }] }),
      signal: AbortSignal.timeout(45000)
    });
    if (!res.ok) { const t = await res.text(); if (res.status === 400 || res.status === 404) continue; throw new Error("HTTP " + res.status + ": " + t.slice(0, 120)); }
    data = await res.json();
    break;
  }
  if (!data) throw new Error("web_search 工具版本均不被支持");
  const blocks = data.content || [];
  const out = [];
  let content = "";
  for (const b of blocks) {
    if (b.type === "text" && b.text) content += b.text + "\n";
    if (b.type === "web_search_tool_result") {
      for (const item of b.citations || b.web_search_result || []) {
        if (!item.url) continue;
        const s = { url: item.url };
        if (item.title) s.title = item.title;
        if (item.cited_text) s.snippet = item.cited_text.slice(0, 400);
        if (item.page_age) s.publishedAt = item.page_age;
        out.push(s);
      }
    }
  }
  return { sources: out, content: content.trim() || undefined };
}

async function backendDeepseek(query, maxResults, opts) {
  const key = await resolveKey(opts.ctx, opts.keyRefs.deepseek);
  if (!key) throw new Error("deepseek key 未配置（Settings 或凭据 " + opts.keyRefs.deepseek + "）");
  return anthropicLike(opts.bases.deepseek, key, opts.models.deepseek, query);
}

async function backendAnthropic(query, maxResults, opts) {
  const key = await resolveKey(opts.ctx, opts.keyRefs.anthropic);
  if (!key) throw new Error("anthropic key 未配置（Settings 或凭据 " + opts.keyRefs.anthropic + "）");
  return anthropicLike(opts.bases.anthropic, key, opts.models.anthropic, query);
}

async function backendOpenai(query, maxResults, opts) {
  const key = await resolveKey(opts.ctx, opts.keyRefs.openai);
  if (!key) throw new Error("openai key 未配置（Settings 或凭据 " + opts.keyRefs.openai + "）");
  const res = await fetch(opts.bases.openai + "/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key, "User-Agent": UA },
    body: JSON.stringify({ model: opts.models.openai, input: query, max_output_tokens: 1024, tools: [{ type: "web_search", search_context_size: "medium" }] }),
    signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 120));
  const data = await res.json();
  const out = [];
  let content = "";
  for (const item of data.output || []) {
    if (item.type === "message" && item.content) content += item.content.map(c => c.text || "").join("");
    if (item.type === "web_search_result") {
      const s = { url: item.url || "" };
      if (item.title) s.title = item.title;
      if (item.text) s.snippet = item.text.slice(0, 400);
      out.push(s);
    }
  }
  return { sources: out, content: content.trim() || undefined };
}

const BACKENDS = { exa: backendExa, parallel: backendParallel, ddg: backendDdg, deepseek: backendDeepseek, anthropic: backendAnthropic, openai: backendOpenai };

export class UnifiedSearchProvider {
  id = "unified";
  constructor(getOptions) {
    this.getOptions = getOptions;
  }
  available() { return true; }
  async search(request, signal) {
    const opts = this.getOptions();
    const enabled = opts.enabledBackends.filter(b => BACKENDS[b]);
    if (enabled.length === 0) throw new WebError("unified: no backends enabled", "WEB_PROVIDER_ERROR");
    const maxResults = request.maxResults || opts.numResults || 6;
    const results = await Promise.all(enabled.map(async (b) => {
      try { return { name: b, r: await BACKENDS[b](request.query, maxResults, opts) }; }
      catch (e) { return { name: b, error: e.message || String(e) }; }
    }));
    const seen = new Set();
    const sources = [];
    let content = "";
    for (const { name, r, error } of results) {
      if (error) continue;
      if (r.content && !content) content = r.content;
      for (const s of r.sources || []) {
        if (!s.url || seen.has(s.url)) continue;
        seen.add(s.url);
        sources.push(s);
      }
    }
    if (sources.length === 0) {
      const errs = results.filter(r => r.error).map(r => r.name + ": " + r.error).join("; ");
      throw new WebError("unified: 所有后端均失败 — " + (errs || "无结果"), "WEB_PROVIDER_ERROR");
    }
    return { ...content ? { content: content.slice(0, 1500) } : {}, sources: sources.slice(0, maxResults), truncated: sources.length > maxResults };
  }
}

export function apply(ctx, config) {
  let current = () => config || {};
  installSettingsSection(ctx, NAMESPACE, Config, config || {}, {
    setSource: (source) => { current = source; },
    onChange: () => {}
  });
  ctx.web.registerSearchProvider(new UnifiedSearchProvider(() => resolveOptions(ctx, current())));
}
