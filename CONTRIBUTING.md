# Contributing To Hymn Console

Thank you for helping improve Hymn Console.

This project is source-available for review, deployment, and collaboration. Contributions are welcome, but the software is not open-source licensed for commercial redistribution. See `LICENSE` before reusing or repackaging the code.

## Development Setup

```bash
npm install
npm run check
npm test
node server.js
```

Open:

```text
http://localhost:8080/
```

## Before Submitting Changes

Run:

```bash
npm run check
npm test
```

For Raspberry Pi or audio changes, also test on actual hardware when possible:

- This Device playback
- Sound System playback
- Fade in/out
- Speed control
- Pause, stop, next, previous, repeat
- USB storage
- Complete backup and restore

## Pull Request Guidelines

- Keep changes focused and easy to review.
- Do not commit runtime data, MP3 files, backups, SQLite databases, API keys, recovery codes, or `.env` files.
- Update documentation when behavior, installation, permissions, backup behavior, or user workflow changes.
- Add or update tests for backend, permissions, storage, backup, or playback logic changes.

## Code Style

- Plain JavaScript, Node.js, and browser APIs.
- Prefer simple readable code over heavy framework dependencies.
- Keep Raspberry Pi reliability in mind: low memory use, streamed uploads, explicit error messages, and graceful failure.
