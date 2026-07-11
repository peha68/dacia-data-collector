const path = require('path');

require('dotenv').config({
    path: path.resolve(__dirname, '.env'),
    override: false
});

const express = require('express');
const { loadRenaultConfig } = require('./lib/renault-config');

const app = express();

// ============================================================================
// ZMIENNE ŚRODOWISKOWE
// ============================================================================

const DACIA_EMAIL =
    process.env.DACIA_EMAIL;

const DACIA_PASSWORD =
    process.env.DACIA_PASSWORD;

const CAR_VIN =
    process.env.CAR_VIN;

const COUNTRY_CODE =
    process.env.COUNTRY_CODE || 'PL';

const PORT =
    Number(process.env.PORT) || 3000;

const PETROL_CONSUMPTION =
    Number(process.env.PETROL_CONSUMPTION) || 6.3;

const LPG_CONSUMPTION =
    Number(process.env.LPG_CONSUMPTION) || 7.2;

// ============================================================================
// KONFIGURACJA RENAULT / DACIA
// ============================================================================

const CONFIG = loadRenaultConfig();

// ============================================================================
// WALIDACJA
// ============================================================================

function validateEnvironment() {
    const missing = [];

    if (!DACIA_EMAIL) {
        missing.push('DACIA_EMAIL');
    }

    if (!DACIA_PASSWORD) {
        missing.push('DACIA_PASSWORD');
    }

    if (!CAR_VIN) {
        missing.push('CAR_VIN');
    }


    if (missing.length > 0) {
        throw new Error(
            `Brakuje zmiennych w .env: ${missing.join(', ')}`
        );
    }
}

// ============================================================================
// FUNKCJE POMOCNICZE
// ============================================================================

async function readResponse(response) {
    const rawBody = await response.text();

    if (!rawBody) {
        return null;
    }

    try {
        return JSON.parse(rawBody);
    } catch {
        return rawBody;
    }
}

function getErrorMessage(data) {
    if (!data) {
        return 'Brak treści odpowiedzi';
    }

    if (typeof data === 'string') {
        return data.slice(0, 1000);
    }

    return (
        data.errorMessage ||
        data.message ||
        data.error_description ||
        data.error ||
        data?.errors?.[0]?.errorMessage ||
        data?.messages?.[0]?.message ||
        JSON.stringify(data).slice(0, 1000)
    );
}

function kamereonHeaders(jwtToken) {
    return {
        'Content-Type':
            'application/vnd.api+json',

        apikey:
            CONFIG.kamereonApiKey,

        'x-gigya-id_token':
            jwtToken
    };
}

async function postForm(url, fields) {
    const response = await fetch(url, {
        method: 'POST',

        headers: {
            'Content-Type':
                'application/x-www-form-urlencoded',

            Accept:
                'application/json'
        },

        body:
            new URLSearchParams(fields)
    });

    const data =
        await readResponse(response);

    return {
        response,
        data
    };
}

async function kamereonGet(
    url,
    jwtToken
) {
    const response = await fetch(url, {
        method: 'GET',
        headers: kamereonHeaders(jwtToken)
    });

    const data =
        await readResponse(response);

    return {
        response,
        data,
        url
    };
}

function numberOrNull(value) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return null;
    }

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}

function formatNumber(
    value,
    fractionDigits = 1
) {
    const number =
        numberOrNull(value);

    if (number === null) {
        return null;
    }

    return new Intl.NumberFormat(
        'pl-PL',
        {
            maximumFractionDigits:
                fractionDigits
        }
    ).format(number);
}

function formatWarsawDate(timestamp) {
    if (!timestamp) {
        return 'Brak danych';
    }

    const date =
        new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return 'Brak danych';
    }

    return new Intl.DateTimeFormat(
        'pl-PL',
        {
            dateStyle: 'medium',
            timeStyle: 'medium',
            timeZone: 'Europe/Warsaw'
        }
    ).format(date);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function calculateRange(
    quantity,
    consumption
) {
    const fuel =
        numberOrNull(quantity);

    const averageConsumption =
        numberOrNull(consumption);

    if (
        fuel === null ||
        averageConsumption === null ||
        averageConsumption <= 0
    ) {
        return null;
    }

    return Math.round(
        fuel /
        averageConsumption *
        100
    );
}

// ============================================================================
// LOGOWANIE DO GIGYA
// ============================================================================

