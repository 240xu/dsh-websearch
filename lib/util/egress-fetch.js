// util/egress-fetch.js — proxy-aware fetch for kill-switched egress environments.
//
// Node's global fetch ignores HTTP_PROXY / HTTPS_PROXY. Containerized
// deployments commonly rely on those env vars AND block direct connections
// (egress kill-switch), so every outbound backend request must tunnel through
// the proxy. This module provides the fetch subset the plugin uses — ok,
// status, headers.get(), text(), json(), body.cancel(), abort signals,
// redirect:"error" plus bounded redirect:"follow" — backed by node:http(s)
// with a proxy CONNECT tunnel and zero dependencies.
//
// When no matching proxy env is set, or the target host sits in NO_PROXY, it
// defers to the native fetch, so behavior everywhere else is unchanged.
//
// Optional TLS-egress forwarder: when DSH_EGRESS_FORWARDER is set (a local
// sidecar exposing a POST /fwd API backed by a Chromium TLS stack), requests
// are relayed through it with the upstream proxy carried in the sidecar spec
// (DSH_EGRESS_FORWARDER_PROXY, defaulting to HTTPS_PROXY). This exists because
// some upstreams (Exa, DuckDuckGo) gate on the client TLS fingerprint (JA3)
// rather than on the exit IP; the Node TLS fingerprint is rejected where a
// real browser's is accepted. Unset the env and behavior is byte-identical.

import http from "node:http";
import https from "node:https";

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/** fetch-compatible entry: forwarder first, then HTTPS_PROXY/HTTP_PROXY tunnel. */
export function egressFetch(url, init = {}) {
  const forwarder = forwarderFor(url);
  if (forwarder !== undefined) return forwarderFetch(String(url), init, forwarder);
  const proxy = proxyFor(url);
  if (proxy === undefined) return fetch(url, init);
  return tunneledFetch(String(url), init, proxy, 0);
}

