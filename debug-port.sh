#!/usr/bin/env bash
# Open a second local port that forwards to the running dsh web instance.
#
# Why: the Harness web server binds a single --port, and its browser-trust
# fence only accepts the authorities listed in --trusted-host. To debug the
# plugin's UI from another port (or another browser profile) without restarting
# the service, forward a spare loopback port to the live one.
#
# Usage:
#   bash debug-port.sh start [LISTEN_PORT] [TARGET_PORT]
#   bash debug-port.sh stop  [LISTEN_PORT]
#   bash debug-port.sh status
set -euo pipefail
LISTEN="${2:-3090}"
TARGET="${3:-3080}"
PIDFILE="/tmp/dsh-debug-port-${LISTEN}.pid"
LOGFILE="/tmp/dsh-debug-port-${LISTEN}.log"

status() {
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "listening: 127.0.0.1:${LISTEN} -> 127.0.0.1:${TARGET} (pid $(cat "$PIDFILE"))"
  else
    echo "not running (${LISTEN})"
    return 1
  fi
}

case "${1:-start}" in
  start)
    status >/dev/null 2>&1 && { status; exit 0; }
    command -v socat >/dev/null || { echo "socat is required" >&2; exit 1; }
    # Bind loopback only: this is a debugging aid, never expose it off-host.
    nohup socat "TCP-LISTEN:${LISTEN},reuseaddr,fork,bind=127.0.0.1" "TCP:127.0.0.1:${TARGET}" \
      > "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 1
    status
    echo "open: http://127.0.0.1:${LISTEN}/?token=<DSH_WEB_TOKEN>"
    ;;
  stop)
    if [[ -f "$PIDFILE" ]]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi
    echo "stopped ${LISTEN}"
    ;;
  status)
    status
    ;;
  *)
    echo "usage: $0 {start|stop|status} [LISTEN_PORT] [TARGET_PORT]" >&2
    exit 2
    ;;
esac
