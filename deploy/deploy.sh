#!/usr/bin/env bash
# Lock In — deploy the latest main to the server, from your own computer.
#
#   npm run deploy
#
# Logs in as the limited "lockin-deploy" user, which can only run the server's
# update script, then checks the live site from here.
#
# Settings (override in deploy/.deploy.env, which is not committed):
#   LOCKIN_HOST   server address            default: lockin.mayoelitesolutions.com
#   LOCKIN_URL    public URL of the app     default: https://$LOCKIN_HOST
#   LOCKIN_KEY    private key to use        default: ~/.ssh/lockin_deploy
#   ALSO_CHECK    other URLs that share the server and must still answer after a
#                 deploy, as "url=expected-size" pairs separated by spaces
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$HERE/.deploy.env" ]; then set -a; . "$HERE/.deploy.env"; set +a; fi

HOST="${LOCKIN_HOST:-lockin.mayoelitesolutions.com}"
URL="${LOCKIN_URL:-https://$HOST}"
KEY="${LOCKIN_KEY:-$HOME/.ssh/lockin_deploy}"
ALSO_CHECK="${ALSO_CHECK:-}"

echo "== Updating the server ($HOST)"
ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 "lockin-deploy@$HOST" update
STATUS=$?
if [ "$STATUS" -ne 0 ]; then echo; echo "!! The server update reported a problem (exit $STATUS). Checking the sites anyway."; fi

echo
echo "== Checking from here"
FAIL=0
check() { # url, expected size (optional), label
  local out code size
  out="$(curl -sS -m 20 -L -o /dev/null -w '%{http_code} %{size_download}' "$1" 2>/dev/null)"; code="${out%% *}"; size="${out##* }"
  if [ "$code" = 200 ] && { [ -z "${2:-}" ] || [ "$size" = "$2" ]; }; then printf '  PASS  %s  (%s bytes)\n' "$1" "$size"
  else printf '  FAIL  %s  (status %s, %s bytes%s)\n' "$1" "$code" "$size" "${2:+, expected $2}"; FAIL=1; fi
}
check "$URL/"
BOOT="$(curl -sS -m 20 "$URL/api/bootstrap" 2>/dev/null)"
case "$BOOT" in *hasGroups*) printf '  PASS  %s/api/bootstrap  %s\n' "$URL" "$BOOT" ;; *) printf '  FAIL  %s/api/bootstrap  %s\n' "$URL" "$BOOT"; FAIL=1 ;; esac
for pair in $ALSO_CHECK; do check "${pair%%=*}" "$( [ "$pair" != "${pair#*=}" ] && printf '%s' "${pair#*=}" )"; done

echo
if [ "$STATUS" -eq 0 ] && [ "$FAIL" -eq 0 ]; then echo "Deploy OK."; exit 0; fi
echo "Deploy needs attention. See deploy/RUNBOOK.md."; exit 1