async function loginToGigya() {
    const {
        response,
        data
    } = await postForm(
        `${CONFIG.gigyaTarget}/accounts.login`,
        {
            apiKey:
                CONFIG.gigyaApiKey,

            loginID:
                DACIA_EMAIL,

            password:
                DACIA_PASSWORD,

            include:
                'profile,data',

            format:
                'json'
        }
    );

    if (
        !response.ok ||
        data?.errorCode !== 0
    ) {
        throw new Error(
            `Gigya login HTTP ${response.status}: ` +
            `${getErrorMessage(data)}`
        );
    }

    const loginToken =
        data?.sessionInfo?.cookieValue ||
        data?.sessionInfo?.sessionToken ||
        data?.login_token;

    if (!loginToken) {
        throw new Error(
            'Gigya nie zwróciła tokenu sesji.'
        );
    }

    console.log(
        'Logowanie do Gigya zakończone poprawnie.'
    );

    return loginToken;
}

// ============================================================================
// PERSON ID
// ============================================================================

async function getPersonId(loginToken) {
    const {
        response,
        data
    } = await postForm(
        `${CONFIG.gigyaTarget}/accounts.getAccountInfo`,
        {
            apiKey:
                CONFIG.gigyaApiKey,

            login_token:
                loginToken,

            include:
                'profile,data',

            format:
                'json'
        }
    );

    if (
        !response.ok ||
        data?.errorCode !== 0
    ) {
        throw new Error(
            `Gigya account info HTTP ${response.status}: ` +
            `${getErrorMessage(data)}`
        );
    }

    const personId =
        data?.data?.personId ||
        data?.data?.personID ||
        data?.profile?.personId ||
        data?.UID;

    if (!personId) {
        throw new Error(
            'Nie znaleziono personId.'
        );
    }

    console.log('Znaleziono identyfikator konta użytkownika.');

    return personId;
}

// ============================================================================
// TOKEN JWT
// ============================================================================

async function getJwt(loginToken) {
    const {
        response,
        data
    } = await postForm(
        `${CONFIG.gigyaTarget}/accounts.getJWT`,
        {
            apiKey:
                CONFIG.gigyaApiKey,

            login_token:
                loginToken,

            fields:
                'data.personId,data.gigyaDataCenter',

            expiration:
                '900',

            format:
                'json'
        }
    );

    if (
        !response.ok ||
        data?.errorCode !== 0 ||
        !data?.id_token
    ) {
        throw new Error(
            `Gigya JWT HTTP ${response.status}: ` +
            `${getErrorMessage(data)}`
        );
    }

    console.log(
        'Token JWT został wygenerowany poprawnie.'
    );

    return data.id_token;
}

// ============================================================================
// DANE OSOBY I KONTA
// ============================================================================

async function getPersonData(
    personId,
    jwtToken
) {
    const url =
        `${CONFIG.kamereonTarget}` +
        `/commerce/v1/persons/` +
        `${encodeURIComponent(personId)}` +
        `?country=${encodeURIComponent(COUNTRY_CODE)}`;

    const result =
        await kamereonGet(
            url,
            jwtToken
        );

    if (!result.response.ok) {
        throw new Error(
            `Kamereon Person HTTP ` +
            `${result.response.status}: ` +
            `${getErrorMessage(result.data)}`
        );
    }

    return result.data;
}

async function getVehiclesForAccount(
    accountId,
    jwtToken
) {
    const url =
        `${CONFIG.kamereonTarget}` +
        `/commerce/v1/accounts/` +
        `${encodeURIComponent(accountId)}` +
        `/vehicles` +
        `?country=${encodeURIComponent(COUNTRY_CODE)}`;

    return kamereonGet(
        url,
        jwtToken
    );
}

async function findVehicleAccount(
    personId,
    jwtToken
) {
    console.log(
        'Pobieram listę kont Kamereon...'
    );

    const personData =
        await getPersonData(
            personId,
            jwtToken
        );

    const accounts =
        personData?.accounts ||
        personData?.data?.attributes?.accounts ||
        [];

    if (
        !Array.isArray(accounts) ||
        accounts.length === 0
    ) {
        throw new Error(
            'Kamereon nie zwrócił żadnych kont.'
        );
    }

    console.log(`Znaleziono ${accounts.length} kont Kamereon.`);

    for (const account of accounts) {
        if (
            !account.accountId ||
            account.accountStatus !== 'ACTIVE'
        ) {
            continue;
        }

        console.log(`Sprawdzam aktywne konto typu ${account.accountType}.`);

        const result =
            await getVehiclesForAccount(
                account.accountId,
                jwtToken
            );

        if (!result.response.ok) {
            continue;
        }

        const vehicles =
            result.data?.vehicleLinks ||
            result.data?.data?.attributes?.vehicleLinks ||
            result.data?.vehicles ||
            result.data?.data ||
            [];

        if (!Array.isArray(vehicles)) {
            continue;
        }

        console.log(
            `Konto ${account.accountType} zwróciło ` +
            `${vehicles.length} pojazdów.`
        );

        const vehicle =
            vehicles.find((item) => {
                const vin =
                    item?.vin ||
                    item?.vehicleDetails?.vin ||
                    item?.attributes?.vin ||
                    item?.id;

                return (
                    typeof vin === 'string' &&
                    vin.toUpperCase() ===
                        CAR_VIN.toUpperCase()
                );
            });

        if (vehicle) {
            console.log('Znaleziono skonfigurowany pojazd.');

            return {
                accountId:
                    account.accountId,

                accountType:
                    account.accountType,

                vehicle
            };
        }
    }

    throw new Error(
        `Nie znaleziono VIN ${CAR_VIN} na żadnym koncie.`
    );
}

