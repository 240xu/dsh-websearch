// util/failure-label.js — short user-facing classification of a backend
// failure for the telemetry line ("[websearch backends] ... searxng ✗...").
//
// The raw reason stays the machine-facing truth (all-fail error, health
// payload); the telemetry line is what the model/user reads next to results,
// where "SearXNG: invalid JSON response" reads like a plugin bug while it
// actually means "the instance served an anti-bot page" (route3/route6).
// Pure and zero-dep: returns undefined when no confident class matches, so
// the caller keeps the raw text as fallback.

/**
 * @param {string} id backend id (searxng gets a dedicated phrasing)
 * @param {string} raw failure message (already truncated by the caller)
 * @returns {string|undefined} short label, or undefined to keep the raw text
 */
export function failureLabel(id, raw) {
  const m = String(raw ?? "");
  if (m === "") return undefined;
  if (/(invalid JSON|anti-bot|not a bot|antibot|captcha|challenge page|verifying your browser)/i.test(m)) {
    return id === "searxng"
      ? "instance degraded (anti-bot/non-JSON page)"
      : "non-JSON response (bot wall?)";
  }
  if (/timed out after \d+ms/.test(m)) return "timeout (network slow/blocked)";
  // Proxy/forwarder-path failures get their own class: the route5 incident
  // (harness EnvHttpProxyAgent hijacking the sidecar request) surfaced as a
  // generic "fetch failed", pointing the reader at DNS/TLS when the actual
  // fault was the proxy/egress hop.
  if (/(proxy|tunnel|forwarder|CONNECT)/i.test(m)) return "proxy/forwarder path failed";
  if (/(fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EPIPE|socket hang up)/i.test(m)) {
    return "network unreachable (DNS/TCP/TLS)";
  }
  if (/HTTP 429|Too Many Requests|rate.?limit/i.test(m)) return "rate-limited (HTTP 429)";
  const s5 = /HTTP (5\d\d)/.exec(m);
  if (s5) return "server error (HTTP " + s5[1] + ")";
  const s4 = /HTTP (40[13]|\b403\b)/.exec(m);
  if (s4) return "blocked (HTTP " + s4[1] + ")";
  if (/lacks a results\[\] array|not a SearXNG API/.test(m)) return "unexpected API shape";
  return undefined;
}
