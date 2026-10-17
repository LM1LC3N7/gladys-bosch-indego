// -----------------------------------------------------------------------------
// Every SDK handler, registered on a GladysIntegration and delegated to the
// IndegoApp. Shared by index.js and the tests (which register them on the
// SDK's fake Gladys). Register BEFORE connect().
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger = app.logger) {
  // --- Discovery and commands ----------------------------------------------------
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated(() => app.deviceCreated());
  gladys.onDeviceUpdated(() => app.deviceCreated());
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // --- The Bosch account: Connect button or start action, then the pasted address
  gladys.onOAuthAuthorizeUrl((key) => app.authorizeUrl(key));
  gladys.onAction(ACTIONS.START, () => app.startSignIn());
  gladys.onAction(ACTIONS.FINISH, (fields) => app.finishSignIn(fields));

  // --- Configuration screen button ----------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // --- Configuration changed by the user (interval, long poll, language) ---------
  gladys.onConfigUpdated((config) => {
    logger.info('Configuration updated: restarting');
    return app.start(config);
  });

  // --- Connection lifecycle ------------------------------------------------------
  gladys.on('connected', async () => {
    try {
      await app.start(await gladys.getConfig());
    } catch (err) {
      logger.error(`Start failed: ${err.message}`);
    }
  });
  gladys.on('disconnected', () => app.stop());
  gladys.handleShutdown(() => app.shutdown());
}
