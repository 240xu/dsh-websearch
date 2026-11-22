#!/usr/bin/env bash
# Regenerate the authoritative patch from the publish repo and verify it
# reconstructs src-work byte-for-byte on a clean npm 2.8.4 tree.
# Run this AFTER every code commit, otherwise the patch becomes a stale
# snapshot that reintroduces fixed bugs (A1 finding, 2026-11-15).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Works both from the artifacts tree (g5/) and from the checked-out branch
# (where publish-work/repo is the repository root itself).
if [[ -d "$HERE/../publish-work/repo/.git" ]]; then
  R="$(cd "$HERE/../publish-work/repo" && pwd)"
  S="$(cd "$HERE/../src-work/plugin" && pwd)"
  BASE="$HERE/../publish-work/base/package"
elif [[ -d "$HERE/../.git" ]]; then
  R="$(cd "$HERE/.." && pwd)"
  S="/home/ova/dsh/.artifacts/websearch-research/src-work/plugin"
  BASE="/home/ova/dsh/.artifacts/websearch-research/publish-work/base/package"
else
  echo "cannot locate the publish repo from $HERE" >&2; exit 1
fi
G="$HERE"
OUT="$G/G5-authoritative.patch"

# `.gitignore` is publish-repo bookkeeping (it only ignores node_modules to
# keep the branch clean); it is NOT part of the plugin patch and must not be
# applied to the installed tree. Keep the range to the shipped surface.
git -C "$R" diff d2602823 HEAD -- lib tests README.md package.json > "$OUT"
[[ "$(grep -c '^diff --git' "$OUT")" -ge 35 ]] || { echo "patch has fewer than 35 segments" >&2; exit 1; }

V="$(mktemp -d)"; trap 'rm -rf "$V"' EXIT
cp -a "$BASE/." "$V/"
(cd "$V" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm base \
  && git apply --check "$OUT" 2>/dev/null && git apply "$OUT" 2>/dev/null)

MOD="lib/util/egress-fetch.js lib/util/mcp-client.js lib/util/failure-label.js lib/index.js lib/client.js lib/cache.js lib/health.js lib/history.js lib/provider.js lib/settings-api.js lib/breaker.js lib/backends/exa.js lib/backends/parallel.js lib/backends/tavily.js lib/backends/serper.js lib/backends/brave.js lib/backends/mojeek.js lib/backends/ddg.js lib/backends/searxng.js lib/backends/openai.js lib/backends/anthropic-like.js README.md package.json lib/util/namespace.js lib/util/web-error.js lib/backends/firecrawl.js lib/backends/tinyfish.js tests/lead-20261106.test.js tests/lead-20261107.test.js tests/lead-20261107-p0.test.js tests/lead-20261108-interaction.test.js tests/lead-20261108-quota.test.js tests/lead-20261108-sse.test.js tests/lead-20261109-3b-runtime.test.js tests/settings-api.test.js"
n=0; for f in $MOD; do cmp -s "$V/$f" "$S/$f" && n=$((n+1)) || echo "DIFF $f" >&2; done
echo "G5-authoritative.patch: $(wc -l < "$OUT") lines, $(grep -c '^diff --git' "$OUT") segments, $n/35 byte-identical"
[[ "$n" -eq 35 ]] || exit 1

# Keep the artifacts-tree copy and the branch checkout byte-identical.
# A1 (2026-11-15) found these two drifted when refresh ran from one side only.
OTHER=""
if [[ "$OUT" == "$R/g5/G5-authoritative.patch" ]]; then
  OTHER="/home/ova/dsh/.artifacts/websearch-research/g5/G5-authoritative.patch"
else
  OTHER="$R/g5/G5-authoritative.patch"
fi
if [[ -f "$(dirname "$OTHER")/refresh.sh" || -d "$(dirname "$OTHER")" ]]; then
  cp "$OUT" "$OTHER"
  cmp -s "$OUT" "$OTHER" || { echo "two authoritative copies diverged" >&2; exit 1; }
  echo "both copies identical: $(md5sum "$OUT" | cut -c1-12)"
fi
