#!/usr/bin/env sh
set -eu

DOMAIN="xinyun.7700.eu.org"
REPO_DIR="/root/.openclaw/workspace"
WEBROOT="/var/www/html"
NGINX_CONF="/etc/nginx/sites-available/xinyunfei"
NGINX_LINK="/etc/nginx/sites-enabled/xinyunfei"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root with sudo." >&2
  exit 1
fi

command -v nginx >/dev/null 2>&1 || { echo "nginx not found" >&2; exit 1; }
command -v certbot >/dev/null 2>&1 || { echo "certbot not found" >&2; exit 1; }
[ -d "$REPO_DIR" ] || { echo "repo not found: $REPO_DIR" >&2; exit 1; }

install -d -m 0755 "$WEBROOT/.well-known/acme-challenge"
install -m 0644 "$REPO_DIR/deploy/nginx-xinyunfei.conf" "$NGINX_CONF"
ln -sf "$NGINX_CONF" "$NGINX_LINK"

nginx -t
systemctl reload nginx

certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --non-interactive --agree-tos -m xingchen@openclaw.local --keep-until-expiring

nginx -t
systemctl reload nginx

echo "HTTPS enabled for https://$DOMAIN"
