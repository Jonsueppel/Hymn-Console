# Release Checklist

Use this checklist before tagging or deploying a Hymn Console release.

## Code

- [ ] `npm run check` passes.
- [ ] `npm test` passes.
- [ ] No runtime data, MP3 files, backups, SQLite databases, API keys, recovery codes, or `.env` files are staged.
- [ ] `CHANGELOG.md` includes the user-facing changes.
- [ ] Version number is updated when appropriate.

## Raspberry Pi

- [ ] Fresh `git pull --ff-only` works on the Pi.
- [ ] `sudo RUN_USER=pi bash deployment/install-rpi.sh` completes.
- [ ] `sudo systemctl restart hymn-console` succeeds.
- [ ] `curl http://localhost:8080/api/health` returns `ok: true`.
- [ ] `sudo hymn-console-self-test` passes.

## Live Hardware Validation

- [ ] This Device playback works.
- [ ] Sound System playback works.
- [ ] Speed, volume, fade in, and fade out work on the selected output.
- [ ] Upload, delete, trash restore, and empty trash work.
- [ ] Service plans save, load, and delete.
- [ ] Complete backup download works.
- [ ] Complete backup save to Pi/USB works.
- [ ] Complete restore works from a downloaded backup.
- [ ] AirPlay appears and plays audio when enabled.
- [ ] iPhone, iPad, Android, Windows, and macOS browsers can open the app.

## Public Repository

- [ ] README reflects the current workflow.
- [ ] Installation and User Guide are current.
- [ ] Screenshots do not reveal private IP addresses, secrets, licensed lyrics, or copyrighted MP3 details.
- [ ] GitHub Actions CI is passing.
