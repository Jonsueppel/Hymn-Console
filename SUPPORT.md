# Support

Hymn Console is intended for Raspberry Pi deployment on a private church network.

## Start Here

1. Read `docs/INSTALL.md`.
2. Run:

```bash
curl http://localhost:8080/api/health
sudo hymn-console-self-test
```

3. Download a diagnostic report from Settings > Network & System.
4. Check `docs/PRODUCTION-VALIDATION.md`.

## Common Issues

- **App will not load:** confirm `hymn-console.service` is running and port `8080` is open.
- **Sound System does not play:** confirm `mpv`, `ffmpeg`, PipeWire, and the selected Pi audio output work.
- **AirPlay connects but has no sound:** reboot the Pi after firewall or audio changes, then verify Shairport Sync is active.
- **USB storage missing:** confirm the USB path is mounted and writable before uploading hymns.
- **Login problems:** use the administrator recovery flow from the app and keep recovery codes off the Pi.

## Security

Do not post secrets, API keys, recovery codes, databases, backups, private IP details, or copyrighted MP3/lyrics content in public issues.

For security concerns, follow `SECURITY.md`.