// ============================================================================
// COCKPIT V1 / V2
// ============================================================================

async function getCockpitVersion(
    accountId,
    jwtToken,
    version
) {
    const url =
        `${CONFIG.kamereonTarget}` +
        `/commerce/v1/accounts/` +
        `${encodeURIComponent(accountId)}` +
        `/kamereon/kca/car-adapter/` +
        `v${version}/cars/` +
        `${encodeURIComponent(CAR_VIN)}` +
        `/cockpit` +
        `?country=${encodeURIComponent(COUNTRY_CODE)}`;

    return kamereonGet(
        url,
        jwtToken
    );
}

function hasValidCockpitData(data) {
    const attributes =
        data?.data?.attributes;

    if (
        !attributes ||
        typeof attributes !== 'object'
    ) {
        return false;
    }

    return (
        attributes.totalMileage !== undefined ||
        attributes.fuelQuantity !== undefined ||
        attributes.fuelAutonomy !== undefined ||
        attributes.timestamp !== undefined
    );
}

async function getCockpit(
    accountId,
    jwtToken
) {
    console.log(
        'Sprawdzam cockpit v2...'
    );

    const version2 =
        await getCockpitVersion(
            accountId,
            jwtToken,
            2
        );

    if (
        version2.response.ok &&
        hasValidCockpitData(version2.data)
    ) {
        console.log(
            'Cockpit v2 zwrócił prawidłowe dane.'
        );

        return {
            version: 2,
            data: version2.data
        };
    }

    console.log(
        'Cockpit v2 nie zwrócił danych samochodu:',
        version2.data
    );

    console.log(
        'Sprawdzam cockpit v1...'
    );

    const version1 =
        await getCockpitVersion(
            accountId,
            jwtToken,
            1
        );

    if (
        version1.response.ok &&
        hasValidCockpitData(version1.data)
    ) {
        console.log(
            'Cockpit v1 zwrócił prawidłowe dane.'
        );

        return {
            version: 1,
            data: version1.data
        };
    }

    throw new Error(
        `Cockpit v2 HTTP ${version2.response.status}: ` +
        `${getErrorMessage(version2.data)}; ` +
        `cockpit v1 HTTP ${version1.response.status}: ` +
        `${getErrorMessage(version1.data)}`
    );
}

// ============================================================================
// LOKALIZACJA
// ============================================================================

async function getLocation(
    accountId,
    jwtToken
) {
    const url =
        `${CONFIG.kamereonTarget}` +
        `/commerce/v1/accounts/` +
        `${encodeURIComponent(accountId)}` +
        `/kamereon/kca/car-adapter/v1/cars/` +
        `${encodeURIComponent(CAR_VIN)}` +
        `/location` +
        `?country=${encodeURIComponent(COUNTRY_CODE)}`;

    const result =
        await kamereonGet(
            url,
            jwtToken
        );

    if (!result.response.ok) {
        return {
            success: false,
            status: result.response.status,
            data: result.data
        };
    }

    return {
        success: true,
        status: result.response.status,
        data: result.data
    };
}

// ============================================================================
// CIŚNIENIE OPON
// ============================================================================

async function getPressure(
    accountId,
    jwtToken
) {
    const url =
        `${CONFIG.kamereonTarget}` +
        `/commerce/v1/accounts/` +
        `${encodeURIComponent(accountId)}` +
        `/kamereon/kca/car-adapter/v1/cars/` +
        `${encodeURIComponent(CAR_VIN)}` +
        `/pressure` +
        `?country=${encodeURIComponent(COUNTRY_CODE)}`;

    console.log(
        'Pobieram pressure:',
        url
    );

    const result =
        await kamereonGet(
            url,
            jwtToken
        );

    if (!result.response.ok) {
        console.log(
            `Pressure HTTP ${result.response.status}:`,
            result.data
        );

        return {
            success: false,
            status: result.response.status,
            data: result.data
        };
    }

    const attributes =
        result.data?.data?.attributes ||
        null;

    if (!attributes) {
        return {
            success: false,
            status: result.response.status,
            data: result.data
        };
    }

    return {
        success: true,
        status: result.response.status,
        data: result.data,
        attributes
    };
}

