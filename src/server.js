'use strict';

/**
 * Process entry point.
 *
 *  1. Loads & validates configuration (config/env throws if anything required
 *     is missing, before we touch the network).
 *  2. Connects to MongoDB.
 *  3. Starts the HTTP server.
 *  4. Schedules the overdue sweep and installs graceful-shutdown handlers.
 *
 * The app itself lives in app.js so tests can import it without a port.
 */

const config = require('./config/env');
const logger = require('./utils/logger');
const { connectDatabase, disconnectDatabase, maskUri } = require('./config/db');
const { refreshOverdue } = require('./services/borrowQueryService');
const createApp = require('./app');

/** How often the overdue sweep runs (10 minutes). */
const OVERDUE_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

let server = null;
let sweepTimer = null;

async function start() {
  logger.info('Starting Library Management API', {
    env: config.nodeEnv,
    port: config.port,
    node: process.version,
  });

  await connectDatabase();
  logger.info('MongoDB target', { uri: maskUri(config.mongo.uri) });

  const app = createApp();

  server = app.listen(config.port, () => {
    logger.info(`HTTP server listening on http://localhost:${config.port}`, {
      health: `http://localhost:${config.port}/health`,
    });
  });

  startOverdueSweep();
  installShutdownHandlers();

  return server;
}

/**
 * Periodically move issued-and-past-due records into `overdue` so the status
 * column stays truthful without every read having to recompute it.
 */
function startOverdueSweep() {
  const sweep = async () => {
    try {
      const result = await refreshOverdue();
      if (result.modified > 0) {
        logger.info('Marked borrow records as overdue', { modified: result.modified });
      }
    } catch (error) {
      // Never let a failed sweep take the process down.
      logger.error('Overdue sweep failed', { message: error.message });
    }
  };

  sweepTimer = setInterval(sweep, OVERDUE_SWEEP_INTERVAL_MS);
  sweepTimer.unref(); // do not hold the event loop open
}

/** Close the HTTP server, stop timers and disconnect cleanly. */
async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully`);

  if (sweepTimer) clearInterval(sweepTimer);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      logger.info('HTTP server closed');
    }

    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { message: error.message });
    process.exit(1);
  }
}

function installShutdownHandlers() {
  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
      void shutdown(signal);
    });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      message: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — exiting', { message: error.message, stack: error.stack });
    void shutdown('uncaughtException');
  });
}

// Only boot when run directly (`node src/server.js`), not when imported.
if (require.main === module) {
  start().catch((error) => {
    logger.error('Failed to start the server', { message: error.message });
    if (!config.isProduction) {
      logger.error('Startup stack trace', { stack: error.stack });
    }
    process.exit(1);
  });
}

module.exports = { start, shutdown };
