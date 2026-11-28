// tests/time.test.js — the web seam declares publishedAt as ISO-8601.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isoPublishedAt } from "../lib/util/time.js";

test("isoPublishedAt normalizes date-shaped values and drops relative/invalid ones", () => {
  assert.equal(isoPublishedAt("2024-01-02"), "2024-01-02T00:00:00.000Z");
  assert.equal(isoPublishedAt("2024-01-02T03:04:05Z"), "2024-01-02T03:04:05.000Z");
  assert.equal(isoPublishedAt("2 days ago"), undefined);
  assert.equal(isoPublishedAt("2024-13-40"), undefined);
  assert.equal(isoPublishedAt(undefined), undefined);
  assert.equal(isoPublishedAt(1700000000000), undefined);
});
