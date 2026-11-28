#!/usr/bin/env bash
# Regenerate both authoritative patches from the working tree and verify that
# each one reconstructs `lib/` byte-for-byte from its published npm base.
#
#   g5/G5-authoritative.patch          npm 2.8.4  -> current tree (legacy line)
#   g5/patch-288-from-clean-288.patch  npm 2.8.8  -> current tree (profile pin)
#
# Run this AFTER every code change: a stale patch silently rolls fixed bugs back
# when `restore-plugin.sh` is used. The script never leaves a half-written patch
# in place — it writes to a temp file, verifies the applied tree, then moves it.
#
# Base trees are read from (in order): $DSH_WEBSEARCH_BASE288 / _BASE284, local
# artifact directories, or `npm pack <version>`.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT288="$HERE/patch-288-from-clean-288.patch"
OUT_G5="$HERE/G5-authoritative.patch"
BASELINE_COMMIT=d2602823
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch_base() {
  local version="$1" envvar="$2" out="$3"
  local configured="${!envvar:-}"
  local tag="${version//./}"
  for candidate in "$configured" "$HERE/base$version/package" "$HERE/base$tag/package" \
                   "$ROOT/../../g5/base$version/package" "$ROOT/../../g5/base$tag/package" \
                   "$ROOT/../../publish-work/base/package"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "fetching @240xu/dsh-websearch@$version via npm pack" >&2
  mkdir -p "$out"
  (cd "$out" && npm pack "@240xu/dsh-websearch@$version" --silent >/dev/null)
  local tgz
  tgz="$(find "$out" -maxdepth 1 -name '*.tgz' | head -1)"
  [[ -n "$tgz" ]] || { echo "cannot fetch base $version" >&2; return 1; }
  tar -xzf "$tgz" -C "$out"
  echo "$out/package"
}

verify_patch() {
  local patch="$1" base="$2" label="$3" work
  work="$(mktemp -d "${TMP}/verify.XXXXXX")"
  cp -a "$base/." "$work/"
  (cd "$work" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm base \
    && git apply --check "$patch" && git apply "$patch")
  local total=0 matched=0 file
  while IFS= read -r file; do
    total=$((total + 1))
    if cmp -s "$work/$file" "$ROOT/$file"; then
      matched=$((matched + 1))
    else
      echo "DIFF $file" >&2
    fi
  done < <(grep '^diff --git' "$patch" | sed 's#^diff --git a/##; s# b/.*##')
  echo "$label: $matched/$total files byte-identical ($(grep -c '^diff --git' "$patch") segments, $(wc -l < "$patch") lines)"
  [[ "$matched" -eq "$total" && "$total" -gt 0 ]]
}

BASE288="$(fetch_base 2.8.8 DSH_WEBSEARCH_BASE288 "$TMP/base288")"
BASE284="$(fetch_base 2.8.4 DSH_WEBSEARCH_BASE284 "$TMP/base284")"

# 2.8.8 -> working tree: stage the current lib over a clean 2.8.8 checkout.
WORK288="$(mktemp -d "${TMP}/gen288.XXXXXX")"
cp -a "$BASE288/." "$WORK288/"
(cd "$WORK288" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm base)
rm -rf "$WORK288/lib"
cp -a "$ROOT/lib" "$WORK288/lib"
(cd "$WORK288" && git add -A && git diff --cached -- lib > "$TMP/p288.patch")
verify_patch "$TMP/p288.patch" "$BASE288" "2.8.8 patch"
mv "$TMP/p288.patch" "$OUT288"

# 2.8.4 -> working tree: a full diff from the import commit, lib only.
git -C "$ROOT" diff "$BASELINE_COMMIT" -- lib > "$TMP/g5.patch"
verify_patch "$TMP/g5.patch" "$BASE284" "G5 (2.8.4 baseline)"
mv "$TMP/g5.patch" "$OUT_G5"

# Keep the artifacts-tree copies identical when this checkout is the publish repo.
ALT="$ROOT/../../g5"
if [[ -d "$ALT" && "$ALT" != "$HERE" ]]; then
  cp "$OUT288" "$ALT/patch-288-from-clean-288.patch"
  cp "$OUT_G5" "$ALT/G5-authoritative.patch"
  echo "artifacts copies synced: $ALT"
fi
echo "patches refreshed: $OUT288 ; $OUT_G5"
