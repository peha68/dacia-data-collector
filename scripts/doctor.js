const path = require('path');

require('dotenv').config({
    path: path.resolve(__dirname, '..', '.env'),
    override: false
});

const {
    loadRenaultConfig,
    mask
} = require('../lib/renault-config');

function result(ok, message) {
    console.log(`${ok ? '✓' : '✗'} ${message}`);
}

async function checkUrl(name, url) {
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'manual',
            signal: AbortSignal.timeout(10_000)
        });

        const reachable = response.status > 0 && response.status < 500;
        result(reachable, `${name}: HTTP ${response.status}`);
        return reachable;
    } catch (error) {
        result(false, `${name}: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('Dacia Data Collector — diagnostyka\n');

    const required = ['DACIA_EMAIL', 'DACIA_PASSWORD', 'CAR_VIN'];
    let ok = true;

    for (const variable of required) {
        const present = Boolean(process.env[variable]);
        result(present, `${variable} ${present ? 'ustawione' : 'brak'}`);
        ok = ok && present;
    }

    const config = loadRenaultConfig();
    result(true, `Konfiguracja klienta: ${config.source}`);
    result(true, `Gigya key: ${mask(config.gigyaApiKey)}`);
    result(true, `Kamereon key: ${mask(config.kamereonApiKey)}`);

    const gigyaReachable = await checkUrl(
        'Gigya endpoint',
        config.gigyaTarget
    );

    const kamereonReachable = await checkUrl(
        'Kamereon endpoint',
        config.kamereonTarget
    );

    ok = ok && gigyaReachable && kamereonReachable;

    console.log('');
    if (ok) {
        console.log('Podstawowa konfiguracja wygląda poprawnie.');
        console.log('Pełny test konta: uruchom serwer i wywołaj /api/status.');
    } else {
        console.log('Wykryto problemy konfiguracyjne.');
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(`Diagnostyka nie powiodła się: ${error.message}`);
    process.exitCode = 1;
});
