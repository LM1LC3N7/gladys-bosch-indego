// -----------------------------------------------------------------------------
// Entry point: SDK bootstrap only. The handlers (src/handlers.js) are
// registered BEFORE connect(), and delegate to the IndegoApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { IndegoApp } from './src/app.js';
import { registerHandlers } from './src/handlers.js';

const gladys = new GladysIntegration();
const app = new IndegoApp({ gladys });
registerHandlers(gladys, app, logger);

logger.info('Starting the Bosch Indego integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
