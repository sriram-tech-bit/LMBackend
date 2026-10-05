'use strict';

/**
 * MongoDB connection lifecycle.
 *
 * Atlas has TLS and retryable writes switched on by default, and the driver
 * handles both, so we only override what genuinely needs tuning here.
 */

const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');
const { prepareDnsFor } = require('./dns');

/** Hide credentials before a URI ever reaches a log line. */
function maskUri(uri) {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:****@');
}

mongoose.set('strictQuery', true);
// Fail fast with a Mongoose ValidationError instead of creating collections
// implicitly for fields that were never declared in a schema.
mongoose.set('autoIndex', !config.isProduction);

let isConnected = false;

/**
 * Connect to MongoDB. Resolves with the mongoose instance once the initial
 * handshake succeeds; rejects (after the server-selection timeout) otherwise.
 */
async function connectDatabase(uri = config.mongo.uri) {
  if (isConnected) return mongoose;

  // `mongodb+srv://` cannot be used until the SRV record resolves; this also
  // copes with machines whose stub resolver c-ares cannot query (see dns.js).
  await prepareDnsFor(uri, { autoFallback: config.mongo.dnsAutoFallback });

  mongoose.connection.on('connected', () => {
    isConnected = true;
    logger.info(`MongoDB connected -> ${maskUri(uri)}`);
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB disconnected');
  });

  mongoose.connection.on('error', (error) => {
    logger.error('MongoDB connection error', { message: error.message });
  });

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMs,
      // Keep the pool modest — this API is I/O bound, not CPU bound.
      maxPoolSize: 10,
      minPoolSize: 0,
    });
  } catch (error) {
    throw annotateConnectionError(error, uri);
  }

  return mongoose;
}

/**
 * The driver's generic "could not connect to any servers" message hides the
 * real reason. Surface the underlying TCP/TLS error and, when it looks like a
 * firewall or access-list block, say so plainly — that is by far the most
 * common cause and it is fixable in seconds.
 */
function annotateConnectionError(error, uri) {
  const isSelectionError =
    error?.name === 'MongooseServerSelectionError' ||
    error?.name === 'MongoServerSelectionError';

  if (!isSelectionError) return error;

  const reasons = [];

  if (error.reason && typeof error.reason.servers?.forEach === 'function') {
    error.reason.servers.forEach((description, address) => {
      const detail = description?.error?.message;
      if (detail) reasons.push(`${address}: ${detail}`);
    });
  }

  const joined = reasons.join(' | ');
  const looksBlocked =
    /tlsv1 alert|SSL alert number|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(joined) ||
    reasons.length === 0;

  const hint = looksBlocked
    ? 'The network reached the cluster but the connection was refused. Two usual causes: ' +
      '(1) this machine\'s public IP is not in the cluster access list — add it in Atlas > ' +
      'Network Access (or allow 0.0.0.0/0 for development); (2) an outbound firewall is ' +
      'blocking TCP 27017.'
    : 'Check the connection string, the database user\'s credentials and whether the ' +
      'database user has access to this database.';

  error.message = `${error.message}\n[hint] ${hint}${
    joined ? `\n[driver] ${joined}` : ''
  }\n[uri] ${maskUri(uri)}`;

  return error;
}

/** Close the connection (used by graceful shutdown and by the test suite). */
async function disconnectDatabase() {
  if (!isConnected) return;
  await mongoose.connection.close();
  isConnected = false;
  logger.info('MongoDB connection closed');
}

/** Wait until the driver reports a live, usable connection. */
function waitForConnection(timeoutMs = config.mongo.serverSelectionTimeoutMs) {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for MongoDB connection'));
    }, timeoutMs);

    function onConnected() {
      cleanup();
      resolve(mongoose);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function cleanup() {
      clearTimeout(timer);
      mongoose.connection.off('connected', onConnected);
      mongoose.connection.off('error', onError);
    }

    mongoose.connection.once('connected', onConnected);
    mongoose.connection.once('error', onError);
  });
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  waitForConnection,
  maskUri,
  get mongoose() {
    return mongoose;
  },
};
