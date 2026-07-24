#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_FILE="$HOME/.config/systemd/user/hymn-console.service"
AUTOSTART_DIR="$HOME/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DIR/hymn-console-kiosk.desktop"

mkdir -p "$(dirname "$SERVICE_FILE")" "$AUTOSTART_DIR"

cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=Hymn Console
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
SERVICE

cat > "$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Hymn Console Kiosk
Exec=chromium-browser --kiosk http://localhost:8080
X-GNOME-Autostart-enabled=true
DESKTOP

systemctl --user daemon-reload
systemctl --user enable --now hymn-console.service

echo "Hymn Console service installed."
echo "Chromium kiosk launcher installed. Reboot the Pi to test kiosk startup."
