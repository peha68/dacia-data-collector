# Security Policy

## Reporting a vulnerability

Please do not open a public GitHub issue containing credentials, tokens, VINs, vehicle coordinates, account identifiers, or complete production logs.

When reporting a security issue, include only the minimum technical information needed to reproduce it. Remove or mask all personal and vehicle-specific data.

## Sensitive data

Never commit or publish:

- `.env` files,
- My Dacia email addresses and passwords,
- Gmail app passwords,
- Gigya session tokens,
- JWTs or authorization headers,
- VINs,
- `personId` values,
- Renault/Dacia account identifiers,
- vehicle location coordinates,
- raw logs containing personal or vehicle data.

## If a secret is exposed

If a password, app password, token, or other credential is accidentally exposed:

1. revoke or rotate it immediately,
2. remove it from the working tree,
3. remove it from Git history if it was committed,
4. review access logs for the affected service,
5. create a new credential and update the local `.env` file,
6. verify that `.env` is ignored before committing again.

Useful checks:

```bash
git status --ignored
git check-ignore -v .env
git grep -nE 'DACIA_PASSWORD|GMAIL_APP_PASSWORD|x-gigya-id_token|Bearer '
```

## Remote vehicle actions

The project may expose endpoints that trigger real vehicle actions, including lights or horn activation.

Do not expose the application directly to the public internet without authentication, network restrictions, and transport encryption. Run it only on trusted systems and networks unless you have added appropriate access controls.

## Supported versions

Security fixes are applied to the latest version of the project. Older revisions may not receive updates.

## Disclaimer

This project uses unofficial and undocumented Renault/Dacia services. API behavior, authentication requirements, and endpoint availability may change without notice.
