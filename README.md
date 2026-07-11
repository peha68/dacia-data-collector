# Dacia Data Collector

An unofficial Node.js application that retrieves vehicle data from Dacia/Renault services and can send a daily JSON report by email.

> This project uses undocumented manufacturer endpoints. It is not affiliated with, endorsed by, or supported by Renault Group, Dacia, Home Assistant, Google, or GitHub.

## Features

- signs in to a My Dacia account through Gigya,
- finds a configured vehicle by VIN,
- retrieves mileage, fuel quantity, and vehicle location,
- estimates petrol and LPG range,
- exposes the current vehicle status through an HTTP API,
- sends a JSON report by email,
- updates Renault/Dacia client configuration from the community-maintained `hacf-fr/renault-api` project,
- provides basic installation and endpoint diagnostics.

## Requirements

- Node.js 18 or newer,
- a My Dacia account with a vehicle assigned to it,
- optionally, a Gmail account with two-step verification and an app password.

## Installation

```bash
git clone https://github.com/peha68/dacia-data-collector.git
cd dacia-data-collector
npm ci
cp .env.example .env
```

At minimum, configure the following values in `.env`:

```env
DACIA_EMAIL=your_email@example.com
DACIA_PASSWORD=your_password
CAR_VIN=YOUR_VEHICLE_VIN
COUNTRY_CODE=PL
```

Never commit the `.env` file to the repository.

## Renault/Dacia client configuration

The project includes a verified client configuration file at:

```text
config/renault-client.json
```

The values are based on the community-maintained open-source project `hacf-fr/renault-api`. This is not an official Renault or Dacia repository.

To refresh the client configuration, run:

```bash
npm run update-config
```

The command downloads `const.py`, extracts the European Gigya and Kamereon values, validates their format, and saves a local copy. The application does not download this configuration on every startup, so an unavailable GitHub source will not stop an already configured installation from working.

Environment variables have priority over the local configuration and can be used to override it:

```env
GIGYA_API_KEY=
KAMEREON_API_KEY=
GIGYA_TARGET=
KAMEREON_TARGET=
```

In most installations, these values should be left empty.

## Diagnostics

Run:

```bash
npm run doctor
```

This checks the required environment variables, configuration format, and endpoint availability. It does not send your password or vehicle data to GitHub.

For a complete account and vehicle test, start the server:

```bash
npm start
```

Then, in another terminal:

```bash
curl http://127.0.0.1:3000/api/status
```

## Available HTTP endpoints

Depending on the vehicle model and enabled connected services, the application may expose endpoints such as:

```text
GET  /api/status
GET  /api/raw/cockpit
GET  /api/test/cockpit
GET  /api/test/extra
GET  /api/location
GET  /api/pressure
GET  /api/alerts
GET  /api/lock-status
GET  /api/hvac-status
POST /api/actions/horn
POST /api/actions/lights
```

Not every vehicle supports every endpoint. A `403` or `404` response may simply mean that the feature is not available for the vehicle, account, country, or connected-services package.

The `horn` and `lights` routes perform real remote vehicle actions. Use them carefully and only on a vehicle you own or are authorized to control.

## Sending a report

Configure:

```env
GMAIL_USER=your_email@gmail.com
GMAIL_APP_PASSWORD=your_google_app_password
REPORT_RECIPIENT=recipient@example.com
DACIA_APP_URL=http://127.0.0.1:3000/api/status
```

Then run:

```bash
npm run report
```

Example cron entry for sending a report every day at 23:59:

```cron
59 23 * * * cd /opt/dacia-data-collector && /usr/bin/node collect-and-send.js >> /var/log/dacia-report.log 2>&1
```

## npm scripts

| Command | Description |
|---|---|
| `npm start` | Starts the HTTP server |
| `npm run report` | Sends a one-time email report |
| `npm run doctor` | Checks the installation and configuration |
| `npm run update-config` | Refreshes the Renault/Dacia client configuration |
| `npm run check` | Checks the syntax of all JavaScript files |

## Security

Never publish or commit:

- `.env`,
- My Dacia email addresses or passwords,
- Gmail app passwords,
- session tokens or JWTs,
- VINs, `personId` values, or account identifiers,
- vehicle location data,
- production logs containing personal or vehicle data.

Before publishing changes, run:

```bash
git status --ignored
git grep -nE 'DACIA_PASSWORD|GMAIL_APP_PASSWORD|x-gigya-id_token|Bearer '
```

Also read [SECURITY.md](SECURITY.md).

## Client configuration source

Gigya and Kamereon API keys are application client identifiers used to begin the authentication flow. They are not user passwords or session tokens.

The project can refresh these values from the current version of the community-maintained `hacf-fr/renault-api` library. That external source may change structure or stop being maintained, so updates are manual, validated, and saved locally.

## Limitations

- The API is unofficial and may change without notice.
- Vehicle data may be delayed or cached.
- Not every vehicle supports every endpoint.
- Some active endpoints require specific vehicle hardware or connected-services subscriptions.
- `fuelQuantity` may not distinguish petrol from LPG.
- Remote actions may be unavailable even when read-only telemetry works.

## License

MIT. See [LICENSE](LICENSE).