function pressureToBar(value) {
    const number =
        numberOrNull(value);

    if (number === null) {
        return null;
    }

    return number / 1000;
}

function normalizePressure(pressureResult) {
    if (!pressureResult?.success) {
        return {
            available: false,

            status:
                pressureResult?.status || null,

            error:
                pressureResult?.data || null,

            frontLeft: null,
            frontRight: null,
            rearLeft: null,
            rearRight: null
        };
    }

    const source =
        pressureResult.attributes ||
        {};

    return {
        available: true,

        status:
            pressureResult.status,

        frontLeft:
            pressureToBar(
                source.flPressure
            ),

        frontRight:
            pressureToBar(
                source.frPressure
            ),

        rearLeft:
            pressureToBar(
                source.rlPressure
            ),

        rearRight:
            pressureToBar(
                source.rrPressure
            ),

        frontLeftStatus:
            source.flStatus ?? null,

        frontRightStatus:
            source.frStatus ?? null,

        rearLeftStatus:
            source.rlStatus ?? null,

        rearRightStatus:
            source.rrStatus ?? null
    };
}

// ============================================================================
// UMOWY I GWARANCJE
// ============================================================================

async function getContracts(
    accountId,
    jwtToken
) {
    const url =
        `${CONFIG.kamereonTarget}` +
        `/commerce/v1/accounts/` +
        `${encodeURIComponent(accountId)}` +
        `/vehicles/` +
        `${encodeURIComponent(CAR_VIN)}` +
        `/contracts` +
        `?country=${encodeURIComponent(COUNTRY_CODE)}` +
        `&locale=pl_PL` +
        `&brand=DACIA` +
        `&connectedServicesContracts=true` +
        `&warranty=true` +
        `&warrantyMaintenanceContracts=true`;

    const result =
        await kamereonGet(
            url,
            jwtToken
        );

    if (
        !result.response.ok ||
        !Array.isArray(result.data)
    ) {
        return [];
    }

    return result.data;
}

// ============================================================================
// NORMALIZACJA COCKPIT
// ============================================================================

function normalizeCockpit(
    cockpitResult
) {
    const source =
        cockpitResult?.data?.data?.attributes ||
        {};

    const mileage =
        numberOrNull(
            source.totalMileage ??
            source.mileage
        );

    const fuelQuantity =
        numberOrNull(
            source.fuelQuantity ??
            source.fuelLevel
        );

    const fuelAutonomy =
        numberOrNull(
            source.fuelAutonomy ??
            source.fuelRange ??
            source.autonomy
        );

    const estimatedPetrolRange =
        fuelQuantity !== null
            ? calculateRange(
                fuelQuantity,
                PETROL_CONSUMPTION
            )
            : null;

    const estimatedLpgRange =
        fuelQuantity !== null
            ? calculateRange(
                fuelQuantity,
                LPG_CONSUMPTION
            )
            : null;

    return {
        cockpitVersion:
            cockpitResult.version,

        mileage,

        fuelQuantity,

        fuelAutonomy,

        estimatedPetrolRange,

        estimatedLpgRange,

        timestamp:
            source.timestamp ||
            source.lastUpdateTime ||
            null,

        rawAttributes:
            source
    };
}

// ============================================================================
// NORMALIZACJA LOKALIZACJI
// ============================================================================

function normalizeLocation(
    locationResult
) {
    if (!locationResult?.success) {
        return {
            available: false,
            latitude: null,
            longitude: null,
            timestamp: null
        };
    }

    const source =
        locationResult?.data?.data?.attributes ||
        {};

    return {
        available: true,

        latitude:
            numberOrNull(
                source.gpsLatitude ??
                source.latitude
            ),

        longitude:
            numberOrNull(
                source.gpsLongitude ??
                source.longitude
            ),

        timestamp:
            source.lastUpdateTime ||
            source.timestamp ||
            null
    };
}


// ============================================================================
// DODATKOWE ENDPOINTY TYLKO DO ODCZYTU
// ============================================================================

function buildCarAdapterUrl(accountId, endpoint, version = 1) {
    const normalizedEndpoint = String(endpoint).replace(/^\/+|\/+$/g, '');

    return (
        `${CONFIG.kamereonTarget}` +
        `/commerce/v1/accounts/${accountId}` +
        `/kamereon/kca/car-adapter/v${version}` +
        `/cars/${CAR_VIN}/${normalizedEndpoint}` +
        `?country=${encodeURIComponent(COUNTRY_CODE)}`
    );
}

async function getReadOnlyCarEndpoint(
    accountId,
    jwtToken,
    endpoint,
    version = 1
) {
    const url = buildCarAdapterUrl(
        accountId,
        endpoint,
        version
    );

    const result = await kamereonGet(
        url,
        jwtToken
    );

    return {
        endpoint,
        version,
        url,
        status: result.response.status,
        success: result.response.ok,
        data: result.data
    };
}

