#!/usr/bin/env sh
set -eu

SERVICE=/etc/systemd/system/xingchen-lottery.service
REPO_DIR=/root/.openclaw/workspace
LOG_DIR=/var/log/xingchen-lottery
UNIT_FILE=$(mktemp)

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo or as root." >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "node not found" >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "systemctl not found" >&2; exit 1; }
[ -f "$REPO_DIR/src/server.js" ] || { echo "repo not found: $REPO_DIR" >&2; exit 1; }

install -d -m 0755 "$LOG_DIR"

cat > "$UNIT_FILE" <<'UNIT'
[Unit]
Description=Xingchen Lottery Monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/.openclaw/workspace
ExecStart=/usr/bin/node /root/.openclaw/workspace/src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
StandardOutput=append:/var/log/xingchen-lottery/service.log
StandardError=append:/var/log/xingchen-lottery/service.log

[Install]
WantedBy=multi-user.target
UNIT

install -m 0644 "$UNIT_FILE" "$SERVICE"
rm -f "$UNIT_FILE"

systemctl daemon-reload
systemctl enable --now xingchen-lottery.service
systemctl restart xingchen-lottery.service
systemctl --no-pager --full status xingchen-lottery.service | sed -n '1,20p'
