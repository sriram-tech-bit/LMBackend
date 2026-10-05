'use strict';

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const { HTTP } = require('../config/constants');

/**
 * Transport- and abuse-level protections, kept out of app.js so the wiring there
 * stays readable.
 */

/** Sensible security headers; CSP is relaxed because this is a JSON API. */
const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/** Shared limiter options. */
function buildLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Never interfere with automated tests.
    skip: () => config.isTest,
    handler: (_req, _res, next) => {
      next(
        new ApiError(HTTP.TOO_MANY_REQUESTS, message, { code: 'RATE_LIMITED' })
      );
    },
  });
}

/** Broad limiter for the whole /api surface. */
const apiLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300,
  message: 'Too many requests from this IP. Please try again in a few minutes.',
});

/** Tight limiter for credential endpoints (brute-force protection). */
const authLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  message: 'Too many login attempts from this IP. Please try again in 15 minutes.',
});

/**
 * Reject MongoDB operator keys (`$gt`, `$ne`, `$where`, ...) and dotted keys
 * anywhere in the request body/query/params.
 *
 * Zod already strips unknown keys, but this runs first and covers nested
 * objects the schemas do not know about — classic NoSQL-injection defence
 * (`{"email": {"$gt": ""}}`).
 */
function rejectMongoOperators(req, _res, next) {
  const offending = findOperatorKey(req.body) ?? findOperatorKey(req.query) ?? findOperatorKey(req.params);

  if (offending) {
    return next(
      ApiError.badRequest(`Illegal key "${offending}" in request`, {
        code: 'ILLEGAL_REQUEST_KEY',
      })
    );
  }

  return next();
}

/** Depth-first search for a key starting with `$` or containing a dot. */
function findOperatorKey(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOperatorKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) return key;
    const found = findOperatorKey(value[key], depth + 1);
    if (found) return found;
  }

  return null;
}

module.exports = { securityHeaders, apiLimiter, authLimiter, rejectMongoOperators };
