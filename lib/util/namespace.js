/**
 * Locate this plugin's row in a settings `describe()` result.
 *
 * DSH 0.2.x keys namespaces by the profile entry id (`entry.options.id`),
 * which for this plugin is `dsh-websearch`. Older hosts used the settings
 * NAMESPACE `unified-search`. A host may expose several namespaces with
 * generic field names such as `numResults`, so a shape-only match can select
 * another plugin's row and make a write land in the wrong namespace.
 * Prefer the exact ids; only fall back to the shape when neither id is
 * present, and require at least two plugin-specific fields in that case.
 *
 * @param {unknown} rows - `settings.describe()` output.
 * @returns {object|undefined} the matching row (with `.value`).
 */
const PROFILE_ID = "dsh-websearch";
const LEGACY_ID = "unified-search";
const SHAPE_FIELDS = ["searxngBaseURL", "enableFirecrawl", "firecrawlBaseURL", "enableTinyfish", "tinyfishBaseURL"];

export function findPluginRow(rows) {
  if (!Array.isArray(rows)) return undefined;
  const candidates = rows.filter((row) => row !== null && typeof row === "object" && typeof row.ns === "string");
  const byId = candidates.find((row) => row.ns === PROFILE_ID)
    ?? candidates.find((row) => row.ns === LEGACY_ID);
  if (byId) return byId;
  return candidates.find((row) => row.value !== undefined && row.value !== null
    && typeof row.value === "object"
    && SHAPE_FIELDS.filter((key) => Object.hasOwn(row.value, key)).length >= 2);
}
