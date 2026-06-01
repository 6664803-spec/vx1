#!/usr/bin/env sh
set -eu

DOMAIN="${DOMAIN:-xv1.7700.eu.org}"
REPO_DIR="${REPO_DIR:-/root/.openclaw/workspace}"
WEBROOT="${WEBROOT:-/var/www/html}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/sites-available/xv1-lottery}"
NGINX_LINK="${NGINX_LINK:-/etc/nginx/sites-enabled/xv1-lottery}"
NGINX_SRC="${NGINX_SRC:-$REPO_DIR/deploy/nginx-xv1.conf}"
CERT_EMAIL="${CERT_EMAIL:-xingchen@openclaw.local}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root with sudo." >&2
  exit 1
fi

command -v nginx >/dev/null 2>&1 || { echo "nginx not found" >&2; exit 1; }
command -v certbot >/dev/null 2>&1 || { echo "certbot not found" >&2; exit 1; }
[ -d "$REPO_DIR" ] || { echo "repo not found: $REPO_DIR" >&2; exit 1; }
[ -f "$NGINX_SRC" ] || { echo "nginx template not found: $NGINX_SRC" >&2; exit 1; }

install -d -m 0755 "$WEBROOT/.well-known/acme-challenge"
install -m 0644 "$NGINX_SRC" "$NGINX_CONF"
ln -sf "$NGINX_CONF" "$NGINX_LINK"

nginx -t
systemctl reload nginx

certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --non-interactive --agree-tos -m "$CERT_EMAIL" --keep-until-expiring

nginx -t
systemctl reload nginx

echo "HTTPS enabled for https://$DOMAIN"
