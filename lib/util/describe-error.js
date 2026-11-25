// util/describe-error.js — cause-chain-aware one-line error description.
//
// Native fetch (undici, including the EnvHttpProxyAgent / ProxyAgent paths a
// harness may install as its global dispatcher) reports the actionable
// failure — getaddrinfo ENOTFOUND, ECONNREFUSED, proxy CONNECT failure, TLS
// error, timeout — on `error.cause`, while String(error) yields a bare
// "TypeError: fetch failed". Failure wrappers that interpolate the bare form
// leave the model/user unable to tell "DNS dead" from "proxy rejected" from
// "sidecar stalled". This helper walks the cause chain (bounded depth and
// length) and joins it into one line so the detail survives into mcp-client
// wraps, backend wraps, the provider's all-fail enumeration, the telemetry
// line and the health payload.

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_LEN = 220;

/** One-line description of `error`, following up to maxDepth causes. */
export function describeError(error, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(0, options.maxDepth) : DEFAULT_MAX_DEPTH;
  const maxLen = Number.isFinite(options.maxLen) ? Math.max(40, options.maxLen) : DEFAULT_MAX_LEN;
  const parts = [];
  let current = error;
  for (let depth = 0; current !== undefined && current !== null && depth <= maxDepth; depth++) {
    const text = oneLiner(current);
    if (text !== "" && parts[parts.length - 1] !== text) parts.push(text);
    // undici sometimes aggregates several socket errors under one cause;
    // surface up to two of them instead of a useless "AggregateError: []".
    if (current instanceof AggregateError && Array.isArray(current.errors) && current.errors.length > 0) {
      for (const sub of current.errors.slice(0, 2)) {
        const subText = oneLiner(sub);
        if (subText !== "" && !parts.includes(subText)) parts.push(subText);
      }
      break;
    }
    current = current?.cause;
  }
  if (parts.length === 0) return "";
  let out = parts[0];
  if (parts.length > 1) out += " (cause: " + parts.slice(1).join(" <- ") + ")";
  return out.length > maxLen ? out.slice(0, maxLen - 1) + "…" : out;
}

function oneLiner(value) {
  let text;
  if (value instanceof Error) {
    const name = value.name && value.name !== "Error" ? value.name + ": " : "";
    const message = String(value.message ?? "");
    // Keep the errno-style code when the message does not already carry it
    // (e.g. code ENOTFOUND with message "fetch failed"). Only E*/UND_ERR_*
    // codes qualify — host error codes like "WEB_PROVIDER_ERROR" are
    // transport metadata, not message text.
    const codeOk = typeof value.code === "string" && /^(E[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(value.code) && !message.includes(value.code);
    text = name + (codeOk ? value.code + " " : "") + message;
  } else {
    text = String(value);
  }
  return text.replace(/\s+/g, " ").trim();
}
