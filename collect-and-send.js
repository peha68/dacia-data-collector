const path = require('path');
const nodemailer = require('nodemailer');

require('dotenv').config({
    path: path.resolve(__dirname, '.env'),
    override: true
});

const APP_URL =
    process.env.DACIA_APP_URL ||
    'http://127.0.0.1:3000/api/status';

const GMAIL_USER =
    process.env.GMAIL_USER;

const GMAIL_APP_PASSWORD =
    process.env.GMAIL_APP_PASSWORD;

const REPORT_RECIPIENT =
    process.env.REPORT_RECIPIENT ||
    GMAIL_USER;

function validateEnvironment() {
    const missing = [];

    if (!GMAIL_USER) {
        missing.push('GMAIL_USER');
    }

    if (!GMAIL_APP_PASSWORD) {
        missing.push('GMAIL_APP_PASSWORD');
    }

    if (!REPORT_RECIPIENT) {
        missing.push('REPORT_RECIPIENT');
    }

    if (missing.length > 0) {
        throw new Error(
            `Brakuje zmiennych w .env: ${missing.join(', ')}`
        );
    }
}

async function readJsonResponse(response) {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            `Serwer nie zwrócił JSON: ${text.slice(0, 500)}`
        );
    }
}

function formatDateForSubject(date) {
    return new Intl.DateTimeFormat(
        'sv-SE',
        {
            timeZone: 'Europe/Warsaw',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }
    ).format(date);
}

function extractReport(status) {
    const cockpit =
        status?.cockpit || {};

    const location =
        status?.location || {};

    return {
        reportCreatedAt:
            new Date().toISOString(),

        vehicleTimestamp:
            cockpit.timestamp || null,

        vin:
            status?.vin || null,

        accountType:
            status?.account?.accountType || null,

        mileage:
            cockpit.mileage ?? null,

        fuelQuantity:
            cockpit.fuelQuantity ?? null,

        fuelAutonomy:
            cockpit.fuelAutonomy ?? null,

        estimatedPetrolRange:
            cockpit.estimatedPetrolRange ?? null,

        estimatedLpgRange:
            cockpit.estimatedLpgRange ?? null,

        latitude:
            location.latitude ?? null,

        longitude:
            location.longitude ?? null,

        locationTimestamp:
            location.timestamp || null
    };
}

async function main() {
    validateEnvironment();

    const response = await fetch(APP_URL);

    const status =
        await readJsonResponse(response);

    if (!response.ok) {
        throw new Error(
            `Aplikacja Dacia zwróciła HTTP ${response.status}: ` +
            JSON.stringify(status)
        );
    }

    if (!status?.success) {
        throw new Error(
            `Aplikacja Dacia zwróciła błąd: ` +
            JSON.stringify(status)
        );
    }

    const report =
        extractReport(status);

    const transporter =
        nodemailer.createTransport({
            service: 'gmail',

            auth: {
                user:
                    GMAIL_USER,

                pass:
                    GMAIL_APP_PASSWORD
            }
        });

    await transporter.verify();

    const reportDate =
        formatDateForSubject(
            new Date()
        );

    const subject =
        `DACIA_DAILY_STATUS ${reportDate}`;

    const json =
        JSON.stringify(
            report,
            null,
            2
        );

    await transporter.sendMail({
        from:
            `"Dacia Debian" <${GMAIL_USER}>`,

        to:
            REPORT_RECIPIENT,

        subject,

        text:
            json
    });

    console.log(
        `Raport wysłany: ${subject}`
    );

    console.log(json);
}

main().catch((error) => {
    console.error(
        'Błąd wysyłania raportu:',
        error
    );

    process.exitCode = 1;
});