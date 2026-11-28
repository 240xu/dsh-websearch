// custom/mcp.js — a config-declared MCP search backend.
//
// This is deliberately narrow: a trusted HTTPS MCP endpoint, one named tool,
// fixed query/limit argument names, and field mapping by key path. It does not
// accept arbitrary URLs per request, headers, expressions, or result HTML.

import { WebError } from "@deepseek-ai/dsh-web";
import { mcpCall, mcpText } from "../util/mcp-client.js";
import { invalidBaseURL } from "../util/base-url.js";
import { throwIfSearchAborted } from "../util/abort.js";

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const TOOL_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const FIELD_RE = /^[A-Za-z0-9_.[\]-]{1,80}$/;

/**
 * Validate a custom backend declaration. Invalid entries are returned as
 * errors rather than silently becoming a different backend.
 * @param {unknown} raw
 * @returns {{ defs: object[], errors: string[] }}
 */
export function normalizeCustomBackends(raw) {
  const defs = [];
  const errors = [];
  if (raw === undefined || raw === null) return { defs, errors };
  if (!Array.isArray(raw)) return { defs, errors: ["customBackends must be an array"] };
  const seen = new Set();
  for (const item of raw.slice(0, 8)) {
    if (item === null || typeof item !== "object") { errors.push("custom backend must be an object"); continue; }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const endpoint = typeof item.endpoint === "string" ? item.endpoint.trim() : "";
    const tool = typeof item.tool === "string" ? item.tool.trim() : "";
    if (!ID_RE.test(id)) { errors.push(`custom backend id "${id}" is invalid`); continue; }
    if (seen.has(id)) { errors.push(`custom backend id "${id}" is duplicated`); continue; }
    seen.add(id);
    if (label.length === 0 || label.length > 80) { errors.push(`custom backend "${id}" needs a label (1-80 chars)`); continue; }
    if (!TOOL_RE.test(tool)) { errors.push(`custom backend "${id}" needs a tool name`); continue; }
    let parsed;
    try { parsed = new URL(endpoint); } catch { errors.push(`custom backend "${id}" endpoint is not a URL`); continue; }
    if (parsed.protocol !== "https:") { errors.push(`custom backend "${id}" endpoint must be HTTPS`); continue; }
    if (parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") {
      errors.push(`custom backend "${id}" endpoint must not contain credentials or a fragment`); continue;
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.+$/, "");
    if (/^[0-9.]+$/.test(host) || host.includes(":")) {
      errors.push(`custom backend "${id}" endpoint must use a DNS hostname`);
      continue;
    }
    if (host.startsWith("::ffff:")) {
      errors.push(`custom backend "${id}" endpoint must not use an IPv4-mapped address`);
      continue;
    }
    if (/^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|::1|f[cd][0-9a-f]{2}:)/.test(host)) {
      errors.push(`custom backend "${id}" endpoint must be public (private host rejected)`);
      continue;
    }
    const blocked = invalidBaseURL(endpoint);
    if (blocked !== undefined) { errors.push(`custom backend "${id}": ${blocked}`); continue; }
    const authRef = typeof item.authRef === "string" ? item.authRef.trim() : "";
    if (authRef !== "" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(authRef)) {
      errors.push(`custom backend "${id}" authRef must be an env-style reference`); continue;
    }
    const queryArg = typeof item.queryArg === "string" && item.queryArg.trim() !== "" ? item.queryArg.trim() : "query";
    const limitArg = typeof item.limitArg === "string" && item.limitArg.trim() !== "" ? item.limitArg.trim() : "max_results";
    const resultsPath = typeof item.resultsPath === "string" ? item.resultsPath.trim() : "results";
    const fields = {};
    for (const [key, fallback] of [["urlField", "url"], ["titleField", "title"], ["snippetField", "snippet"], ["dateField", "date"]]) {
      const value = typeof item[key] === "string" && item[key].trim() !== "" ? item[key].trim() : fallback;
      if (!FIELD_RE.test(value)) { errors.push(`custom backend "${id}" ${key} is invalid`); continue; }
      fields[key] = value;
    }
    if (Object.keys(fields).length !== 4) continue;
    const timeoutMs = Number(item.timeoutMs);
    defs.push({
      id, label, endpoint, tool, authRef,
      enabled: item.enabled === true,
      stateless: item.stateless === true,
      queryArg, limitArg, resultsPath,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(Math.max(timeoutMs, 500), 60_000) : 15_000,
      ...fields,
    });
  }
  return { defs, errors };
}

