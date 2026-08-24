# Hymn Console Installation Guide

This guide explains how to install and update Hymn Console on a Raspberry Pi.

## Recommended Hardware

- Raspberry Pi 4 or newer.
- 32 GB or larger SD card.
- Reliable Raspberry Pi power supply.
- Wired Ethernet when possible.
- USB audio interface, HDMI audio, or headphone output connected to the church sound system.
- Optional USB drive for MP3 storage and backups.

## Prepare The Pi

Install Raspberry Pi OS Lite or Desktop, connect the Pi to the church network, and update it:

```bash
sudo apt update
sudo apt upgrade -y
```

If using SSH, enable it from Raspberry Pi Imager or `raspi-config`.

## Install From GitHub

```bash
cd /opt
sudo git clone https://github.com/Jonsueppel/Hymn-Console.git hymn-console
sudo chown -R pi:pi /opt/hymn-console
cd /opt/hymn-console
npm install --omit=dev
sudo RUN_USER=pi bash deployment/install-rpi.sh
```

If your Pi user is not `pi`, replace `pi` with the correct username.

## Open The App

Use the friendly local name:

```text
http://hymnconsole.local:8080/
```

Or use the Pi IP address:

```bash
hostname -I
```

Then open:

```text
http://<pi-ip-address>:8080/
```

## First-Time Setup

1. Create the built-in administrator account.
2. Save the administrator recovery code somewhere separate from the Pi.
3. Sign in as administrator.
4. Go to Settings.
5. Create operator accounts and grant only the needed permissions.
6. Upload hymns or configure USB storage.
7. Run the system check.

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
  - SQLite data, users, plans, settings
  - MP3 storage on SD card or USB drive
  - Shairport Sync AirPlay receiver
              |
              v
Raspberry Pi audio output
  USB audio / HDMI / headphone output
              |
              v
Church mixer, amplifier, or powered speakers
```

## Audio Setup

Use **This Device** when audio should play from the phone, tablet, or laptop.

Use **Sound System** when the Raspberry Pi is connected to the church audio system.

Sound System playback defaults to PipeWire on Raspberry Pi OS. If a special audio interface requires ALSA, rerun the installer with `HYMN_MPV_AO=alsa`.

AirPlay appears as the app name followed by `AirPlay`, such as:

```text
Hymn Console AirPlay
```

If AirPlay connects but no sound plays, reboot the Pi and confirm the Pi audio output works.

## USB Storage

Mount the USB drive first. Common paths:

```text
/media/pi/HYMNS
/mnt/hymns
```

Then go to Settings, Network & System, choose USB Storage, enter the path, and save.

Switching storage does not automatically move existing MP3 files.

## Updating

On the Pi:

```bash
cd /opt/hymn-console
git pull
sudo RUN_USER=pi bash deployment/install-rpi.sh
sudo systemctl restart hymn-console
```

Verify:

```bash
curl http://localhost:8080/api/health
```

## Troubleshooting

Check the app:

```bash
sudo systemctl status hymn-console --no-pager
sudo journalctl -u hymn-console -n 80 --no-pager
```

Check AirPlay:

```bash
sudo systemctl status shairport-sync --no-pager
sudo systemctl status avahi-daemon --no-pager
```

Check health:

```bash
curl http://localhost:8080/api/health
```

## Backups

Use Download Complete Backup before major changes. Configure an off-device backup path for a mounted USB drive or trusted network share.

Complete backups include data, plans, settings, themes, custom logo, and MP3 files.