async function getAlerts(accountId, jwtToken) {
    const candidateUrls = [
        `${CONFIG.kamereonTarget}` +
            `/commerce/v1/accounts/${accountId}` +
            `/kamereon/kca/car-adapter/v1/cars/${CAR_VIN}/alerts` +
            `?country=${encodeURIComponent(COUNTRY_CODE)}`,

        `${CONFIG.kamereonTarget}` +
            `/commerce/v1/accounts/${accountId}` +
            `/kamereon/vehicles/${CAR_VIN}/alerts`
    ];

    const attempts = [];

    for (const url of candidateUrls) {
        const result = await kamereonGet(
            url,
            jwtToken
        );

        attempts.push({
            url,
            status: result.response.status,
            success: result.response.ok,
            data: result.data
        });

        if (result.response.ok) {
            return {
                success: true,
                status: result.response.status,
                url,
                data: result.data,
                attempts
            };
        }
    }

    return {
        success: false,
        status: attempts.at(-1)?.status || 500,
        url: attempts.at(-1)?.url || null,
        data: attempts.at(-1)?.data || null,
        attempts
    };
}

async function testExtraReadOnlyEndpoints(accountId, jwtToken) {
    const tests = [
        { name: 'location', endpoint: 'location', version: 1 },
        { name: 'lock-status', endpoint: 'lock-status', version: 1 },
        { name: 'hvac-status', endpoint: 'hvac-status', version: 1 },
        { name: 'hvac-settings', endpoint: 'hvac-settings', version: 1 },
        {
            name: 'notification-settings',
            endpoint: 'notification-settings',
            version: 1
        },
        { name: 'res-state', endpoint: 'res-state', version: 1 },
        { name: 'battery-status-v1', endpoint: 'battery-status', version: 1 },
        { name: 'battery-status-v2', endpoint: 'battery-status', version: 2 },
        { name: 'charging-settings', endpoint: 'charging-settings', version: 1 },
        { name: 'charge-mode', endpoint: 'charge-mode', version: 1 }
    ];

    const results = [];

    for (const test of tests) {
        const result = await getReadOnlyCarEndpoint(
            accountId,
            jwtToken,
            test.endpoint,
            test.version
        );

        console.log(
            `Test endpointu ${test.name}: HTTP ${result.status}`
        );

        results.push({
            name: test.name,
            ...result
        });
    }

    return results;
}

// ============================================================================
// SESJA
// ============================================================================

async function createSession() {
    validateEnvironment();

    console.log(
        'Używam konfiguracji Renault/Dacia.'
    );

    const loginToken =
        await loginToGigya();

    const personId =
        await getPersonId(
            loginToken
        );

    const jwtToken =
        await getJwt(
            loginToken
        );

    const account =
        await findVehicleAccount(
            personId,
            jwtToken
        );

    return {
        loginToken,
        personId,
        jwtToken,
        ...account
    };
}

// ============================================================================
// PEŁNY STATUS SAMOCHODU
// ============================================================================

async function getVehicleStatus() {
    const session =
        await createSession();

    const [
        cockpitResult,
        locationResult,
        pressureResult,
        contracts
    ] = await Promise.all([
        getCockpit(
            session.accountId,
            session.jwtToken
        ),

        getLocation(
            session.accountId,
            session.jwtToken
        ),

        getPressure(
            session.accountId,
            session.jwtToken
        ),

        getContracts(
            session.accountId,
            session.jwtToken
        )
    ]);

    return {
        session,

        cockpit:
            normalizeCockpit(
                cockpitResult
            ),

        location:
            normalizeLocation(
                locationResult
            ),

        pressure:
            normalizePressure(
                pressureResult
            ),

        contracts
    };
}

// ============================================================================
// HTML
// ============================================================================

function renderRow(
    label,
    value,
    note = null
) {
    return `
        <div class="row">
            <span class="label">
                ${escapeHtml(label)}
            </span>

            <span class="value">
                ${value}

                ${
                    note
                        ? `
                            <span class="note">
                                ${escapeHtml(note)}
                            </span>
                        `
                        : ''
                }
            </span>
        </div>
    `;
}

