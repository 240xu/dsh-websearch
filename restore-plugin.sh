#!/usr/bin/env bash
# Recover the patched @240xu/dsh-websearch tree in the web profile.
#
# Why this exists: the profile pins an exact version and the local patch is
# carried by pnpm `patchedDependencies`. Anything that resolves a different
# version (a manual `pnpm add`, an upstream bump, or a fresh install against a
# stale lockfile) silently replaces the patch with the clean tarball.
#
# Run this when `grep -c 'req.resume()' .../lib/settings-api.js` returns 0.
set -euo pipefail
D=/home/ova/dsh/.artifacts/websearch-research
PF=/home/dsh/.dsh/profiles/web
# The patch file, the dependency pin, and the patchedDependencies key must all
# name the SAME version, or pnpm refuses every operation in this profile with
# ERR_PNPM_UNUSED_PATCH. Nothing here is hardcoded to one release: pick the
# patch that matches the pin instead of silently reverting to an older one.
PF_PIN=$(python3 -c "import json,pathlib;print(json.loads(pathlib.Path('$PF/package.json').read_text())['dependencies']['@240xu/dsh-websearch'])")
VER="${1:-$PF_PIN}"
G5="$D/g5/G5-authoritative.patch"
if [[ -f "$D/g5/patch-288-from-clean-288.patch" && "$VER" == "2.8.8" ]]; then
  G5="$D/g5/patch-288-from-clean-288.patch"
fi
PATCH="$PF/patches/@240xu__dsh-websearch@$VER.patch"

echo "== 1/5 verify patch source"
[[ -f "$G5" ]] || { echo "missing $G5" >&2; exit 1; }
[[ "$(grep -c '^diff --git' "$G5")" -ge 35 ]] || { echo "G5 has too few segments" >&2; exit 1; }
mkdir -p "$PF/patches"; cp "$G5" "$PATCH"

echo "== 2/5 pin $VER and enforce the patch"
VER="$VER" python3 - "$PF" <<'PY'
import json, os, pathlib, sys
pf = pathlib.Path(sys.argv[1])
p = pf / 'package.json'
d = json.loads(p.read_text())
d.setdefault('dependencies', {})['@240xu/dsh-websearch'] = os.environ['VER']
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
w = pf / 'pnpm-workspace.yaml'
s = w.read_text()
import re, os
ver = os.environ['VER']
# Replace any existing key for this package: a stale key with a different
# version is exactly what strands the profile.
s = re.sub(r"\n?  '?@240xu/dsh-websearch@[0-9.]+'?: patches/@240xu__dsh-websearch@[0-9.]+\\.patch", "", s)
if 'patchedDependencies:' in s:
    s = s.replace('patchedDependencies:',
        "patchedDependencies:\n  '@240xu/dsh-websearch@" + ver + "': patches/@240xu__dsh-websearch@" + ver + ".patch", 1)
else:
    s = s.rstrip('\n') + "\n\npatchedDependencies:\n  '@240xu/dsh-websearch@" + ver + "': patches/@240xu__dsh-websearch@" + ver + ".patch\n"
w.write_text(s)
print('pin + patchedDependencies ok')
PY

echo "== 3/5 recompute the lockfile (does not touch node_modules)"
cd "$PF"
NODE=/opt/node24/bin/node
PNPM=/opt/node22/lib/node_modules/pnpm/bin/pnpm.cjs
HTTP_PROXY=http://172.30.66.1:1091 HTTPS_PROXY=http://172.30.66.1:1091 \
  "$NODE" "$PNPM" install --lockfile-only --no-frozen-lockfile

echo "== 4/5 install (applies the patch)"
# pnpm skips re-extraction when the lockfile already matches, so a tree that
# was damaged in place (overwritten files, a replaced version) would NOT be
# repaired by install alone. Remove the package directory first so pnpm
# re-extracts from the store and re-applies the patch.
rm -rf "$PF/node_modules/@240xu/dsh-websearch"
HTTP_PROXY=http://172.30.66.1:1091 HTTPS_PROXY=http://172.30.66.1:1091 \
  "$NODE" "$PNPM" install --frozen-lockfile

echo "== 5/5 verify"
I="$PF/node_modules/@240xu/dsh-websearch"
[[ "$(node -p "require('$I/package.json').version")" == "$VER" ]] || { echo "version mismatch" >&2; exit 1; }
for probe in 'req.resume()' 'sessionCacheKey' 'webCtx.effect'; do
  c=$(grep -rc "$probe" "$I/lib" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
  [[ "$c" -gt 0 ]] || { echo "patch marker missing: $probe" >&2; exit 1; }
done
n=0
for f in $(grep '^diff --git' "$PATCH" | sed 's#diff --git a/##; s# b/.*##'); do
  cmp -s "$I/$f" "$D/src-work/plugin/$f" 2>/dev/null && n=$((n+1))
done
echo "patched tree restored: $n segments byte-identical"
echo "now restart the service:  sudo systemctl restart dsh-web.service"
