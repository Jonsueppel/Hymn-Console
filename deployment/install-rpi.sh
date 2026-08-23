#!/usr/bin/env bash
set -euo pipefail

APP_NAME="hymn-console"
APP_DIR="${APP_DIR:-/opt/hymn-console}"
RELEASE_ROOT="${RELEASE_ROOT:-/opt/hymn-console-releases}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
RUN_USER="${RUN_USER:-${SUDO_USER:-$(logname 2>/dev/null || echo pi)}}"
APP_DISPLAY_NAME="${APP_DISPLAY_NAME:-}"
AIRPLAY_NAME="${AIRPLAY_NAME:-}"
AIRPLAY_OUTPUT_DEVICE="${AIRPLAY_OUTPUT_DEVICE:-hw:0}"
HOSTNAME_NAME="${HOSTNAME_NAME:-hymnconsole}"
PORT="${PORT:-8080}"
USB_MOUNT="${USB_MOUNT:-/mnt/hymns}"
USB_UUID="${USB_UUID:-}"
TRUSTED_SUBNET="${TRUSTED_SUBNET:-}"
ALLOW_UNRESTRICTED_WEB="${ALLOW_UNRESTRICTED_WEB:-0}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo."
  exit 1
fi

have_command() {
  command -v "$1" >/dev/null 2>&1
}

node_major() {
  if have_command node; then
    node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1
  else
    echo 0
  fi
}

install_nodejs() {
  local major
  major="$(node_major)"
  if [[ "${major}" -ge 24 ]]; then
    return
  fi
  echo "Installing Node.js 24 LTS..."
  apt-get install -y ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
}

echo "Installing Hymn Console to ${APP_DIR}"
apt-get update
install_nodejs
apt-get install -y \
  ffmpeg mpv rsync alsa-utils shairport-sync curl ca-certificates gnupg openssl unzip avahi-utils
for optional_package in pulseaudio-utils pipewire pipewire-audio-client-libraries wireplumber avahi-daemon libnss-mdns ufw jq; do
  apt-get install -y "${optional_package}" || echo "Optional package ${optional_package} could not be installed; continuing."
done

mkdir -p "${APP_DIR}" "${APP_DIR}/data" "${APP_DIR}/media" "${APP_DIR}/media/.trash" "${APP_DIR}/data/backups" "${APP_DIR}/logs" "${USB_MOUNT}" "${RELEASE_ROOT}"
systemctl stop "${APP_NAME}.service" >/dev/null 2>&1 || true
if [[ -f "${APP_DIR}/server.js" ]]; then
  rollback_dir="${RELEASE_ROOT}/rollback-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "${rollback_dir}"
  rsync -a \
    --exclude "data" \
    --exclude "media" \
    --exclude "logs" \
    --exclude "node_modules" \
    "${APP_DIR}/" "${rollback_dir}/"
fi
rsync -a --delete \
  --exclude "data" \
  --exclude "media" \
  --exclude "logs" \
  --exclude "node_modules" \
  --exclude ".git" \
  ./ "${APP_DIR}/"

cd "${APP_DIR}"
npm install --omit=dev --ignore-scripts
npm run check

if [[ -z "${APP_DISPLAY_NAME}" && -f "${APP_DIR}/data/settings.json" ]] && have_command node; then
  APP_DISPLAY_NAME="$(node -e "try{const fs=require('fs');const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(s.appName||''));}catch{}" "${APP_DIR}/data/settings.json")"
fi
APP_DISPLAY_NAME="${APP_DISPLAY_NAME:-Hymn Console}"
if [[ -z "${AIRPLAY_NAME}" ]]; then
  AIRPLAY_NAME="${APP_DISPLAY_NAME} AirPlay"
fi
AIRPLAY_NAME="$(printf '%s' "${AIRPLAY_NAME}" | sed 's/[\\"]/ /g; s/[[:space:]]\+/ /g; s/^ //; s/ $//')"

