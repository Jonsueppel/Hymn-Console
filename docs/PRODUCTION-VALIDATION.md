# Hymn Console Production Validation

Complete this checklist on the actual Raspberry Pi, USB drive, audio interface, sound system, and church network before relying on a release during worship. Keep the resulting diagnostic and soak reports with the release package.

## Automated Gate

```bash
cd /opt/hymn-console
npm run check
npm test
sudo hymn-console-self-test
```

All commands must finish without a failed check. In Settings > Network & System, download a diagnostic report and confirm that SQLite integrity is `ok`, storage is writable, and `mpv`, `ffmpeg`, AirPlay, and the app service are available.

## Four-Hour Audio Soak

1. Connect the Pi to the same USB audio interface and sound system used for worship.
2. Build a service plan containing short and long MP3s, Smart Build arrangements, fades, and multiple verse counts.
3. Sign in with a user account that has playback and Sound System permissions, then start playback through Sound System.
4. In a Pi terminal, run:

```bash
cd /opt/hymn-console
HYMN_CONSOLE_USERNAME=operator HYMN_CONSOLE_PASSWORD='your-password' SOAK_HOURS=4 npm run test:soak
```

5. Keep an iPhone, iPad, and laptop connected. Verify live title, timeline, pause, resume, stop, seek, next, repeat, volume, speed, and lyric display from each device.
6. Fail the run for audible gaps between structure segments, clipping, unrequested fades, loss of synchronization, rising memory use, errors, or a service restart.

## AirPlay

1. Confirm the receiver appears as the configured app name followed by `AirPlay`.
2. Play from an iPhone for at least 30 minutes.
3. Stop AirPlay and play a queued hymn through Sound System.
4. Confirm the two sources never play over one another and the configured sound output returns cleanly.

## Interruption Tests

Perform these with a disposable test plan and a verified complete backup:

- Disconnect Wi-Fi for two minutes during playback, reconnect, refresh all browsers, and verify current state recovers.
- Refresh iPhone, iPad, and laptop browsers during playback; the session and live timeline should remain usable.
- Reboot the Pi and confirm the service, database, library, plans, AirPlay, and network name return automatically.
- Remove the USB hymn drive while idle. The app must report storage unavailable and must not silently write MP3s to the SD card. Reconnect and verify recovery.
- Remove the USB drive during playback only in a controlled test. Confirm the error is visible and the database remains intact.
- Cut Pi power during a queue update, then boot and run the self-test. SQLite integrity must remain `ok` and the last committed queue must load.

## Backup Drill

1. Configure a USB or mounted network-share backup target.
2. Run Complete Backup and confirm copies exist both internally and off the SD card.
3. Download a complete `.tar.gz` backup to another computer.
4. Change a test hymn, plan, setting, theme, and queue; then restore the backup.
5. Confirm MP3s, metadata, settings, queue, plans, theme, and branding are restored.
6. Confirm all previous sessions are signed out after restoration.

## Release Sign-Off

Record the release version, Pi model, OS version, storage device, audio device, test date, tester, soak report filename, diagnostic filename, backup location, and any exceptions. Do not deploy a release with an unexplained failed check.
