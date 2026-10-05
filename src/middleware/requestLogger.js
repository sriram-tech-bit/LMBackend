'use strict';

const crypto = require('node:crypto');
const logger = require('../utils/logger');
const config = require('../config/env');

/**
 * Request logging middleware (requirement c).
 *
 * Two responsibilities:
 *  1. Attach a correlation id (`X-Request-Id`) to every request — echoed back in
 *     the response headers, prefixed onto every log line, and used to correlate
 *     the "incoming" and "completed" entries for one call.
 *  2. Emit a single completion line with method, path, status, duration and the
 *     size of the response body (the morgan-style `combined` essentials).
 */

/** Endpoints whose bodies must never be echoed into logs. */
const REDACTED_PATHS = new Set(['/api/auth/login', '/api/auth/register', '/api/auth/password']);

const SECURITY_HEADER = 'x-request-id';

function attachRequestId(req, res, next) {
  const incoming = req.get(SECURITY_HEADER);
  const requestId =
    incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  logger.debug(`--> ${req.method} ${req.originalUrl}`, {
    requestId: req.id,
    ip: clientIp(req),
  });

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const meta = {
      requestId: req.id,
      status: res.statusCode,
      duration: `${durationMs.toFixed(1)}ms`,
      bytes: res.getHeader('content-length') || 0,
      ip: clientIp(req),
    };

    const message = `${req.method} ${req.originalUrl}`;
    const isServerError = res.statusCode >= 500;
    const isClientError = res.statusCode >= 400;

    if (isServerError) {
      logger.error(message, meta);
    } else if (isClientError) {
      logger.warn(message, meta);
    } else {
      logger.http(message, meta);
    }
  });

  next();
}

/**
 * Log the payload of a mutating request at debug level, with anything
 * secret-looking removed. Never runs in production.
 */
function logRequestBody(req, _res, next) {
  if (config.isProduction) return next();
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  if (REDACTED_PATHS.has(req.path)) {
    logger.debug(`(body redacted for ${req.path})`, { requestId: req.id });
    return next();
  }
  if (req.body && Object.keys(req.body).length > 0) {
    logger.debug('request body', { requestId: req.id, body: req.body });
  }
  return next();
}

/** Best-effort client address, honouring a single trusted proxy hop. */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = { attachRequestId, requestLogger, logRequestBody };
