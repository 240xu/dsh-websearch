/**
 * Validation for operator-supplied backend base URLs.
 *
 * A base URL decides where the backend connects AND where its API key is
 * sent, so it is a trust boundary, not a formatting preference: only HTTPS,
 * plus plain HTTP for loopback/RFC1918 self-hosted instances. Embedded
 * credentials are rejected because the caller supplies the key separately.
 * Link-local ranges are rejected regardless of scheme — they host instance
 * metadata, not a search service, and an attacker-controlled settings write
 * must not turn the plugin into a metadata client.
 *
 * @module lib/util/base-url
 */

/** Hosts that may be reached over plain HTTP (self-hosted SearXNG etc.). */
const PRIVATE_HOST_RE = /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;

/** Always-off-limits hosts: cloud instance metadata and the unspecified address. */
const BLOCKED_HOST_RE = /^(::|0\.0\.0\.0|169\.254\.\d{1,3}\.\d{1,3}|metadata(\.google\.internal)?|instance-data)$/;

/**
 * Why a candidate base URL is unusable, or `undefined` when it is allowed.
 *
 * @param {unknown} raw - candidate URL string.
 * @returns {string|undefined} short reason suitable for an error message.
 */
export function invalidBaseURL(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return "empty URL";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "not a URL";
  }
  if (url.username !== "" || url.password !== "") return "credentials in URL rejected";
  // URL.hostname keeps brackets on IPv6 literals.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.+$/, "");
  if (BLOCKED_HOST_RE.test(host)
      || /^fe[89ab][0-9a-f]:/.test(host)
      || host === "fd00:ec2::254"
      || host === "::ffff:0:0"
      || /^::ffff:(a9fe|fe[89ab])/i.test(host)) return "link-local host rejected";
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:" && (PRIVATE_HOST_RE.test(host) || host === "::1")) return undefined;
  return "https required (plain http only for private hosts)";
}

/**
 * True when the single candidate is allowed. Convenience wrapper for callers that
 * only need a boolean.
 *
 * @param {unknown} raw - candidate URL string.
 * @returns {boolean} whether the URL passed validation.
 */
export function isAllowedBaseURL(raw) {
  return invalidBaseURL(raw) === undefined;
}
