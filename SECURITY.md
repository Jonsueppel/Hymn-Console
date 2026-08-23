# Security Policy

## Supported Use

Hymn Console is intended to run on a Raspberry Pi or trusted local server inside a private church network. It should not be exposed directly to the public internet.

## Do Not Commit Secrets

Never commit:

- OpenAI API keys
- Administrator recovery codes
- `.env` files
- SQLite databases
- MP3 files
- Backup archives
- Private keys or certificates

The `.gitignore` file is configured to keep common runtime data out of Git, but always review `git status` and `git ls-files` before pushing to a public repository.

## Recommended Deployment

- Use a dedicated church-device Wi-Fi network or wired LAN when possible.
- Reserve the Raspberry Pi IP address in the router.
- Keep the Pi behind the church router/firewall.
- Use strong administrator and operator passwords.
- Grant users only the permissions they need.
- Download complete backups and store copies off the Pi.
- Run the validation checklist before relying on a release during worship.

## Reporting A Security Issue

If you find a security issue, do not post public exploit details in an issue. Contact the repository owner directly with:

- A description of the issue.
- Steps to reproduce.
- Possible impact.
- Any suggested fix.

## Production Checklist

Before worship use, run:

```bash
npm run check
npm test
sudo hymn-console-self-test
```

Then complete `docs/PRODUCTION-VALIDATION.md`.
