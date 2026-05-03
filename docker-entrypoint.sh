#!/bin/sh
set -eu

: "${PUID:=1000}"
: "${PGID:=1000}"
: "${DATA_DIR:=/data}"

case "$PUID" in
  ''|*[!0-9]*)
    echo "PUID must be a numeric user id." >&2
    exit 1
    ;;
esac

case "$PGID" in
  ''|*[!0-9]*)
    echo "PGID must be a numeric group id." >&2
    exit 1
    ;;
esac

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || {
    echo "Warning: could not change ownership of $DATA_DIR to $PUID:$PGID; continuing." >&2
  }
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
