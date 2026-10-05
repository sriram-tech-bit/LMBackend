'use strict';

/**
 * Environment loading & validation.
 *
 * MUST be required before anything else that reads `process.env` — constants.js
 * requires it at the top. Loads `.env` from the project root, then validates the
 * values the app cannot run without, failing fast with an actionable message
 * instead of throwing something confusing deep inside Mongoose.
 */

const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ENV_FILE = path.join(PROJECT_ROOT, '.env');

if (fs.existsSync(ENV_FILE)) {
  dotenv.config({ path: ENV_FILE });
} else {
  // Not fatal: the process may be configured purely through real environment
  // variables (Docker, CI, hosting dashboards). Warn so the developer notices.
  // eslint-disable-next-line no-console
  console.warn(
    `[config] No .env file found at ${ENV_FILE}. Falling back to process environment variables.`
  );
}

/** Read a required string; throw a descriptive error when it is missing. */
function requiredString(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `[config] Missing required environment variable "${name}". ` +
        'Copy .env.example to .env and set it (see README > Configuration).'
    );
  }
  return value.trim();
}

/** Read an optional string with a fallback. */
function optionalString(name, fallback) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/** Read a boolean-ish flag ("true"/"1"/"yes"/"on" are truthy). */
function optionalBoolean(name, fallback) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** Read a positive integer with a fallback. */
function optionalInteger(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const nodeEnv = optionalString('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

const jwtSecret = requiredString('JWT_SECRET');

// A short secret silently weakens every issued token — refuse it in production.
if (isProduction && jwtSecret.length < 32) {
  throw new Error(
    '[config] JWT_SECRET must be at least 32 characters long when NODE_ENV=production.'
  );
}

const config = Object.freeze({
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: optionalInteger('PORT', 3000),

  mongo: Object.freeze({
    uri: requiredString('MONGODB_URI'),
    /** Multi-document transactions require a replica set / Atlas cluster. */
    transactionsEnabled: optionalBoolean('MONGODB_TRANSACTIONS', false),
    serverSelectionTimeoutMs: optionalInteger('MONGO_SERVER_SELECTION_TIMEOUT_MS', 10000),
    /** Explicit resolvers for `mongodb+srv://` SRV lookups (see config/dns.js). */
    dnsServers: optionalString('DNS_SERVERS', ''),
    /** Retry an SRV lookup with public DNS when the system resolver cannot. */
    dnsAutoFallback: optionalBoolean('DNS_AUTO_FALLBACK', true),
  }),

  jwt: Object.freeze({
    secret: jwtSecret,
    expiresIn: optionalString('JWT_EXPIRES_IN', '1d'),
    issuer: optionalString('JWT_ISSUER', 'library-management-api'),
  }),

  loan: Object.freeze({
    defaultDays: optionalInteger('DEFAULT_LOAN_DAYS', 14),
  }),

  pagination: Object.freeze({
    defaultLimit: optionalInteger('DEFAULT_PAGE_SIZE', 10),
    maxLimit: optionalInteger('MAX_PAGE_SIZE', 100),
  }),

  cors: Object.freeze({
    origin: optionalString('CORS_ORIGIN', '*'),
  }),

  seed: Object.freeze({
    librarianName: optionalString('SEED_LIBRARIAN_NAME', 'Head Librarian'),
    librarianEmail: optionalString('SEED_LIBRARIAN_EMAIL', 'librarian@library.test'),
    librarianPassword: optionalString('SEED_LIBRARIAN_PASSWORD', 'Librarian@123'),
  }),

  paths: Object.freeze({ projectRoot: PROJECT_ROOT }),
});

module.exports = config;
