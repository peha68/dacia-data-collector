const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(
    __dirname,
    '..',
    'config',
    'renault-client.json'
);

function readBundledConfig() {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(
            `Nie udało się odczytać ${CONFIG_PATH}: ${error.message}`
        );
    }
}

function loadRenaultConfig(env = process.env) {
    const bundled = readBundledConfig();

    const config = {
        gigyaApiKey:
            env.GIGYA_API_KEY || bundled.gigyaApiKey,

        kamereonApiKey:
            env.KAMEREON_API_KEY || bundled.kamereonApiKey,

        gigyaTarget:
            env.GIGYA_TARGET || bundled.gigyaTarget,

        kamereonTarget:
            env.KAMEREON_TARGET || bundled.kamereonTarget,

        source:
            env.GIGYA_API_KEY || env.KAMEREON_API_KEY
                ? 'environment'
                : 'bundled-config',

        updatedAt:
            bundled.updatedAt || null
    };

    validateRenaultConfig(config);
    return config;
}

function validateRenaultConfig(config) {
    const missing = [];

    for (const key of [
        'gigyaApiKey',
        'kamereonApiKey',
        'gigyaTarget',
        'kamereonTarget'
    ]) {
        if (!config[key]) {
            missing.push(key);
        }
    }

    if (missing.length) {
        throw new Error(
            `Brakuje konfiguracji Renault/Dacia: ${missing.join(', ')}`
        );
    }

    if (!config.gigyaApiKey.startsWith('3_')) {
        throw new Error('Nieoczekiwany format klucza Gigya.');
    }

    for (const field of ['gigyaTarget', 'kamereonTarget']) {
        let url;
        try {
            url = new URL(config[field]);
        } catch {
            throw new Error(`Nieprawidłowy adres ${field}.`);
        }

        if (url.protocol !== 'https:') {
            throw new Error(`${field} musi używać HTTPS.`);
        }
    }
}

function mask(value) {
    if (!value || value.length < 12) {
        return value;
    }

    return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

module.exports = {
    CONFIG_PATH,
    loadRenaultConfig,
    validateRenaultConfig,
    mask
};
