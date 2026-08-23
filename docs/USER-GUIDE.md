# Hymn Console User Guide

This guide is for volunteers, operators, and administrators.

## Sign In

Open:

```text
http://hymnconsole.local:8080/
```

Sign in with the account provided by the administrator.

## Run A Service

1. Open Library.
2. Search for a hymn by title, page, key, theme, or notes.
3. Press Add to place hymns in the Service Queue.
4. Open Service.
5. Choose the audio output.
6. Select the first hymn.
7. Press Play.

The next hymn waits until it is selected.

## Audio Output

Use **This Device** for phone, tablet, or laptop speakers.

Use **Sound System** when the Raspberry Pi is connected to the church sound system.

Use **AirPlay** from an iPhone or iPad when you want to stream outside audio to the Pi sound output.

## Service Queue

The queue controls the worship order.

- Use arrows to reorder hymns.
- Set verse count for each hymn.
- Use Intro, Verses, and Chorus checkboxes to choose what plays.
- Use Save to save the queue as a service plan.
- Use Plans to load a saved service plan.
- Use Clear carefully; it removes the current queue.

## Playback

Controls include:

- Previous
- Play
- Pause
- Stop
- Next
- Repeat selected hymn
- Seek bar
- Volume
- Speed
- Fade in
- Fade out

Stop and pause use fade settings when supported by the selected output.

## Lyrics

If a hymn has lyrics, use the Lyrics button while the hymn is selected. The lyrics open in a floating window with scrolling and a close button.

## Operator Mode

Operator Mode simplifies the live worship screen. It focuses on the player and queue and hides extra navigation. Use the X button to exit.

## Library

The library supports:

- Search
- Hymn theme search
- Alphabet navigation
- Add to queue
- Edit hymn details, if permitted

Administrators can upload MP3 files, bulk upload multiple files, edit metadata, import/export CSV files, and restore deleted items from trash.

## Service Plans

Use Plans on the Service page to load a saved service order. Use Save to name and store the current queue.

## Settings

Settings are permission-based. If you do not see a tool, your account does not have that permission.

Common administrator settings:

- Accounts and Security
- Playback defaults
- Library management
- Network and system
- Appearance
- System log
- Backup tools

## Before Worship Checklist

1. Confirm the Raspberry Pi is powered on.
2. Open Hymn Console from a phone, tablet, or laptop.
3. Refresh System Check.
4. Confirm storage and library status.
5. Confirm Sound System or This Device output.
6. Test AirPlay if it will be used.
7. Load the saved plan.
8. Select the first hymn.
9. Confirm volume.
10. Lock the service queue if desired.

## If Something Goes Wrong

- Refresh the browser.
- Confirm you are still signed in.
- Check that the selected hymn exists in the queue.
- Try This Device playback if Sound System is unavailable.
- Ask an administrator to open Settings and run System Check.
- If the Pi audio stack was changed, reboot the Pi.
