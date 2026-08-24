# Hymn Console Documentation

This folder contains the practical guides for installing, operating, validating, and maintaining Hymn Console.

## Guides

- [Installation Guide](INSTALL.md) - install, update, network, storage, audio, AirPlay, and backup setup.
- [User Guide](USER-GUIDE.md) - day-to-day operator and administrator instructions.
- [Production Validation](PRODUCTION-VALIDATION.md) - checklist before using the app in a live service.
- [Release Checklist](RELEASE-CHECKLIST.md) - checklist before tagging or deploying a release.
- [Screenshots](screenshots/README.md) - public-safe screenshot capture guidance.

## Recommended Reading Order

1. Start with the [Installation Guide](INSTALL.md).
2. Complete the first-run administrator setup in the app.
3. Read the [User Guide](USER-GUIDE.md) with the main service operators.
4. Run the [Production Validation](PRODUCTION-VALIDATION.md) checklist on the real Raspberry Pi and sound system.

## Operational Notes

- Keep MP3 files, backups, SQLite databases, API keys, and recovery codes out of Git.
- Use **Download Backup to This Device** before major changes.
- Use **Save Backup to Pi/USB** for local/off-device backup routines.
- Confirm Sound System playback, AirPlay, USB storage, and backups after every Raspberry Pi update.