if id "${RUN_USER}" >/dev/null 2>&1; then
  usermod -a -G audio,video,plugdev "${RUN_USER}" || true
  chown -R "${RUN_USER}:${RUN_USER}" "${APP_DIR}"
fi
find "${APP_DIR}/data" -type f -exec chmod 600 {} + 2>/dev/null || true
chmod 700 "${APP_DIR}/data" "${APP_DIR}/data/backups" || true

if [[ -n "${HOSTNAME_NAME}" ]] && have_command hostnamectl; then
  hostnamectl set-hostname "${HOSTNAME_NAME}" || true
fi

if [[ -n "${USB_UUID}" ]]; then
  if ! grep -q "UUID=${USB_UUID}" /etc/fstab; then
    echo "UUID=${USB_UUID} ${USB_MOUNT} auto defaults,nofail,x-systemd.automount,uid=$(id -u "${RUN_USER}" 2>/dev/null || echo 1000),gid=$(id -g "${RUN_USER}" 2>/dev/null || echo 1000),umask=0022 0 0" >> /etc/fstab
  fi
  systemctl daemon-reload
  mount "${USB_MOUNT}" || true
fi

cat > "/etc/sudoers.d/${APP_NAME}" <<SUDOERS
${RUN_USER} ALL=NOPASSWD: /bin/systemctl restart ${APP_NAME}, /usr/bin/systemctl restart ${APP_NAME}, /sbin/reboot, /usr/sbin/reboot, /usr/bin/hostnamectl set-hostname *, /bin/hostnamectl set-hostname *
SUDOERS
chmod 440 "/etc/sudoers.d/${APP_NAME}"

ENV_FILE="/etc/${APP_NAME}.env"
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi
HYMN_BACKUP_TOKEN="${HYMN_BACKUP_TOKEN:-$(openssl rand -hex 32)}"
cat > "${ENV_FILE}" <<ENVVARS
HYMN_BACKUP_TOKEN=${HYMN_BACKUP_TOKEN}
NODE_ENV=production
ENVVARS
chown root:root "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

if [[ -f /etc/shairport-sync.conf ]]; then
  cp /etc/shairport-sync.conf "/etc/shairport-sync.conf.${APP_NAME}.bak" || true
fi

cat > /etc/shairport-sync.conf <<SHAIRPORT
general =
{
  name = "${AIRPLAY_NAME}";
  interpolation = "soxr";
};

alsa =
{
  output_device = "${AIRPLAY_OUTPUT_DEVICE}";
  mixer_control_name = "Master";
};

sessioncontrol =
{
  run_this_before_play_begins = "/usr/bin/systemctl --quiet is-active ${APP_NAME}.service >/dev/null 2>&1 && /usr/bin/curl -fsS -X POST http://127.0.0.1:${PORT}/api/server-player -H 'content-type: application/json' -H 'x-local-player-token: ${HYMN_BACKUP_TOKEN}' -d '{\"action\":\"stop\"}' >/dev/null 2>&1 || true";
};
SHAIRPORT

cat > "${SERVICE_FILE}" <<SERVICE
[Unit]
Description=Hymn Console
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=5
User=${RUN_USER}
Environment=PORT=${PORT}
Environment=HYMN_DATA_DIR=${APP_DIR}/data
Environment=HYMN_MEDIA_DIR=${APP_DIR}/media
EnvironmentFile=${ENV_FILE}
UMask=0077
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictRealtime=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
TimeoutStopSec=15
StandardOutput=append:${APP_DIR}/logs/hymn-console.log
StandardError=append:${APP_DIR}/logs/hymn-console-error.log

[Install]
WantedBy=multi-user.target
SERVICE

cat > /usr/local/bin/${APP_NAME}-healthcheck <<HEALTH
#!/usr/bin/env bash
set -euo pipefail
if ! curl -fsS http://127.0.0.1:${PORT}/api/health >/dev/null; then
  systemctl restart ${APP_NAME}.service
fi
HEALTH
chmod 755 /usr/local/bin/${APP_NAME}-healthcheck