function pageTemplate(content) {
    return `
        <!DOCTYPE html>

        <html lang="pl">

        <head>
            <meta charset="UTF-8">

            <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
            >

            <title>Dacia Bigster</title>

            <style>
                * {
                    box-sizing: border-box;
                }

                body {
                    margin: 0;
                    padding: 24px;

                    background: #f2f4f5;
                    color: #26333d;

                    font-family:
                        -apple-system,
                        BlinkMacSystemFont,
                        "Segoe UI",
                        Roboto,
                        Arial,
                        sans-serif;
                }

                .card {
                    width: 100%;
                    max-width: 650px;

                    margin: 24px auto;
                    padding: 28px;

                    background: white;
                    border-radius: 18px;

                    box-shadow:
                        0 8px 32px
                        rgba(0, 0, 0, 0.08);
                }

                h1 {
                    margin: 0 0 6px;
                }

                h2 {
                    margin: 28px 0 8px;
                    font-size: 18px;
                }

                .subtitle {
                    margin-bottom: 20px;
                    color: #77838c;
                    font-size: 13px;
                }

                .row {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;

                    gap: 20px;
                    padding: 13px 0;

                    border-bottom:
                        1px solid #eeeeee;
                }

                .label {
                    color: #71808b;
                }

                .value {
                    max-width: 65%;
                    text-align: right;
                    font-weight: 700;
                }

                .note {
                    display: block;
                    margin-top: 4px;

                    color: #89949c;
                    font-size: 11px;
                    font-weight: 400;
                }

                .warning {
                    margin-top: 18px;
                    padding: 12px;

                    border-radius: 9px;
                    background: #fff7df;
                    color: #755c14;

                    font-size: 13px;
                    line-height: 1.5;
                }

                .contract {
                    padding: 10px 0;
                    border-bottom:
                        1px solid #eeeeee;

                    font-size: 14px;
                }

                .buttons {
                    margin-top: 22px;
                }

                .button {
                    display: inline-block;

                    margin: 6px 6px 0 0;
                    padding: 11px 16px;

                    border-radius: 9px;
                    background: #2d7847;
                    color: white;

                    text-decoration: none;
                    font-weight: 700;
                }

                .button.secondary {
                    background: #34495e;
                }

                .error {
                    color: #c0392b;
                }

                a {
                    color: #1768a9;
                }
            </style>
        </head>

        <body>
            <div class="card">
                ${content}
            </div>
        </body>

        </html>
    `;
}

// ============================================================================
// STRONA GŁÓWNA
// ============================================================================

