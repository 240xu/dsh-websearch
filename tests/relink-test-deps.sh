#!/usr/bin/env bash
# Rebuild the six test-only @deepseek-ai symlinks against the runtime that is
# actually running. A runtime switch moves the checkout and leaves absolute
# links dangling, which makes `node --test` fail with ERR_MODULE_NOT_FOUND.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID="$(systemctl show -p MainPID --value dsh-web.service)"
[[ "$PID" =~ ^[0-9]+$ ]] || { echo "dsh-web.service has no live MainPID" >&2; exit 1; }
BIN="$(tr '\0' '\n' < "/proc/$PID/cmdline" | grep -E '/@deepseek-ai/dsh/lib/bin\.js$' | head -1)"
[[ -n "$BIN" && -f "$BIN" ]] || { echo "cannot locate dsh bin.js from MainPID $PID" >&2; exit 1; }
# bin.js lives at <root>/node_modules/@deepseek-ai/dsh/lib/bin.js;
# going up three directories lands on <root>/node_modules/@deepseek-ai.
SCOPE="$(dirname "$(dirname "$(dirname "$BIN")")")"
for p in cordis dsh-credentials dsh-launch-environment dsh-settings dsh-web schemastery; do
  [[ -d "$SCOPE/$p" ]] || { echo "missing runtime package: $SCOPE/$p" >&2; exit 1; }
  ln -sfn "$SCOPE/$p" "$HERE/node_modules/@deepseek-ai/$p"
done
echo "relinked 6 test deps -> $SCOPE"
