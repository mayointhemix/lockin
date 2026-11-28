#!/usr/bin/env bash
# Lock In — one-time setup of a limited deploy user. Run once on the server as root:
#
#   cd /root/lockin && git pull --ff-only && bash deploy/setup-deploy-user.sh
#
# What it does:
#   - creates the user "lockin-deploy" with no password (key login only)
#   - lets the key in deploy/deploy-key.pub log in, and ONLY to run the update script
#   - installs the update script as /usr/local/sbin/lockin-update
#   - adds one sudo rule: lockin-deploy may run that script as root, nothing else
#
# It does not change the SSH server's settings. Root login over SSH stays as it is.
# Safe to run again. To undo: userdel -r lockin-deploy; rm /etc/sudoers.d/lockin-deploy /usr/local/sbin/lockin-update
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
USER_NAME=lockin-deploy
UPDATE=/usr/local/sbin/lockin-update
KEY_FILE="$HERE/deploy-key.pub"
[ -s "$KEY_FILE" ] || { echo "Missing $KEY_FILE"; exit 1; }
KEY="$(head -1 "$KEY_FILE")"
case "$KEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;; *) echo "deploy-key.pub does not look like a public key"; exit 1 ;; esac

echo "==> User"
if ! id "$USER_NAME" >/dev/null 2>&1; then useradd --create-home --shell /bin/bash "$USER_NAME"; fi
passwd -l "$USER_NAME" >/dev/null   # no password login, ever

echo "==> Update script"
install -m 755 "$HERE/update.sh" "$UPDATE"

echo "==> Key (can only run the update script; no shell, no forwarding)"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
printf 'restrict,command="sudo -n %s" %s\n' "$UPDATE" "$KEY" > "/home/$USER_NAME/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"
chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"

echo "==> Sudo rule"
TMP="$(mktemp)"
printf '%s ALL=(root) NOPASSWD: %s\n' "$USER_NAME" "$UPDATE" > "$TMP"
visudo -cf "$TMP" >/dev/null
install -m 440 -o root -g root "$TMP" "/etc/sudoers.d/$USER_NAME"
rm -f "$TMP"

# An earlier attempt added this same key to root's own list. Root login over SSH is
# disabled on this server, so it did nothing; take it back out.
ROOT_KEYS=/root/.ssh/authorized_keys
KEY_BODY="$(printf '%s' "$KEY" | awk '{print $2}')"
if [ -f "$ROOT_KEYS" ] && grep -qF "$KEY_BODY" "$ROOT_KEYS"; then
  cp -a "$ROOT_KEYS" "$ROOT_KEYS.bak-lockin"
  grep -vF "$KEY_BODY" "$ROOT_KEYS.bak-lockin" > "$ROOT_KEYS" || true
  chmod 600 "$ROOT_KEYS"
  echo "==> Removed the deploy key from root's list ($(grep -c . "$ROOT_KEYS") other key(s) kept)"
fi

echo
echo "SSH server settings that affect this (unchanged):"
sshd -T 2>/dev/null | grep -iE '^(permitrootlogin|pubkeyauthentication|allowusers|allowgroups|denyusers|denygroups) ' || true
echo
echo "Done. From the Mac:  npm run deploy"
