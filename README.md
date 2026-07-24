# Hymn Console

A Raspberry Pi friendly web app for running church hymns without a pianist. It stores MP3s locally, keeps application data in SQLite, and gives a polished hymn-player screen for mobile phones, tablets, and laptops.

## Run

```powershell
node server.js
```

Open `http://localhost:8080` on the Pi, or from another device on the same network use:

```text
http://<raspberry-pi-ip-address>:8080
```

## Storage

- MP3 files: `media/`
- SQLite database: `data/hymn-console.sqlite`
- Complete backup snapshots: `data/backups/`

On a Raspberry Pi you can point storage to a USB drive:

```bash
HYMN_MEDIA_DIR=/media/pi/HYMNS/mp3 HYMN_DATA_DIR=/media/pi/HYMNS/data node server.js
```

## Features

- Single and bulk upload for MP3 hymns.
- Edit title, page number, key, tempo, notes, default verse count, chorus setting, and fades.
- Searchable hymn library with theme search and alphabet navigation.
- Service queue for ordering multiple hymns.
- Play, pause, stop, previous, next, repeat, seek, volume, and speed controls.
- Fade in and fade out controls.
- Structure builder for intro, verse, and chorus timings with editable segment times.
- Service plans, service lock, operator mode, a protected built-in administrator, granular user permissions, persistent sessions, trash recovery, complete backups, CSV import/export, and storage selection.
- AirPlay receiver support on Raspberry Pi so iPhone audio can be sent to the Pi sound output.
- Works without npm packages, which keeps setup simple and stable on a Raspberry Pi.

## Raspberry Pi Kiosk Startup

On the Raspberry Pi, run:

```bash
bash scripts/pi-kiosk-install.sh
```

That installs a user service for the app and an autostart launcher that opens Chromium at `http://localhost:8080` in kiosk mode after login.

## Sound System Playback

The Service page can play audio through either the current browser device or the Raspberry Pi sound system output. Sound System mode uses `mpv` and `ffmpeg` on the Pi for smoother playback and fade control:

```bash
sudo apt install -y mpv ffmpeg alsa-utils
```

If you use a different player path, start the app with `HYMN_AUDIO_PLAYER=/path/to/player`.

## AirPlay Receiver

The Raspberry Pi installer installs and enables `shairport-sync`. After installation, iPhone and other Apple devices should see an AirPlay speaker named `Hymn Console`.

On iPhone, open Control Center, tap the audio output icon, and select `Hymn Console`. AirPlay audio plays through the Raspberry Pi sound output.

To use a different AirPlay speaker name during install:

```bash
sudo AIRPLAY_NAME="Church Sound System" RUN_USER=admin bash deployment/install-rpi.sh
```

## Deployment

For Raspberry Pi deployment, use the packaged zip from `dist/hymn-console-rpi.zip`, extract it on the Pi, and run:

```bash
sudo RUN_USER=admin bash deployment/install-rpi.sh
```

The installer copies the app to `/opt/hymn-console`, installs system packages, creates the systemd service, enables startup on boot, and grants the limited permissions needed for app restart, Raspberry Pi restart, hostname updates, and Sound System volume control.

## Accounts And Sessions

The first browser to open a new installation creates the protected built-in administrator. That administrator can create user accounts and independently grant playback, remote control, playback-setting, browser-audio, sound-system-audio, queue, plan, lyrics, library, backup, appearance, network, restart, log, remote-support, and user-administration permissions. Features without permission are hidden and rejected by the server. Sessions use HttpOnly same-site cookies, survive browser refreshes, and expire after twelve hours. Save the generated administrator recovery code somewhere separate from the Raspberry Pi.

## Complete Backups

Complete backups contain the SQLite database, MP3 files, custom branding, and remote-access configuration. Configure an off-device USB or network path under Settings > Library Management. Nightly backups run at midnight and use the configured retention period.

## Maintenance Commands

```bash
sudo hymn-console-self-test
sudo hymn-console-update /path/to/hymn-console-rpi.zip
sudo hymn-console-rollback
```

Use a dedicated church-device network where possible. To restrict port 8080 during installation:

```bash
sudo TRUSTED_SUBNET="192.168.50.0/24" RUN_USER=admin bash deployment/install-rpi.sh
```

The installer detects the Pi's active LAN subnet and restricts port 8080 to it by default. Use `ALLOW_UNRESTRICTED_WEB=1` only when you intentionally need access from every routed network.

## Production Validation

Automated tests cover authentication, authorization, SQLite concurrency and crash recovery, queue synchronization, playback commands, fades, plans, streamed uploads, trash, and complete backup restoration. Before using new hardware in worship, complete the real-device checklist in `docs/PRODUCTION-VALIDATION.md`.
