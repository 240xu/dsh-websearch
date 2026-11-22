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
PATCH="$PF/patches/@240xu__dsh-websearch@2.8.4.patch"
G5="$D/g5/G5-authoritative.patch"
VER=2.8.4

echo "== 1/5 verify patch source"
[[ -f "$G5" ]] || { echo "missing $G5" >&2; exit 1; }
[[ "$(grep -c '^diff --git' "$G5")" -ge 35 ]] || { echo "G5 has too few segments" >&2; exit 1; }
mkdir -p "$PF/patches"; cp "$G5" "$PATCH"

echo "== 2/5 pin $VER and enforce the patch"
python3 - "$PF" <<'PY'
import json, pathlib, sys
pf = pathlib.Path(sys.argv[1])
p = pf / 'package.json'
d = json.loads(p.read_text())
d.setdefault('dependencies', {})['@240xu/dsh-websearch'] = '2.8.4'
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
w = pf / 'pnpm-workspace.yaml'
s = w.read_text()
if 'patchedDependencies' not in s:
    s = s.rstrip('\n') + """

patchedDependencies:
  '@240xu/dsh-websearch@2.8.4': patches/@240xu__dsh-websearch@2.8.4.patch
"""
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