app.get('/', async (req, res) => {
    try {
        console.log('');
        console.log(
            '=========================================='
        );
        console.log(
            'Pobieram dane Dacia Bigster...'
        );
        console.log(
            '=========================================='
        );

        const status =
            await getVehicleStatus();

        const {
            session,
            cockpit,
            location,
            pressure,
            contracts
        } = status;

        const mapLink =
            location.latitude !== null &&
            location.longitude !== null
                ? (
                    `https://www.google.com/maps?q=` +
                    `${encodeURIComponent(location.latitude)},` +
                    `${encodeURIComponent(location.longitude)}`
                )
                : null;

        const warranties =
            contracts.filter(
                (contract) =>
                    contract.status === 'ACTIVE' &&
                    contract.type === 'WARRANTY'
            );

        let pressureHtml = '';

        if (pressure.available) {
            pressureHtml = `
                <h2>Ciśnienie opon</h2>

                ${renderRow(
                    'Przód lewy',
                    pressure.frontLeft !== null
                        ? `${formatNumber(
                            pressure.frontLeft,
                            2
                        )} bar`
                        : 'Brak danych'
                )}

                ${renderRow(
                    'Przód prawy',
                    pressure.frontRight !== null
                        ? `${formatNumber(
                            pressure.frontRight,
                            2
                        )} bar`
                        : 'Brak danych'
                )}

                ${renderRow(
                    'Tył lewy',
                    pressure.rearLeft !== null
                        ? `${formatNumber(
                            pressure.rearLeft,
                            2
                        )} bar`
                        : 'Brak danych'
                )}

                ${renderRow(
                    'Tył prawy',
                    pressure.rearRight !== null
                        ? `${formatNumber(
                            pressure.rearRight,
                            2
                        )} bar`
                        : 'Brak danych'
                )}
            `;
        } else {
            pressureHtml = `
                <h2>Ciśnienie opon</h2>

                <div class="warning">
                    Endpoint pressure nie zwrócił danych.
                    Status HTTP:
                    ${escapeHtml(
                        pressure.status ?? 'brak'
                    )}.
                </div>
            `;
        }

        const warrantiesHtml =
            warranties.length > 0
                ? `
                    <h2>Aktywne gwarancje</h2>

                    ${warranties
                        .map(
                            (contract) => `
                                <div class="contract">
                                    <strong>
                                        ${escapeHtml(
                                            contract.description
                                        )}
                                    </strong>

                                    ${
                                        contract.endDate
                                            ? `
                                                <br>
                                                do:
                                                ${escapeHtml(
                                                    contract.endDate
                                                )}
                                            `
                                            : ''
                                    }
                                </div>
                            `
                        )
                        .join('')}
                `
                : '';

        res.status(200).send(
            pageTemplate(`
                <h1>Dacia Bigster</h1>

                <div class="subtitle">
                    VIN:
                    ${escapeHtml(CAR_VIN)}
                    · konto:
                    ${escapeHtml(session.accountType)}
                    · cockpit v${cockpit.cockpitVersion}
                </div>

                ${renderRow(
                    'Przebieg',
                    cockpit.mileage !== null
                        ? `${formatNumber(
                            cockpit.mileage,
                            0
                        )} km`
                        : 'Brak danych'
                )}

                ${renderRow(
                    'Paliwo raportowane przez auto',
                    cockpit.fuelQuantity !== null
                        ? `${formatNumber(
                            cockpit.fuelQuantity
                        )} l`
                        : 'Brak danych',

                    'API nie określa, czy jest to benzyna, czy LPG'
                )}

                ${
                    cockpit.fuelAutonomy !== null
                        ? renderRow(
                            'Zasięg raportowany przez auto',
                            `${formatNumber(
                                cockpit.fuelAutonomy,
                                0
                            )} km`
                        )
                        : ''
                }

                ${renderRow(
                    'Zasięg, jeśli wartość oznacza benzynę',
                    cockpit.estimatedPetrolRange !== null
                        ? `około ${formatNumber(
                            cockpit.estimatedPetrolRange,
                            0
                        )} km`
                        : 'Brak danych',

                    `szacunek przy ${PETROL_CONSUMPTION} l/100 km`
                )}

                ${renderRow(
                    'Zasięg, jeśli wartość oznacza LPG',
                    cockpit.estimatedLpgRange !== null
                        ? `około ${formatNumber(
                            cockpit.estimatedLpgRange,
                            0
                        )} km`
                        : 'Brak danych',

                    `szacunek przy ${LPG_CONSUMPTION} l/100 km`
                )}

                ${renderRow(
                    'Aktualizacja danych',
                    escapeHtml(
                        formatWarsawDate(
                            cockpit.timestamp
                        )
                    )
                )}

                ${renderRow(
                    'Lokalizacja',
                    mapLink
                        ? `
                            <a
                                href="${mapLink}"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Pokaż na mapie
                            </a>
                        `
                        : 'Brak danych',

                    location.timestamp
                        ? formatWarsawDate(
                            location.timestamp
                        )
                        : null
                )}

                <div class="warning">
                    Renault API zwraca obecnie tylko jedno pole
                    <strong>fuelQuantity</strong>.
                    Nie ma osobnych wartości dla benzyny i LPG,
                    dlatego aplikacja nie przypisuje tej ilości
                    do konkretnego zbiornika.
                </div>

                ${pressureHtml}

                ${warrantiesHtml}

                <div class="buttons">
                    <a
                        class="button"
                        href="/"
                    >
                        Odśwież
                    </a>

                    <a
                        class="button secondary"
                        href="/api/status"
                    >
                        Status JSON
                    </a>

                    <a
                        class="button secondary"
                        href="/api/raw/cockpit"
                    >
                        Surowy cockpit
                    </a>

                    <a
                        class="button secondary"
                        href="/api/pressure"
                    >
                        Pressure JSON
                    </a>
                </div>
            `)
        );
    } catch (error) {
        console.error('');
        console.error('BŁĄD:');
        console.error(error);

        res.status(500).send(
            pageTemplate(`
                <h1 class="error">
                    Błąd połączenia
                </h1>

                <p>
                    ${escapeHtml(error.message)}
                </p>

                <a
                    class="button secondary"
                    href="/"
                >
                    Spróbuj ponownie
                </a>
            `)
        );
    }
});

// ============================================================================
// STATUS JSON
// ============================================================================

