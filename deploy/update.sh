#!/usr/bin/env bash
# Lock In — update the running app to the latest main.
#
# Installed on the server as /usr/local/sbin/lockin-update and run as root.
# It backs up the database, pulls the code, copies it into place, restarts the
# service only when server code changed, checks the app answers, and puts the
# previous version back if it doesn't.
#
# It only ever touches Lock In's own folders and service. It never touches the
# web server (Caddy/nginx), Docker, or any other app on the machine.
set -euo pipefail

SRC="${LOCKIN_SRC:-/root/lockin}"            # git checkout
APP="${LOCKIN_APP:-/opt/lockin}"             # where the service runs from
DATA="${LOCKIN_DATA:-/var/lib/lockin}"       # database + uploads
BACKUPS="${LOCKIN_BACKUPS:-/var/backups/lockin}"
UNIT="${LOCKIN_UNIT:-/etc/systemd/system/lockin.service}"
RESTART_CMD="${LOCKIN_RESTART_CMD:-systemctl restart lockin}"
SELF="${LOCKIN_SELF:-/usr/local/sbin/lockin-update}"
BRANCH="${LOCKIN_BRANCH:-main}"

say() { printf '==> %s\n' "$*"; }

PORT="${LOCKIN_PORT:-}"
if [ -z "$PORT" ] && [ -f "$UNIT" ]; then PORT="$(sed -n 's/^Environment=PORT=\([0-9][0-9]*\)$/\1/p' "$UNIT" | head -1)"; fi
PORT="${PORT:-3100}"

healthy() {
  for _ in $(seq 1 20); do
    if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/bootstrap" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

copy_into_place() {
  rsync -a --delete --exclude node_modules --exclude data --exclude .git "$SRC"/ "$APP"/
}

cd "$SRC"
OLD="$(git rev-parse HEAD)"
git fetch -q origin "$BRANCH"
NEW="$(git rev-parse "origin/$BRANCH")"

if [ "$OLD" = "$NEW" ]; then
  say "Already on the latest version (${OLD:0:7})."
  if healthy; then say "App is answering on port $PORT."; exit 0; fi
  echo "!! App is NOT answering on port $PORT. Check: journalctl -u lockin -n 50" >&2
  exit 1
fi

CHANGED="$(git diff --name-only "$OLD" "$NEW")"
say "Updating ${OLD:0:7} -> ${NEW:0:7}"
printf '%s\n' "$CHANGED" | sed 's/^/    /'

mkdir -p "$BACKUPS"
BACKUP="$BACKUPS/pre-${NEW:0:7}.db"
if [ -f "$DATA/lockin.db" ]; then
  sqlite3 "$DATA/lockin.db" ".backup '$BACKUP'"
  say "Database backed up to $BACKUP"
fi

git merge -q --ff-only "origin/$BRANCH"
copy_into_place

DEPS_CHANGED=0; RESTART=0
if printf '%s\n' "$CHANGED" | grep -qx 'package-lock.json'; then DEPS_CHANGED=1; fi
if printf '%s\n' "$CHANGED" | grep -qE '^(server/|package(-lock)?\.json$)'; then RESTART=1; fi

if [ "$DEPS_CHANGED" = 1 ]; then
  say "Dependencies changed: installing"
  (cd "$APP" && npm ci --omit=dev --no-audit --no-fund)
fi

if [ "$RESTART" = 1 ]; then
  say "Server code changed: restarting the lockin service"
  $RESTART_CMD
else
  say "Only frontend files changed: no restart needed"
fi

if healthy; then
  say "App is answering on port $PORT."
else
  echo "!! App did not answer after the update. Putting ${OLD:0:7} back." >&2
  git reset -q --hard "$OLD"
  copy_into_place
  if [ "$DEPS_CHANGED" = 1 ]; then (cd "$APP" && npm ci --omit=dev --no-audit --no-fund); fi
  $RESTART_CMD
  if healthy; then
    echo "!! Rolled back to ${OLD:0:7}; the app is answering again." >&2
    echo "   The database was NOT rolled back. A copy from before this update is at $BACKUP" >&2
  else
    echo "!! Rolled back to ${OLD:0:7} but the app is STILL not answering. Check: journalctl -u lockin -n 50" >&2
  fi
  exit 1
fi

# Keep the 10 most recent pre-update backups.
ls -1t "$BACKUPS"/pre-*.db 2>/dev/null | tail -n +11 | while read -r f; do rm -f -- "$f"; done

# Keep this installed script in step with the repo.
if [ -f "$SRC/deploy/update.sh" ] && [ -n "$SELF" ] && [ -d "$(dirname "$SELF")" ]; then
  install -m 755 "$SRC/deploy/update.sh" "$SELF"
fi

say "Done. Live version: ${NEW:0:7}"