/** Resolve the TLS-egress forwarder for a request target (NO_PROXY aware). */
function forwarderFor(url) {
  let target;
  try {
    target = new URL(String(url));
  } catch {
    return undefined;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return undefined;
  const env = process.env;
  const endpoint = env.DSH_EGRESS_FORWARDER;
  if (endpoint === undefined || endpoint === "") return undefined;
  if (inNoProxy(target, env.NO_PROXY || env.no_proxy)) return undefined;
  const proxy = env.DSH_EGRESS_FORWARDER_PROXY
    || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "";
  return { endpoint, proxy: proxy === "" ? undefined : proxy };
}

/** Resolve the proxy URL for a request target (NO_PROXY aware). */
function proxyFor(url) {
  let target;
  try {
    target = new URL(String(url));
  } catch {
    return undefined;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return undefined;
  const env = process.env;
  const proxy = target.protocol === "https:"
    ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
    : env.HTTP_PROXY || env.http_proxy;
  if (proxy === undefined || proxy === "") return undefined;
  if (inNoProxy(target, env.NO_PROXY || env.no_proxy)) return undefined;
  return proxy;
}

/** NO_PROXY matching: "*", bare hosts, leading-dot suffixes, optional :port. */
function inNoProxy(target, raw) {
  if (raw === undefined || raw === "") return false;
  const host = target.hostname.toLowerCase();
  const port = target.port !== "" ? target.port : target.protocol === "https:" ? "443" : "80";
  for (const piece of String(raw).split(",")) {
    const item = piece.trim().toLowerCase();
    if (item === "") continue;
    if (item === "*") return true;
    const [name, itemPort] = splitHostPort(item);
    if (itemPort !== "" && itemPort !== port) continue;
    const bare = name.replace(/^\./, "");
    if (bare === "" ) continue;
    if (host === bare || host.endsWith("." + bare)) return true;
  }
  return false;
}

function splitHostPort(item) {
  if (item.startsWith("[")) {
    const close = item.indexOf("]");
    if (close === -1) return [item.replace(/^\[/, ""), ""];
    const rest = item.slice(close + 1);
    return [item.slice(1, close), rest.startsWith(":") ? rest.slice(1) : ""];
  }
  const colon = item.lastIndexOf(":");
  if (colon === -1) return [item, ""];
  return [item.slice(0, colon), item.slice(colon + 1)];
}

async function tunneledFetch(url, init, proxy, depth) {
  const target = new URL(url);
  const secure = target.protocol === "https:";
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = normalizeHeaders(init.headers);
  const body = normalizeBody(init.body);
  if (body !== undefined && headers["content-length"] === undefined && headers["transfer-encoding"] === undefined) {
    headers["content-length"] = String(body.length);
  }
  const signal = init.signal;
  throwIfAborted(signal);

  const response = secure
    ? await httpsViaConnect(target, proxy, method, headers, body, signal)
    : await httpViaProxy(target, proxy, method, headers, body, signal);

  if (REDIRECT_STATUS.has(response.status)) {
    const location = response.headers.get("location");
    if (location !== null && location !== "") {
      if (init.redirect === "error") {
        await drain(response);
        throw new TypeError(`fetch failed: redirect mode is set to error (${response.status})`);
      }
      if (init.redirect !== "manual" && depth < MAX_REDIRECTS) {
        const next = new URL(location, target);
        const dropBody = response.status === 303
          || ((response.status === 301 || response.status === 302) && method === "POST");
        const nextInit = dropBody
          ? { ...init, method: "GET", body: undefined, headers: withoutBodyHeaders(init.headers) }
          : { ...init };
        await drain(response);
        return egressFetch(next.href, nextInit);
      }
    }
  }
  return response;
}

/**
 * Relay through the TLS-egress sidecar: POST /fwd with an
 * x-sidecar-spec base64 JSON header; the sidecar performs the upstream
 * request with its own (Chromium) TLS stack and streams the upstream
 * status/headers/body back verbatim. Upstream dial failures surface as
 * 502 + x-sidecar-error, which we rethrow as fetch-style TypeError.
 */
async function forwarderFetch(url, init, forwarder) {
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = normalizeHeaders(init.headers);
  const body = normalizeBody(init.body);
  const spec = { url, method, headers, timeout_ms: 90000 };
  if (forwarder.proxy !== undefined) spec.proxy = forwarder.proxy;
  if (init.redirect !== undefined) spec.redirect = init.redirect;
  let response;
  try {
    response = await fetch(forwarder.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-sidecar-spec": Buffer.from(JSON.stringify(spec)).toString("base64"),
      },
      ...(body !== undefined ? { body } : {}),
      ...(init.signal !== undefined ? { signal: init.signal } : {}),
    });
  } catch (error) {
    throw new TypeError(`fetch failed: forwarder unreachable (${sanitize(error)})`, { cause: error });
  }
  const marker = response.headers.get("x-sidecar-error");
  if (response.status === 502 && marker !== null) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 200); } catch {}
    throw new TypeError(`fetch failed: forwarder ${marker}${detail !== "" ? ` (${detail})` : ""}`);
  }
  return response;
}

/* ------------------------------------------------------------------ */
/* transports                                                          */
/* ------------------------------------------------------------------ */

function httpsViaConnect(target, proxyUrl, method, headers, body, signal) {
  const proxy = new URL(proxyUrl);
  const port = target.port !== "" ? Number(target.port) : 443;
  return new Promise((resolve, reject) => {
    const open = [];
    let settled = false;
    const cleanup = () => {
      if (signal !== undefined && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
    };
    const onAbort = () => {
      for (const handle of open) handle.destroy?.();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal?.aborted === true ? abortReason(signal) : error);
    };
    const done = (response) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };
    if (signal !== undefined && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const connectHeaders = { host: `${target.hostname}:${port}` };
    const proxyAuth = basicProxyAuth(proxy);
    if (proxyAuth !== undefined) connectHeaders["proxy-authorization"] = proxyAuth;
    const connectReq = http.request({
      host: proxy.hostname,
      port: proxy.port !== "" ? Number(proxy.port) : 80,
      method: "CONNECT",
      path: `${target.hostname}:${port}`,
      headers: connectHeaders,
      signal,
    });
    open.push(connectReq);
    connectReq.on("error", (error) => fail(new TypeError(`fetch failed: proxy CONNECT ${sanitize(error)}`, { cause: error })));
    connectReq.on("response", (res) => {
      res.resume();
      fail(new TypeError(`fetch failed: proxy CONNECT rejected with ${res.statusCode}`));
    });
    connectReq.on("connect", (connectRes, socket) => {
      if (connectRes.statusCode !== 200) {
        socket.destroy();
        fail(new TypeError(`fetch failed: proxy CONNECT rejected with ${connectRes.statusCode}`));
        return;
      }
      const request = https.request({
        socket,
        agent: false,
        servername: target.hostname,
        method,
        path: pathWithQuery(target),
        headers,
      });
      open.push(request);
      request.on("error", (error) => fail(new TypeError(`fetch failed: ${sanitize(error)}`, { cause: error })));
      request.on("response", (res) => {
        collect(res).then(done, (error) => fail(error));
      });
      if (signal?.aborted === true) {
        request.destroy();
        fail(abortReason(signal));
        return;
      }
      request.end(body);
    });
    connectReq.end();
  });
}