app.get('/api/status', async (req, res) => {
    try {
        const status =
            await getVehicleStatus();

        res.json({
            success: true,

            vin:
                CAR_VIN,

            account: {
                accountId:
                    status.session.accountId,

                accountType:
                    status.session.accountType
            },

            cockpit:
                status.cockpit,

            location:
                status.location,

            pressure:
                status.pressure,

            contracts:
                status.contracts
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// SUROWY COCKPIT
// ============================================================================

app.get('/api/raw/cockpit', async (req, res) => {
    try {
        const session =
            await createSession();

        const cockpit =
            await getCockpit(
                session.accountId,
                session.jwtToken
            );

        res.json({
            success: true,

            cockpitVersion:
                cockpit.version,

            response:
                cockpit.data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// TEST COCKPIT V1 I V2
// ============================================================================

app.get('/api/test/cockpit', async (req, res) => {
    try {
        const session =
            await createSession();

        const [
            version1,
            version2
        ] = await Promise.all([
            getCockpitVersion(
                session.accountId,
                session.jwtToken,
                1
            ),

            getCockpitVersion(
                session.accountId,
                session.jwtToken,
                2
            )
        ]);

        res.json({
            success: true,

            version1: {
                status:
                    version1.response.status,

                validCockpitData:
                    hasValidCockpitData(
                        version1.data
                    ),

                response:
                    version1.data
            },

            version2: {
                status:
                    version2.response.status,

                validCockpitData:
                    hasValidCockpitData(
                        version2.data
                    ),

                response:
                    version2.data
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// PRESSURE JSON
// ============================================================================

app.get('/api/pressure', async (req, res) => {
    try {
        const session =
            await createSession();

        const pressureResult =
            await getPressure(
                session.accountId,
                session.jwtToken
            );

        const pressure =
            normalizePressure(
                pressureResult
            );

        res.status(
            pressureResult.success
                ? 200
                : pressureResult.status || 500
        ).json({
            success:
                pressureResult.success,

            pressure,

            raw:
                pressureResult.data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// ============================================================================
// DODATKOWE ENDPOINTY TYLKO DO ODCZYTU
// ============================================================================

app.get('/api/test/extra', async (req, res) => {
    try {
        const session = await createSession();

        const results = await testExtraReadOnlyEndpoints(
            session.accountId,
            session.jwtToken
        );

        res.json({
            success: true,
            vin: CAR_VIN,
            accountType: session.accountType,
            results
        });
    } catch (error) {
        console.error(
            'Błąd testu dodatkowych endpointów:',
            error.message
        );

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/alerts', async (req, res) => {
    try {
        const session = await createSession();

        const result = await getAlerts(
            session.accountId,
            session.jwtToken
        );

        res.status(
            result.success
                ? 200
                : result.status || 500
        ).json(result);
    } catch (error) {
        console.error(
            'Błąd pobierania alertów:',
            error.message
        );

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/lock-status', async (req, res) => {
    try {
        const session = await createSession();

        const result = await getReadOnlyCarEndpoint(
            session.accountId,
            session.jwtToken,
            'lock-status',
            1
        );

        res.status(
            result.success
                ? 200
                : result.status || 500
        ).json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/hvac-status', async (req, res) => {
    try {
        const session = await createSession();

        const result = await getReadOnlyCarEndpoint(
            session.accountId,
            session.jwtToken,
            'hvac-status',
            1
        );

        res.status(
            result.success
                ? 200
                : result.status || 500
        ).json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// DEBUG
// ============================================================================

app.get('/debug', (req, res) => {
    res.json({
        success: true,

        environment: {
            emailConfigured:
                Boolean(DACIA_EMAIL),

            passwordConfigured:
                Boolean(DACIA_PASSWORD),

            vinConfigured:
                Boolean(CAR_VIN),

            countryCode:
                COUNTRY_CODE,

            port:
                PORT
        },

        calculations: {
            petrolConsumption:
                PETROL_CONSUMPTION,

            lpgConsumption:
                LPG_CONSUMPTION
        },

        endpoints: {
            main:
                `http://localhost:${PORT}`,

            status:
                `http://localhost:${PORT}/api/status`,

            rawCockpit:
                `http://localhost:${PORT}/api/raw/cockpit`,

            cockpitTest:
                `http://localhost:${PORT}/api/test/cockpit`,

            pressure:
                `http://localhost:${PORT}/api/pressure`
        }
    });
});

// ============================================================================
// 404
// ============================================================================

app.use((req, res) => {
    res.status(404).json({
        success: false,

        error:
            'Nie znaleziono takiego adresu.',

        availableRoutes: [
            '/',
            '/api/status',
            '/api/raw/cockpit',
            '/api/test/cockpit',
            '/api/pressure',
            '/debug'
        ]
    });
});

// ============================================================================
// URUCHOMIENIE SERWERA
// ============================================================================

app.listen(PORT, () => {
    console.log('');
    console.log(
        '=========================================='
    );

    console.log(
        'Aplikacja Dacia została uruchomiona.'
    );

    console.log(
        `Strona: http://localhost:${PORT}`
    );

    console.log(
        `Status JSON: http://localhost:${PORT}/api/status`
    );

    console.log(
        `Surowy cockpit: ` +
        `http://localhost:${PORT}/api/raw/cockpit`
    );

    console.log(
        `Test cockpit v1/v2: ` +
        `http://localhost:${PORT}/api/test/cockpit`
    );

    console.log(
        `Ciśnienie opon: ` +
        `http://localhost:${PORT}/api/pressure`
    );

    console.log(
        `Debug: http://localhost:${PORT}/debug`
    );

    console.log(
        '=========================================='
    );
    console.log('');
});