cat > /etc/systemd/system/${APP_NAME}-healthcheck.service <<HEALTHSERVICE
[Unit]
Description=Hymn Console health check

[Service]
Type=oneshot
ExecStart=/usr/local/bin/${APP_NAME}-healthcheck
HEALTHSERVICE

cat > /etc/systemd/system/${APP_NAME}-healthcheck.timer <<HEALTHTIMER
[Unit]
Description=Run Hymn Console health check every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Unit=${APP_NAME}-healthcheck.service

[Install]
WantedBy=timers.target
HEALTHTIMER

cat > /usr/local/bin/${APP_NAME}-backup <<BACKUP
#!/usr/bin/env bash
set -euo pipefail
source ${ENV_FILE}
curl -fsS -X POST http://127.0.0.1:${PORT}/api/backups/local -H "x-backup-token: ${HYMN_BACKUP_TOKEN}" >/dev/null
BACKUP
chmod 755 /usr/local/bin/${APP_NAME}-backup

cat > /usr/local/bin/${APP_NAME}-self-test <<SELFTEST
#!/usr/bin/env bash
set -euo pipefail
failures=0
check() {
  local name="\$1"
  shift
  if "\$@" >/dev/null 2>&1; then
    printf 'OK    %s\n' "\${name}"
  else
    printf 'FAIL  %s\n' "\${name}"
    failures=\$((failures + 1))
  fi
}
check "Node.js 24+" bash -c '[[ \$(node -p "Number(process.versions.node.split(\".\")[0])") -ge 24 ]]'
check "Server syntax" node --check ${APP_DIR}/server.js
check "App service" systemctl is-active --quiet ${APP_NAME}.service
check "Health endpoint" curl -fsS http://127.0.0.1:${PORT}/api/health
check "Data directory writable" sudo -u ${RUN_USER} test -w ${APP_DIR}/data
check "Media directory writable" sudo -u ${RUN_USER} test -w ${APP_DIR}/media
check "SQLite database present" test -s ${APP_DIR}/data/hymn-console.sqlite
check "MPV available" command -v mpv
check "FFmpeg available" command -v ffmpeg
check "AirPlay service" systemctl is-active --quiet shairport-sync
exit "\${failures}"
SELFTEST
chmod 755 /usr/local/bin/${APP_NAME}-self-test