function httpViaProxy(target, proxyUrl, method, headers, body, signal) {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxy.hostname,
      port: proxy.port !== "" ? Number(proxy.port) : 80,
      method,
      path: target.href,
      headers: { ...headers, host: headers.host ?? target.host },
      signal,
    });
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(signal?.aborted === true ? abortReason(signal) : error);
    };
    let settled = false;
    const proxyAuth = basicProxyAuth(proxy);
    if (proxyAuth !== undefined) request.setHeader("proxy-authorization", proxyAuth);
    request.on("error", (error) => fail(new TypeError(`fetch failed: ${sanitize(error)}`, { cause: error })));
    request.on("response", (res) => {
      collect(res).then((response) => {
        if (settled) return;
        settled = true;
        resolve(response);
      }, fail);
    });
    if (signal?.aborted === true) {
      request.destroy();
      fail(abortReason(signal));
      return;
    }
    request.end(body);
  });
}

/* ------------------------------------------------------------------ */
/* plumbing                                                            */
/* ------------------------------------------------------------------ */

function collect(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
      // Null-body statuses (204/304) and empty streams must construct a
      // bodiless Response; an empty Buffer is not null and would throw.
      const payload = chunks.length === 0 ? null : Buffer.concat(chunks);
      resolve(new Response(payload, {
        status: res.statusCode ?? 502,
        headers: headersFromRaw(res),
      }));
    });
    res.on("error", reject);
  });
}

function headersFromRaw(res) {
  const pairs = [];
  const raw = res.rawHeaders ?? [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
  return new Headers(pairs);
}

function pathWithQuery(target) {
  return target.pathname + target.search;
}

function normalizeHeaders(raw) {
  const headers = {};
  if (raw === undefined || raw === null) return headers;
  if (typeof raw.forEach === "function" && typeof raw.get === "function") {
    raw.forEach((value, key) => { headers[String(key).toLowerCase()] = String(value); });
  } else if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (Array.isArray(entry) && entry.length >= 2) headers[String(entry[0]).toLowerCase()] = String(entry[1]);
    }
  } else if (typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined) headers[String(key).toLowerCase()] = String(value);
    }
  }
  delete headers["host"];
  return headers;
}

function withoutBodyHeaders(raw) {
  if (raw === undefined || raw === null) return raw;
  const drop = new Set(["content-type", "content-length", "content-encoding"]);
  if (typeof raw.forEach === "function" && typeof raw.get === "function") {
    const copy = new Headers();
    raw.forEach((value, key) => {
      if (!drop.has(String(key).toLowerCase())) copy.append(key, value);
    });
    return copy;
  }
  const copy = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (Array.isArray(entry) && entry.length >= 2 && !drop.has(String(entry[0]).toLowerCase())) copy[entry[0]] = entry[1];
    }
  } else if (typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (!drop.has(String(key).toLowerCase())) copy[key] = value;
    }
  }
  return copy;
}

function normalizeBody(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return Buffer.from(body.toString());
  return Buffer.from(String(body));
}

function basicProxyAuth(proxy) {
  if (proxy.username === "" && proxy.password === "") return undefined;
  const user = decodeURIComponent(proxy.username);
  const pass = decodeURIComponent(proxy.password);
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) throw abortReason(signal);
}

function abortReason(signal) {
  return signal?.reason !== undefined ? signal.reason : new DOMException("This operation was aborted", "AbortError");
}

function sanitize(error) {
  const raw = error && error.message ? String(error.message) : String(error);
  return raw.replace(/\s+/g, " ").slice(0, 140);
}

async function drain(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    /* already consumed */
  }
}
