# Hymn Console Raspberry Pi Deployment

## Quick Install

1. Copy or extract `hymn-console-rpi.zip` on the Raspberry Pi.
2. From inside the extracted folder, run:

```bash
sudo bash deployment/install-rpi.sh
```

The installer normally detects the user that ran `sudo`. To force a specific service user:

```bash
sudo RUN_USER=admin bash deployment/install-rpi.sh
```

Useful optional installer settings:

```bash
sudo RUN_USER=admin HOSTNAME_NAME=hymnconsole APP_DISPLAY_NAME="Hymn Console" bash deployment/install-rpi.sh
sudo RUN_USER=admin USB_UUID=YOUR-USB-UUID USB_MOUNT=/mnt/hymns bash deployment/install-rpi.sh
```

3. Open the app from another device on the same network:

```text
http://raspberry-pi-ip-address:8080
```

Friendly network address after installation:

```text
http://hymnconsole.local:8080
```

The shorter `http://hymnconsole:8080` address requires local DNS support from the router.

## Recommended Raspberry Pi Setup

- Raspberry Pi 4 or newer.
- 32 GB or larger SD card.
- Raspberry Pi OS Lite or Desktop.
- Wired Ethernet when possible.
- USB audio interface or reliable HDMI/audio output into the sound system.
- A reserved DHCP address in the church router.
- `ffmpeg` and `mpv` for Sound System playback and smooth live fade control.
- `shairport-sync` for AirPlay receiving from iPhone, iPad, and macOS devices.

## How It All Connects

```text
Phone / Tablet / Laptop
  Browser control at http://hymnconsole.local:8080
              |
              v
Church Wi-Fi / Ethernet network
              |
              v
Raspberry Pi running Hymn Console
  - Node.js web app on port 8080
  - SQLite data, service plans, users, settings
  - MP3 storage on SD card or USB drive
  - Shairport Sync AirPlay receiver
              |
              v
Audio output from Raspberry Pi
  USB audio / HDMI / headphone output
              |
              v
Church mixer, amplifier, or powered speakers
```

Playback paths:

- `This Device`: audio plays from the phone, tablet, or laptop browser.
- `Sound System`: Hymn Console tells the Raspberry Pi to play the selected hymn through the connected sound system.
- `AirPlay`: an iPhone, iPad, or Mac streams audio wirelessly to `Hymn Console AirPlay`, then the Pi sends it to the same sound output.

## Service Commands

```bash
sudo systemctl status hymn-console
sudo systemctl restart hymn-console
sudo systemctl stop hymn-console
sudo journalctl -u hymn-console -f
sudo systemctl status hymn-console-healthcheck.timer
sudo systemctl status hymn-console-backup.timer
```

The installer enables:

- `hymn-console.service` for startup on boot.
- `hymn-console-healthcheck.timer` to restart the app if `/api/health` fails.
- `hymn-console-backup.timer` to save a local backup every night at midnight.
- Log rotation for `/opt/hymn-console/logs/*.log`.
- A small journald size cap so logs do not fill the SD card.
- Firewall rules for SSH, the app port, mDNS, and AirPlay when `ufw` is available.

## AirPlay Receiver

The installer enables an AirPlay receiver named from the app name plus `AirPlay` using `shairport-sync`.
For the default app name, the speaker appears as `Hymn Console AirPlay`.
If `data/settings.json` already has a custom app name, installer updates use that name automatically.

On iPhone:

1. Open Control Center.
2. Tap the audio output/AirPlay icon.
3. Select `Hymn Console AirPlay` or your custom app name followed by `AirPlay`.
4. Play audio from the iPhone.

To install with a different AirPlay speaker name, override it explicitly:

```bash
sudo AIRPLAY_NAME="Church Sound System" RUN_USER=admin bash deployment/install-rpi.sh
```

To set the app name used for the automatic AirPlay label during install:

```bash
sudo APP_DISPLAY_NAME="Tri-City Hymn Console" RUN_USER=admin bash deployment/install-rpi.sh
```

AirPlay uses the Raspberry Pi sound output. If AirPlay starts while Hymn Console Sound System playback is active, the installer config attempts to stop Hymn Console playback first so the two audio sources do not compete.

