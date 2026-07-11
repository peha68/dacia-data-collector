const fs = require('fs/promises');
const path = require('path');
const {
    CONFIG_PATH,
    validateRenaultConfig,
    mask
} = require('../lib/renault-config');

const SOURCE_URL =
    'https://raw.githubusercontent.com/hacf-fr/renault-api/main/src/renault_api/const.py';

async function fetchSource() {
    const response = await fetch(SOURCE_URL, {
        headers: {
            Accept: 'text/plain',
            'User-Agent': 'dacia-data-collector/1.1'
        },
        signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
        throw new Error(`GitHub zwrócił HTTP ${response.status}.`);
    }

    return response.text();
}

function extract(source, variableName) {
    const escapedName = variableName.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    );

    const expression = new RegExp(
        `^${escapedName}\\s*=\\s*["']([^"']+)["']`,
        'm'
    );

    const match = source.match(expression);

    if (!match?.[1]) {
        throw new Error(`Nie znaleziono ${variableName} w pliku źródłowym.`);
    }

    return match[1];
}

async function main() {
    console.log('Pobieram aktualną konfigurację Renault/Dacia...');
    console.log(`Źródło: ${SOURCE_URL}`);

    const source = await fetchSource();

    const config = {
        source: 'https://github.com/hacf-fr/renault-api',
        sourceFile: SOURCE_URL,
        region: 'EU',
        gigyaApiKey: extract(source, 'GIGYA_KEY_EU'),
        kamereonApiKey: extract(source, 'KAMEREON_APIKEY'),
        gigyaTarget: extract(source, 'GIGYA_URL_EU'),
        kamereonTarget: extract(source, 'KAMEREON_URL_EU'),
        updatedAt: new Date().toISOString()
    };

    validateRenaultConfig(config);

    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(
        CONFIG_PATH,
        `${JSON.stringify(config, null, 2)}\n`,
        'utf8'
    );

    console.log('Konfiguracja została zapisana.');
    console.log(`Gigya:    ${mask(config.gigyaApiKey)}`);
    console.log(`Kamereon: ${mask(config.kamereonApiKey)}`);
    console.log(`Plik:     ${CONFIG_PATH}`);
}

main().catch((error) => {
    console.error(`Błąd aktualizacji konfiguracji: ${error.message}`);
    process.exitCode = 1;
});
