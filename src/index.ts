import 'dotenv/config';
import { loadConfig, ConfigValidationError } from './config/config';

function main(): void {
    let config;
    try {
        config = loadConfig();
    } catch (err) {
        if (err instanceof ConfigValidationError) {
            // eslint-disable-next-line no-console
            console.error(err.message);
            process.exit(1);
        }
        throw err;
    }

    // eslint-disable-next-line no-console
    console.log(`Configuration loaded successfully. Environment: ${config.nodeEnv}, Port: ${config.port}`);

    // Phase 3+ will construct concrete implementations and call createApp(deps).
}

main();