cat > /usr/local/bin/${APP_NAME}-update <<UPDATE
#!/usr/bin/env bash
set -euo pipefail
if [[ \$# -ne 1 || ! -f "\$1" ]]; then
  echo "Usage: sudo ${APP_NAME}-update /path/to/hymn-console-rpi.zip"
  exit 2
fi
tmp="\$(mktemp -d)"
trap 'rm -rf "\${tmp}"' EXIT
unzip -q "\$1" -d "\${tmp}"
installer="\$(find "\${tmp}" -path '*/deployment/install-rpi.sh' -print -quit)"
if [[ -z "\${installer}" ]]; then
  echo "Package does not contain deployment/install-rpi.sh"
  exit 1
fi
cd "\$(dirname "\$(dirname "\${installer}")")"
RUN_USER=${RUN_USER} APP_DIR=${APP_DIR} bash deployment/install-rpi.sh
UPDATE
chmod 755 /usr/local/bin/${APP_NAME}-update

cat > /usr/local/bin/${APP_NAME}-rollback <<ROLLBACK
#!/usr/bin/env bash
set -euo pipefail
latest="\$(find ${RELEASE_ROOT} -maxdepth 1 -type d -name 'rollback-*' | sort | tail -n1)"
if [[ -z "\${latest}" ]]; then
  echo "No rollback release is available."
  exit 1
fi
systemctl stop ${APP_NAME}.service
rsync -a --delete --exclude data --exclude media --exclude logs "\${latest}/" ${APP_DIR}/
cd ${APP_DIR}
npm install --omit=dev --ignore-scripts
npm run check
chown -R ${RUN_USER}:${RUN_USER} ${APP_DIR}
systemctl start ${APP_NAME}.service
echo "Rolled back to \${latest}"
ROLLBACK
chmod 755 /usr/local/bin/${APP_NAME}-rollback

cat > /etc/systemd/system/${APP_NAME}-backup.service <<BACKUPSERVICE
[Unit]
Description=Hymn Console nightly local backup
After=${APP_NAME}.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/${APP_NAME}-backup
BACKUPSERVICE

cat > /etc/systemd/system/${APP_NAME}-backup.timer <<BACKUPTIMER
[Unit]
Description=Run Hymn Console backup nightly at midnight

[Timer]
OnCalendar=*-*-* 00:00:00
Persistent=true
Unit=${APP_NAME}-backup.service

[Install]
WantedBy=timers.target
BACKUPTIMER

cat > /etc/logrotate.d/${APP_NAME} <<LOGROTATE
${APP_DIR}/logs/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
LOGROTATE

mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/${APP_NAME}.conf <<JOURNALD
[Journal]
SystemMaxUse=100M
RuntimeMaxUse=50M
JOURNALD

if have_command ufw; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  if [[ -z "${TRUSTED_SUBNET}" && "${ALLOW_UNRESTRICTED_WEB}" != "1" ]] && have_command ip; then
    TRUSTED_SUBNET="$(ip -o -f inet addr show scope global | awk 'NR==1 {print $4}')"
  fi
  if [[ -n "${TRUSTED_SUBNET}" ]]; then
    ufw allow from "${TRUSTED_SUBNET}" to any port ${PORT} proto tcp >/dev/null 2>&1 || true
  elif [[ "${ALLOW_UNRESTRICTED_WEB}" == "1" ]]; then
    ufw allow ${PORT}/tcp >/dev/null 2>&1 || true
  else
    echo "Could not detect the local subnet. Port ${PORT} was not opened in UFW. Set TRUSTED_SUBNET or ALLOW_UNRESTRICTED_WEB=1 and rerun the installer."
  fi
  ufw allow 5353/udp >/dev/null 2>&1 || true
  ufw allow 1900/udp >/dev/null 2>&1 || true
  ufw allow 3689/tcp >/dev/null 2>&1 || true
  ufw allow 5000/tcp >/dev/null 2>&1 || true
  ufw allow 5001/tcp >/dev/null 2>&1 || true
  ufw allow 7000:7001/tcp >/dev/null 2>&1 || true
  ufw allow 7100/tcp >/dev/null 2>&1 || true
  ufw allow 319/udp >/dev/null 2>&1 || true
  ufw allow 320/udp >/dev/null 2>&1 || true
  ufw allow 60000:61000/udp >/dev/null 2>&1 || true
  ufw allow 60000:61000/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

if have_command amixer; then
  amixer sset Master 90% unmute >/dev/null 2>&1 || true
fi

systemctl daemon-reload
systemctl enable "${APP_NAME}"
systemctl enable "${APP_NAME}-healthcheck.timer"
systemctl enable "${APP_NAME}-backup.timer"
systemctl enable shairport-sync
systemctl enable avahi-daemon >/dev/null 2>&1 || true
systemctl restart "${APP_NAME}"
systemctl restart shairport-sync || true
systemctl restart avahi-daemon >/dev/null 2>&1 || true
systemctl restart systemd-journald >/dev/null 2>&1 || true
systemctl restart "${APP_NAME}-healthcheck.timer" || true
systemctl restart "${APP_NAME}-backup.timer" || true

if ! /usr/local/bin/${APP_NAME}-self-test; then
  echo "Hymn Console installed, but one or more self-tests failed. Review the results above."
  exit 1
fi

echo "Hymn Console installed."
echo "Open http://$(hostname -I | awk '{print $1}'):${PORT} or http://${HOSTNAME_NAME}.local:${PORT} from a device on this network."
echo "AirPlay receiver enabled as \"${AIRPLAY_NAME}\"."
