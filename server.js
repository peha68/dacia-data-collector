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


app.get('/api/vehicle-details', async (req, res) => {
    try {
        const session = await createSession();

        const result = await getVehiclesForAccount(
            session.accountId,
            session.jwtToken
        );

        res.status(result.response.status).json({
            success: result.response.ok,
            status: result.response.status,
            accountType: session.accountType,
            vehicle: session.vehicle,
            data: result.data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


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

function pageTemplate(content, title = 'Dacia Data Collector') {
    return `
        <!DOCTYPE html>
        <html lang="pl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${escapeHtml(title)}</title>
            <style>
                * { box-sizing: border-box; }
                body {
                    margin: 0;
                    background: #eef1f3;
                    color: #24313a;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                }
                .topbar {
                    position: sticky; top: 0; z-index: 10;
                    background: rgba(255,255,255,.96);
                    border-bottom: 1px solid #dfe5e8;
                    backdrop-filter: blur(10px);
                }
                .topbar-inner {
                    max-width: 1180px; margin: 0 auto; padding: 13px 22px;
                    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
                }
                .brand { font-weight: 800; margin-right: auto; color: #1d2a32; }
                .nav-link {
                    display: inline-block; padding: 9px 12px; border-radius: 9px;
                    text-decoration: none; color: #41515c; font-size: 14px; font-weight: 650;
                }
                .nav-link:hover { background: #edf2f4; }
                main { max-width: 1180px; margin: 0 auto; padding: 25px 22px 44px; }
                .hero, .card {
                    background: white; border-radius: 18px;
                    box-shadow: 0 8px 28px rgba(0,0,0,.065);
                    border: 1px solid #e7ecef;
                }
                .hero { padding: 26px; margin-bottom: 20px; }
                .card { padding: 22px; }
                .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 18px; }
                .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 16px; }
                .metric { padding: 18px; background: #f7f9fa; border-radius: 14px; }
                .metric-label { color: #75838c; font-size: 13px; }
                .metric-value { margin-top: 6px; font-size: 23px; font-weight: 800; }
                h1 { margin: 0 0 7px; font-size: clamp(27px, 4vw, 42px); }
                h2 { margin: 0 0 14px; font-size: 20px; }
                h3 { margin: 20px 0 10px; font-size: 16px; }
                .subtitle, .muted { color: #71808a; }
                .row {
                    display: flex; justify-content: space-between; align-items: flex-start;
                    gap: 22px; padding: 12px 0; border-bottom: 1px solid #edf0f1;
                }
                .row:last-child { border-bottom: 0; }
                .label { color: #71808b; }
                .value { max-width: 68%; text-align: right; font-weight: 700; overflow-wrap: anywhere; }
                .note { display: block; margin-top: 4px; color: #8a959c; font-size: 11px; font-weight: 400; }
                .warning, .info {
                    margin-top: 16px; padding: 13px 15px; border-radius: 11px;
                    font-size: 13px; line-height: 1.55;
                }
                .warning { background: #fff6d9; color: #705a18; }
                .info { background: #eaf4ff; color: #234e73; }
                .button {
                    display: inline-block; margin: 7px 7px 0 0; padding: 11px 15px;
                    border-radius: 9px; background: #2d7847; color: white;
                    text-decoration: none; font-weight: 750; border: 0; cursor: pointer;
                }
                .button.secondary { background: #43545f; }
                .button.light { background: #edf2f4; color: #33434d; }
                .car-image { width: 100%; max-height: 460px; object-fit: contain; display: block; }
                .gallery { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 18px; }
                .gallery figure { margin: 0; background: white; border: 1px solid #e5eaed; border-radius: 15px; overflow: hidden; }
                .gallery img { width: 100%; min-height: 240px; object-fit: contain; background: #f5f7f8; display: block; }
                .gallery figcaption { padding: 12px 14px; font-size: 13px; color: #596972; }
                .chips { display: flex; flex-wrap: wrap; gap: 8px; }
                .chip { background: #edf2f4; border-radius: 999px; padding: 7px 10px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
                .contract { padding: 12px 0; border-bottom: 1px solid #edf0f1; }
                .error { color: #bd3328; }
                a { color: #1768a9; }
                code { overflow-wrap: anywhere; }
                @media (max-width: 760px) {
                    .grid, .grid-3, .gallery { grid-template-columns: 1fr; }
                    .topbar-inner { padding: 10px 14px; }
                    main { padding: 16px 13px 36px; }
                    .hero, .card { border-radius: 14px; padding: 18px; }
                    .value { max-width: 58%; }
                    .gallery img { min-height: 180px; }
                }
            </style>
        </head>
        <body>
            <header class="topbar">
                <nav class="topbar-inner">
                    <a class="brand" href="/">Dacia Data Collector</a>
                    <a class="nav-link" href="/">Przegląd</a>
                    <a class="nav-link" href="/vehicle">Dane auta</a>
                    <a class="nav-link" href="/vehicle/images">Galeria</a>
                    <a class="nav-link" href="/vehicle/equipment">Wyposażenie</a>
                    <a class="nav-link" href="/vehicle/services">Usługi</a>
                    <a class="nav-link" href="/debug">API</a>
                </nav>
            </header>
            <main>${content}</main>
        </body>
        </html>
    `;
}

function getVehicleDetailsFromSession(session) {
    return session?.vehicle?.vehicleDetails || {};
}

function getVehicleImages(details) {
    const assets = Array.isArray(details?.assets) ? details.assets : [];
    const images = [];

    for (const asset of assets) {
        const renditions = Array.isArray(asset?.renditions) ? asset.renditions : [];
        const large = renditions.find((item) => item?.resolutionType === 'ONE_MYRENAULT_LARGE');
        const small = renditions.find((item) => item?.resolutionType === 'ONE_MYRENAULT_SMALL');
        const url = large?.url || small?.url;

        if (url && !images.some((item) => item.url === url)) {
            images.push({
                viewpoint: asset.viewpoint || 'widok',
                url,
                smallUrl: small?.url || url,
                largeUrl: large?.url || url
            });
        }
    }

    return images;
}

function getPreferredVehicleImage(details) {
    const images = getVehicleImages(details);
    return (
        images.find((item) => item.viewpoint === 'myb_car_page_dashboard') ||
        images.find((item) => item.viewpoint === 'myb_car_selector') ||
        images[0] ||
        null
    );
}

function getVcdCodes(details) {
    return typeof details?.vcd === 'string'
        ? details.vcd.split('/').map((code) => code.trim()).filter(Boolean)
        : [];
}

// ============================================================================
// STRONA GŁÓWNA
// ============================================================================

app.get('/', async (req, res) => {
    try {
        const status = await getVehicleStatus();
        const { session, cockpit, location, pressure, contracts } = status;
        const details = getVehicleDetailsFromSession(session);
        const image = getPreferredVehicleImage(details);
        const mapLink = location.latitude !== null && location.longitude !== null
            ? `https://www.google.com/maps?q=${encodeURIComponent(location.latitude)},${encodeURIComponent(location.longitude)}`
            : null;

        const activeContracts = contracts.filter((contract) => contract.status === 'ACTIVE');

        res.status(200).send(pageTemplate(`
            <section class="hero">
                <div class="grid">
                    <div>
                        <div class="subtitle">${escapeHtml(details.brand?.label || 'DACIA')}</div>
                        <h1>${escapeHtml(details.model?.label || 'Twój samochód')}</h1>
                        <p class="muted">
                            ${escapeHtml(details.hybridation?.label || details.energy?.label || '')}
                            ${details.gearbox?.label ? ` · ${escapeHtml(details.gearbox.label)}` : ''}
                        </p>
                        <div>
                            <a class="button" href="/vehicle">Pełne dane auta</a>
                            <a class="button secondary" href="/vehicle/images">Zdjęcia</a>
                            ${mapLink ? `<a class="button light" target="_blank" rel="noopener noreferrer" href="${mapLink}">Mapa</a>` : ''}
                        </div>
                    </div>
                    <div>
                        ${image ? `<img class="car-image" src="${escapeHtml(image.largeUrl)}" alt="${escapeHtml(details.model?.label || 'Samochód')}">` : '<div class="info">Brak grafiki pojazdu.</div>'}
                    </div>
                </div>
            </section>

            <section class="grid-3">
                <div class="metric">
                    <div class="metric-label">Przebieg</div>
                    <div class="metric-value">${cockpit.mileage !== null ? `${formatNumber(cockpit.mileage, 0)} km` : 'Brak danych'}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Paliwo raportowane</div>
                    <div class="metric-value">${cockpit.fuelQuantity !== null ? `${formatNumber(cockpit.fuelQuantity)} l` : 'Brak danych'}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Zasięg raportowany</div>
                    <div class="metric-value">${cockpit.fuelAutonomy !== null ? `${formatNumber(cockpit.fuelAutonomy, 0)} km` : 'Brak danych'}</div>
                </div>
            </section>

            <section class="grid" style="margin-top:18px">
                <div class="card">
                    <h2>Status pojazdu</h2>
                    ${renderRow('Aktualizacja cockpit', escapeHtml(formatWarsawDate(cockpit.timestamp)))}
                    ${renderRow('Lokalizacja', mapLink ? `<a target="_blank" rel="noopener noreferrer" href="${mapLink}">Pokaż na mapie</a>` : 'Brak danych', location.timestamp ? formatWarsawDate(location.timestamp) : null)}
                    ${renderRow('Ciśnienie opon', pressure.available ? 'Dostępne' : `Niedostępne (HTTP ${escapeHtml(pressure.status ?? '—')})`)}
                    ${renderRow('Cockpit API', `v${cockpit.cockpitVersion}`)}
                </div>
                <div class="card">
                    <h2>Skrót konfiguracji</h2>
                    ${renderRow('Silnik', escapeHtml(details.engineType || 'Brak danych'))}
                    ${renderRow('Skrzynia', escapeHtml(details.gearbox?.label || 'Brak danych'))}
                    ${renderRow('Napęd', escapeHtml(details.hybridation?.label || details.energy?.label || 'Brak danych'))}
                    ${renderRow('Data produkcji', escapeHtml(details.manufacturingDate || 'Brak danych'))}
                    ${renderRow('Aktywne umowy', String(activeContracts.length))}
                </div>
            </section>

            <section class="card" style="margin-top:18px">
                <h2>Dodatkowe sekcje</h2>
                <a class="button secondary" href="/vehicle">Dane techniczne</a>
                <a class="button secondary" href="/vehicle/images">Galeria auta</a>
                <a class="button secondary" href="/vehicle/equipment">Kody wyposażenia</a>
                <a class="button secondary" href="/vehicle/services">Usługi i gwarancje</a>
                <a class="button light" href="/api/status">Status JSON</a>
                <a class="button light" href="/api/vehicle-details">Surowe dane pojazdu</a>
            </section>

            <div class="warning">
                Pole <strong>fuelQuantity</strong> nie wskazuje jednoznacznie, którego zbiornika dotyczy w aucie benzyna/LPG.
            </div>
        `, 'Dacia — przegląd'));
    } catch (error) {
        console.error(error);
        res.status(500).send(pageTemplate(`
            <section class="card">
                <h1 class="error">Błąd połączenia</h1>
                <p>${escapeHtml(error.message)}</p>
                <a class="button secondary" href="/">Spróbuj ponownie</a>
            </section>
        `, 'Błąd połączenia'));
    }
});

app.get('/vehicle', async (req, res) => {
    try {
        const session = await createSession();
        const details = getVehicleDetailsFromSession(session);
        const vehicle = session.vehicle || {};

        res.send(pageTemplate(`
            <section class="hero">
                <div class="subtitle">Dane przypisane do VIN-u</div>
                <h1>${escapeHtml(details.brand?.label || vehicle.brand || '')} ${escapeHtml(details.model?.label || '')}</h1>
                <p class="muted">Konfiguracja produkcyjna i dane techniczne zwracane przez Renault/Dacia.</p>
            </section>
            <section class="grid">
                <div class="card">
                    <h2>Napęd</h2>
                    ${renderRow('Kod silnika', escapeHtml(details.engineType || 'Brak danych'))}
                    ${renderRow('Dodatkowy typ silnika', escapeHtml(details.additionalEngineType?.label || details.additionalEngineType?.code || 'Brak danych'))}
                    ${renderRow('Energia', escapeHtml(details.energy?.label || 'Brak danych'))}
                    ${renderRow('Hybrydyzacja', escapeHtml(details.hybridation?.label || 'Brak danych'))}
                    ${renderRow('Skrzynia', escapeHtml(details.gearbox?.label || 'Brak danych'))}
                    ${renderRow('Akumulator', escapeHtml(details.battery?.label || 'Brak danych'))}
                </div>
                <div class="card">
                    <h2>Model i nadwozie</h2>
                    ${renderRow('Model', escapeHtml(details.model?.label || 'Brak danych'))}
                    ${renderRow('Kod modelu', escapeHtml(details.model?.code || 'Brak danych'))}
                    ${renderRow('Wersja', escapeHtml(details.version?.code || 'Brak danych'))}
                    ${renderRow('Rodzina', escapeHtml(details.family?.label || details.family?.code || 'Brak danych'))}
                    ${renderRow('Nadwozie', escapeHtml(details.bodyType?.label || 'Brak danych'))}
                    ${renderRow('Kierownica', escapeHtml(details.steeringSide?.label || 'Brak danych'))}
                </div>
                <div class="card">
                    <h2>Produkcja i własność</h2>
                    ${renderRow('Data produkcji', escapeHtml(details.manufacturingDate || 'Brak danych'))}
                    ${renderRow('Przekazanie do sprzedaży', escapeHtml(details.passToSalesDate || 'Brak danych'))}
                    ${renderRow('Data dostawy', escapeHtml(details.deliveryDate || 'Brak danych'))}
                    ${renderRow('Kraj dostawy', escapeHtml(details.deliveryCountry?.label || 'Brak danych'))}
                    ${renderRow('Początek własności', escapeHtml(vehicle.ownershipStartDate || 'Brak danych'))}
                    ${renderRow('Rola', escapeHtml(vehicle.connectedDriver?.role || 'Brak danych'))}
                </div>
                <div class="card">
                    <h2>Łączność i multimedia</h2>
                    ${renderRow('TCU', escapeHtml(details.tcu?.label || 'Brak danych'))}
                    ${renderRow('Radio', escapeHtml(details.radioType?.label || 'Brak danych'))}
                    ${renderRow('Technologia łączności', escapeHtml(details.connectivityTechnology || 'Brak danych'))}
                    ${renderRow('Easy Connect Store', details.easyConnectStore ? 'Tak' : 'Nie')}
                    ${renderRow('Premium', details.premiumSubscribed ? 'Aktywne' : 'Nieaktywne')}
                    ${renderRow('Lata obsługi', details.yearsOfMaintenance ?? 'Brak danych')}
                </div>
            </section>
        `, 'Dane techniczne auta'));
    } catch (error) {
        res.status(500).send(pageTemplate(`<section class="card"><h1 class="error">Błąd</h1><p>${escapeHtml(error.message)}</p></section>`));
    }
});

app.get('/vehicle/images', async (req, res) => {
    try {
        const session = await createSession();
        const details = getVehicleDetailsFromSession(session);
        const images = getVehicleImages(details);

        const gallery = images.length
            ? images.map((image) => `
                <figure>
                    <a href="${escapeHtml(image.largeUrl)}" target="_blank" rel="noopener noreferrer">
                        <img loading="lazy" src="${escapeHtml(image.smallUrl)}" alt="${escapeHtml(image.viewpoint)}">
                    </a>
                    <figcaption>${escapeHtml(image.viewpoint)} · <a target="_blank" rel="noopener noreferrer" href="${escapeHtml(image.largeUrl)}">duża wersja</a></figcaption>
                </figure>
            `).join('')
            : '<div class="info">Brak grafik pojazdu.</div>';

        res.send(pageTemplate(`
            <section class="hero"><h1>Galeria pojazdu</h1><p class="muted">Rendery 3D wygenerowane przez serwis Renault dla konfiguracji tego auta.</p></section>
            <section class="gallery">${gallery}</section>
        `, 'Galeria pojazdu'));
    } catch (error) {
        res.status(500).send(pageTemplate(`<section class="card"><h1 class="error">Błąd</h1><p>${escapeHtml(error.message)}</p></section>`));
    }
});

app.get('/vehicle/equipment', async (req, res) => {
    try {
        const session = await createSession();
        const details = getVehicleDetailsFromSession(session);
        const codes = getVcdCodes(details);

        res.send(pageTemplate(`
            <section class="hero">
                <h1>Kody wyposażenia</h1>
                <p class="muted">Fabryczny ciąg VCD zawiera ${codes.length} kodów konfiguracji. Nie wszystkie mają publicznie dostępne opisy.</p>
            </section>
            <section class="card">
                <h2>Najważniejsze rozpoznane parametry</h2>
                ${renderRow('Model', escapeHtml(details.model?.label || 'Brak danych'))}
                ${renderRow('Skrzynia', escapeHtml(details.gearbox?.label || 'Brak danych'))}
                ${renderRow('Radio', escapeHtml(details.radioType?.label || 'Brak danych'))}
                ${renderRow('TCU', escapeHtml(details.tcu?.label || 'Brak danych'))}
                ${renderRow('Hybrydyzacja', escapeHtml(details.hybridation?.label || 'Brak danych'))}
            </section>
            <section class="card" style="margin-top:18px">
                <h2>Pełna lista VCD</h2>
                <div class="chips">${codes.map((code) => `<span class="chip">${escapeHtml(code)}</span>`).join('')}</div>
            </section>
        `, 'Wyposażenie pojazdu'));
    } catch (error) {
        res.status(500).send(pageTemplate(`<section class="card"><h1 class="error">Błąd</h1><p>${escapeHtml(error.message)}</p></section>`));
    }
});

app.get('/vehicle/services', async (req, res) => {
    try {
        const session = await createSession();
        const contracts = await getContracts(session.accountId, session.jwtToken);
        const details = getVehicleDetailsFromSession(session);

        const contractsHtml = contracts.length
            ? contracts.map((contract) => `
                <div class="contract">
                    <strong>${escapeHtml(contract.description || contract.type || 'Umowa')}</strong>
                    <div class="muted">Status: ${escapeHtml(contract.status || 'brak')} ${contract.startDate ? `· od ${escapeHtml(contract.startDate)}` : ''} ${contract.endDate ? `· do ${escapeHtml(contract.endDate)}` : ''}</div>
                </div>
            `).join('')
            : '<div class="info">Brak umów zwróconych przez API.</div>';

        res.send(pageTemplate(`
            <section class="hero"><h1>Usługi, gwarancje i serwis</h1><p class="muted">Dane kontraktów oraz dostępne pola serwisowe.</p></section>
            <section class="grid">
                <div class="card">
                    <h2>Informacje serwisowe</h2>
                    ${renderRow('Lata obsługi', details.yearsOfMaintenance ?? 'Brak danych')}
                    ${renderRow('Cyfrowa książka serwisowa', escapeHtml(session.vehicle?.digitalMaintenanceBookletGenerationDate || 'Brak danych'))}
                    ${renderRow('Akcje przywoławcze', details.recallNotifications ? 'Dostępne' : 'Brak danych')}
                    ${renderRow('Preferowany dealer', escapeHtml(details.preferredDealer?.name || 'Brak danych'))}
                </div>
                <div class="card"><h2>Umowy i gwarancje</h2>${contractsHtml}</div>
            </section>
        `, 'Usługi i gwarancje'));
    } catch (error) {
        res.status(500).send(pageTemplate(`<section class="card"><h1 class="error">Błąd</h1><p>${escapeHtml(error.message)}</p></section>`));
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
                `http://localhost:${PORT}/api/pressure`,

            vehicleDetails:
                `http://localhost:${PORT}/api/vehicle-details`
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
            '/api/vehicle-details',
            '/api/test/extra',
            '/api/alerts',
            '/api/lock-status',
            '/api/hvac-status',
            '/vehicle',
            '/vehicle/images',
            '/vehicle/equipment',
            '/vehicle/services',
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