/** Read a dotted key path without evaluating expressions. */
export function readField(value, path) {
  if (path === "") return value;
  let current = value;
  for (const part of String(path).split(".").slice(0, 8)) {
    if (current === null || current === undefined || (typeof current !== "object" && !Array.isArray(current))) return undefined;
    if (!Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Map one MCP result to the web seam's source records. The result must expose
 * a JSON object/array (structuredContent or JSON text) with a results array.
 * @param {object} result
 * @param {object} def
 * @param {number} maxResults
 * @returns {Array<{url:string,title?:string,snippet?:string,publishedAt?:string}>}
 */
export function customSourcesFromResult(result, def, maxResults) {
  let data = result?.structuredContent;
  if (data === undefined) {
    try { data = JSON.parse(mcpText(result) || "{}"); } catch { data = undefined; }
  }
  const list = def.resultsPath === "" ? data : readField(data, def.resultsPath);
  if (!Array.isArray(list)) return [];
  const sources = [];
  for (const item of list) {
    if (sources.length >= maxResults) break;
    if (item === null || typeof item !== "object") continue;
    const url = readField(item, def.urlField);
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    const title = readField(item, def.titleField);
    const snippet = readField(item, def.snippetField);
    const date = readField(item, def.dateField);
    sources.push({
      url,
      ...(typeof title === "string" && title.trim() !== "" ? { title: title.trim().slice(0, 300) } : {}),
      ...(typeof snippet === "string" && snippet.trim() !== "" ? { snippet: snippet.trim().slice(0, 800) } : {}),
      ...(typeof date === "string" && date.trim() !== "" ? { publishedAt: date.trim() } : {}),
    });
  }
  return sources;
}

/**
 * Build one provider backend from a normalized custom declaration.
 * @param {object} def
 * @param {{ resolveApiKey?: () => Promise<string|undefined> }} options
 * @returns {object}
 */
export function createCustomMcpBackend(def, options = {}) {
  const id = `custom:${def.id}`;
  const requiresKey = def.authRef !== "";
  return {
    id,
    requiresCredential: requiresKey,
    custom: true,
    available() {
      return typeof def.endpoint === "string" && typeof def.tool === "string";
    },
    async search(request, signal, backendOpts, hooks) {
      throwIfSearchAborted(signal);
      const apiKey = requiresKey ? await options.resolveApiKey?.() : undefined;
      if (requiresKey && !apiKey) {
        throw new WebError(`Custom backend ${def.label}: credential ${def.authRef} is not configured`, "WEB_PROVIDER_CREDENTIAL_MISSING");
      }
      const args = { [def.queryArg]: request.query };
      const limit = Math.max(1, Math.min(Number(request.maxResults) || 8, 100));
      if (def.limitArg !== "") args[def.limitArg] = limit;
      hooks?.recordRequest?.({ endpoint: def.endpoint, toolName: def.tool, body: args });
      let result;
      try {
        result = await mcpCall(def.endpoint, def.tool, args, apiKey ? { Authorization: "Bearer " + apiKey } : {}, signal, {
          skipInitialize: def.stateless,
          deadlineMs: def.timeoutMs,
        });
      } catch (error) {
        if (error instanceof WebError) throw error;
        throw new WebError(`Custom backend ${def.label}: ${error?.message ?? "request failed"}`, "WEB_PROVIDER_ERROR", { cause: error });
      }
      if (result?.isError === true) {
        throw new WebError(`Custom backend ${def.label}: ${mcpText(result).slice(0, 300)}`, "WEB_PROVIDER_ERROR");
      }
      const sources = customSourcesFromResult(result, def, limit);
      hooks?.recordOutcome?.({ status: "success", count: sources.length });
      return { sources };
    },
  };
}
