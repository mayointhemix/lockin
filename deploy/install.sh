#!/usr/bin/env bash
# Lock In — one-shot installer for Ubuntu/Debian (e.g. Hetzner).
# Usage: sudo ./deploy/install.sh lockin.yourdomain.com
# Safe to re-run (updates code, keeps data). Never touches other sites on the server.
set -euo pipefail

DOMAIN="${1:-}"
[ -z "$DOMAIN" ] && { echo "Usage: sudo $0 your.subdomain.com"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }

APP_DIR=/opt/lockin
DATA_DIR=/var/lib/lockin
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3100}"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

say "Checking DNS for $DOMAIN"
MYIP=$(curl -4 -s https://api.ipify.org || true)
DNSIP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
echo "This server: ${MYIP:-unknown}   $DOMAIN points to: ${DNSIP:-nothing yet}"
if [ -n "$MYIP" ] && [ "$MYIP" != "$DNSIP" ]; then
  echo "!! $DOMAIN does not point at this server yet. Add an A record: $DOMAIN -> $MYIP"
  echo "   HTTPS will fail until it does. Continue anyway? [y/N]"; read -r ok; [ "$ok" = "y" ] || exit 1
fi

say "Installing Node.js 22 (if needed)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  apt-get update -y && apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y sqlite3 rsync >/dev/null 2>&1 || true

say "Picking a free internal port"
while ss -ltn | awk '{print $4}' | grep -qE "[:.]$PORT\$"; do
  if [ -f /etc/systemd/system/lockin.service ] && grep -q "PORT=$PORT" /etc/systemd/system/lockin.service; then break; fi
  PORT=$((PORT+1))
done
echo "Lock In will listen on 127.0.0.1:$PORT"

say "Copying app to $APP_DIR"
id lockin >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin lockin
mkdir -p "$APP_DIR" "$DATA_DIR" /var/backups/lockin
rsync -a --delete --exclude node_modules --exclude data --exclude .git "$SRC_DIR"/ "$APP_DIR"/
cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund
chown -R lockin:lockin "$DATA_DIR"

say "Creating systemd service"
cat > /etc/systemd/system/lockin.service <<UNIT
[Unit]
Description=Lock In accountability app
After=network.target

[Service]
User=lockin
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=DATA_DIR=$DATA_DIR
Environment=PUSH_CONTACT=https://$DOMAIN
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now lockin
systemctl restart lockin

say "Setting up HTTPS in front of the app"
WEB=$(ss -ltnp 2>/dev/null | grep -E ':(80|443)\s' | grep -oE '"[a-z0-9_-]+"' | tr -d '"' | sort -u | head -1 || true)
echo "Web server currently on ports 80/443: ${WEB:-none}"
case "$WEB" in
  nginx)
    apt-get install -y certbot python3-certbot-nginx >/dev/null
    cat > /etc/nginx/sites-available/lockin <<NGX
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 110M;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
NGX
    [ -d /etc/nginx/sites-enabled ] && ln -sf /etc/nginx/sites-available/lockin /etc/nginx/sites-enabled/lockin \
      || cp /etc/nginx/sites-available/lockin /etc/nginx/conf.d/lockin.conf
    nginx -t && systemctl reload nginx
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
    ;;
  caddy|"")
    if ! command -v caddy >/dev/null; then
      apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -y && apt-get install -y caddy
    fi
    touch /etc/caddy/Caddyfile
    sed -i "/# lockin-begin/,/# lockin-end/d" /etc/caddy/Caddyfile
    cat >> /etc/caddy/Caddyfile <<CADDY
# lockin-begin
$DOMAIN {
  request_body { max_size 110MB }
  reverse_proxy 127.0.0.1:$PORT { flush_interval -1 }
}
# lockin-end
CADDY
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy || systemctl restart caddy
    ;;
  *)
    echo "!! Ports 80/443 are used by '$WEB', which this script doesn't configure automatically."
    echo "   Lock In is running on 127.0.0.1:$PORT. Point $DOMAIN at it in that proxy"
    echo "   (allow 110MB uploads and disable buffering for /api/stream)."
    ;;
esac

if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp; ufw allow 443/tcp; fi

say "Nightly backups (3am, keeps 14 days)"
cat > /etc/cron.d/lockin-backup <<CRON
0 3 * * * root sqlite3 $DATA_DIR/lockin.db ".backup /var/backups/lockin/lockin-\$(date +\%F).db" && tar -czf /var/backups/lockin/uploads-\$(date +\%F).tgz -C $DATA_DIR uploads && find /var/backups/lockin -mtime +14 -delete
CRON

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/bootstrap" >/dev/null; then
  say "Done! Open https://$DOMAIN on your phone and create your group."
else
  echo "!! App didn't respond. Check: journalctl -u lockin -n 50"
fi
