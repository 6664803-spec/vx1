# Deployment

## xv1.7700.eu.org HTTPS

Use `enable-https-xv1.sh` to install the Nginx vhost and request/renew the Let's Encrypt certificate.

Defaults:
- Domain: `xv1.7700.eu.org`
- App port: `3001`
- Nginx site: `/etc/nginx/sites-available/xv1-lottery`
- Nginx link: `/etc/nginx/sites-enabled/xv1-lottery`
- systemd unit: `xv1-lottery.service`

Environment overrides:
- `DOMAIN`
- `REPO_DIR`
- `WEBROOT`
- `NGINX_CONF`
- `NGINX_LINK`
- `NGINX_SRC`
- `CERT_EMAIL`
