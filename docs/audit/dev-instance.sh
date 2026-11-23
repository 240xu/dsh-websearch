#!/usr/bin/env bash
# Run a second dsh web instance on its own port and its own DSH_HOME so code
# changes can be exercised WITHOUT restarting the service that hosts the live
# session (port 3080, dsh-web.service). Restarting that service kills the
# agent's own process tree.
#
# Layout: $DEV_HOME/profiles/web -> $MAIN_HOME/profiles/web (shared plugin code)
#         $DEV_HOME/{.credentials.yaml,llm.env} symlinked, everything else
#         (cache/, history, settings) stays private to the dev instance.
#
# Usage: bash dev-instance.sh {start|stop|status|restart} [PORT]
set -euo pipefail
PORT="${2:-3081}"
DEV=/home/dsh/.dsh-dev
MAIN=/home/dsh/.dsh
PIDFILE="/tmp/dsh-dev-${PORT}.pid"
LOGFILE="/tmp/dsh-dev-${PORT}.log"
NODE=/opt/node24/bin/node
BIN=/opt/dsh-0222/node_modules/@deepseek-ai/dsh/lib/bin.js

prepare() {
  mkdir -p "$DEV/profiles"
  [[ -e "$DEV/profiles/web" ]] || ln -s "$MAIN/profiles/web" "$DEV/profiles/web"
  for f in .credentials.yaml llm.env; do
    [[ -e "$DEV/$f" ]] || ln -s "$MAIN/$f" "$DEV/$f"
  done
}

status() {
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "running: 127.0.0.1:${PORT} (pid $(cat "$PIDFILE")) home=${DEV}"
    return 0
  fi
  echo "not running (${PORT})"
  return 1
}

start() {
  status >/dev/null 2>&1 && { status; return 0; }
  prepare
  # The env mirrors the service's, minus DSH_EGRESS_FORWARDER: the sidecar at
  # 172.30.0.1:13070 has no listener, and 2.8.8+ builds would fail every request.
  env -u DSH_EGRESS_FORWARDER \
    DSH_HOME="$DEV" DSH_PROFILE=web \
    DSH_WEB_FETCH_PROVIDER=http \
    DSH_PERMISSION_MODE="${DSH_PERMISSION_MODE:-danger-full-access}" \
    HTTP_PROXY=http://172.30.66.1:1091 HTTPS_PROXY=http://172.30.66.1:1091 \
    NO_PROXY=127.0.0.1,localhost,::1 \
    DEEPSEEK_API_KEY="$(grep -oE 'DEEPSEEK_API_KEY=.*' "$MAIN/llm.env" 2>/dev/null | head -1 | cut -d= -f2-)" \
    DEEPSEEK_BASE_URL="$(grep -oE 'DEEPSEEK_BASE_URL=.*' "$MAIN/llm.env" 2>/dev/null | head -1 | cut -d= -f2-)" \
    nohup "$NODE" "$BIN" web --no-open --host 127.0.0.1 --port "$PORT" --trusted-host 127.0.0.1 \
    > "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  for _ in $(seq 1 40); do
    sleep 0.5
    if curl -sS -m 2 -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then break; fi
  done
  status
  grep -oE 'http://127.0.0.1:'"${PORT}"'/\?token=[A-Za-z0-9_-]+' "$LOGFILE" 2>/dev/null | tail -1
}

stop() {
  if [[ -f "$PIDFILE" ]]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  # A stale PIDFILE (or a failed start that lost the port race) leaves the real
  # listener alive; kill by port so stop is always effective.
  local holder
  holder="$(ss -ltnp 2>/dev/null | grep ":${PORT} " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"
  if [[ -n "$holder" ]]; then kill "$holder" 2>/dev/null || true; fi
  sleep 2
  echo "stopped ${PORT}"
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; shift; start ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|restart|status} [PORT]" >&2; exit 2 ;;
esac