The installer defaults Shairport Sync to ALSA device `hw:0`, which matched the tested Raspberry Pi sound output. If your sound system uses a different ALSA device, rerun the installer with:

```bash
sudo AIRPLAY_OUTPUT_DEVICE="hw:1" RUN_USER=pi bash deployment/install-rpi.sh
```

When `ufw` is installed, the installer opens the app port, mDNS, and common AirPlay ports so iPhone and iPad devices can discover and stream audio to the Pi.

## Storage

By default:

- App: `/opt/hymn-console`
- Data: `/opt/hymn-console/data`
- MP3 files: `/opt/hymn-console/media`

In the app, open Settings, expand Network & System, and choose:

- `Internal Storage` for the app media folder.
- `USB Storage` for a mounted USB drive.

To use USB Storage, mount the drive first, then enter the mounted path in the app. Common Raspberry Pi paths look like `/media/pi/HYMNS` or `/mnt/hymns`.

Switching storage changes where Hymn Console looks for MP3 files. It does not automatically move existing hymns, so copy MP3s to the selected storage location before using it for a service.

If you know the USB drive UUID, the installer can add an optional `nofail` fstab mount:

```bash
sudo RUN_USER=admin USB_UUID=YOUR-USB-UUID USB_MOUNT=/mnt/hymns bash deployment/install-rpi.sh
```

Find a USB UUID with:

```bash
lsblk -f
```

## Admin And Service Modes

- First-time setup creates one protected built-in administrator account.
- Sessions survive browser refreshes and expire after twelve hours.
- Save the generated administrator recovery code away from the Raspberry Pi.
- The administrator creates user accounts and grants only the service, audio-output, queue, plan, lyrics, or library permissions each person needs.
- `Operator Mode` simplifies the live worship screen.
- `Lock Service` prevents accidental service queue changes for signed-in operators.

## Uploads

The upload area supports single MP3 uploads and bulk MP3 uploads. Select multiple MP3 files at once to import a larger hymn library.

## Final Deployment Check

After startup, check:

```text
http://raspberry-pi-ip-address:8080/api/health
```

The response should include `"ok": true`.

Then open the app, go to Settings, expand Network & System, and run the combined refresh/system check. Confirm:

- Library, queue, and plans files are OK.
- Storage location and free space look correct.
- Sound System player reports `mpv and ffmpeg available`.
- AirPlay speaker `Hymn Console AirPlay` or the custom app name followed by `AirPlay` appears on an iPhone on the same network.

Run the installed self-test:

```bash
sudo hymn-console-self-test
```

## Secure Network Installation

Hymn Console sessions are protected with HttpOnly same-site cookies. For local HTTP deployments, place the Pi on a private church-device network. The installer can restrict web access to one subnet:

```bash
sudo TRUSTED_SUBNET="192.168.50.0/24" RUN_USER=admin bash deployment/install-rpi.sh
```

If no subnet is supplied, the installer detects the Pi's active LAN subnet and uses it automatically. `ALLOW_UNRESTRICTED_WEB=1` disables this safeguard and should only be used on an otherwise isolated network.

## Updates And Rollback

Install a packaged update with:

```bash
sudo hymn-console-update /path/to/hymn-console-rpi.zip
```

The installer saves the previous application code under `/opt/hymn-console-releases`. To roll back while preserving the current database and MP3 files:

```bash
sudo hymn-console-rollback
```

## Complete Backups

Nightly backups include SQLite data, MP3 files, and custom branding. Set an off-device target in Settings > Library Management. The target should be a mounted USB drive or trusted network share. Restoring a complete backup signs out all existing sessions.
- The access URL is the one volunteers will use.
- Confirm the selected hymn plays through the intended output.

## Updating Later

To update an existing Raspberry Pi installation, copy/extract the newer package, run the installer again with the same service user, and then refresh the browser:

```bash
sudo RUN_USER=admin bash deployment/install-rpi.sh
```

The installer preserves `/opt/hymn-console/data` and `/opt/hymn-console/media` during updates. The deployment zip does not include live MP3 files, saved plans, or the active hymn library, so normal updates will not overwrite church data.
