#!/usr/bin/env bash
# health.test.mjs is plain node asserts (no node:test wrapper), so it cannot be
# picked up by `node --test tests/*.test.js`. Run it separately.
set -euo pipefail
cd "$(dirname "$0")/.."
node tests/up-health.test.mjs
