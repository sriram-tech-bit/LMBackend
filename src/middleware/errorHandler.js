'use strict';

const mongoose = require('mongoose');
const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const config = require('../config/env');
const { HTTP, MONGO_DUPLICATE_KEY_CODE } = require('../config/constants');

/**
 * Centralised error handling (requirement c).
 *
 * One place decides the status code, the machine-readable `code` and the JSON
 * shape, so controllers only ever `throw` / `next(err)`. Every failure —
 * our own ApiError, a Mongoose validation error, a duplicate key, a bad JSON
 * body, a dropped database connection — is normalised into:
 *
 *   {
 *     "success": false,
 *     "message": "ISBN already exists",
 *     "code": "DUPLICATE_KEY",
 *     "details": [ ... ]          // when we have per-field information
 *     "requestId": "..."
 *   }
 */

/** 404 for any route that reached the end of the stack unmatched. */
function notFoundHandler(req, _res, next) {
  next(
    ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`, {
      code: 'ROUTE_NOT_FOUND',
    })
  );
}

/**
 * Translate a thrown value into `{ statusCode, message, code, details }`.
 * @param {any} error
 */
function normaliseError(error) {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      code: error.code,
      details: error.details,
    };
  }

  // --- Zod (thrown by code that parses without the validate middleware) -----
  if (error instanceof ZodError) {
    return {
      statusCode: HTTP.UNPROCESSABLE_ENTITY,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
        code: issue.code,
      })),
    };
  }

  // --- Mongoose: schema validation -----------------------------------------
  if (error instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: HTTP.UNPROCESSABLE_ENTITY,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: Object.values(error.errors).map((fieldError) => ({
        field: fieldError.path,
        message: fieldError.message,
        code: fieldError.kind || 'invalid',
      })),
    };
  }

  // --- Mongoose: bad ObjectId / wrong type ---------------------------------
  if (error instanceof mongoose.Error.CastError) {
    return {
      statusCode: HTTP.BAD_REQUEST,
      message: `Invalid value for "${error.path}": ${error.value}`,
      code: 'INVALID_ID',
      details: [{ field: error.path, message: `"${error.value}" is not a valid ${error.kind}`, code: 'cast_error' }],
    };
  }

  // --- Mongoose: duplicate key (unique index) ------------------------------
  if (error && error.code === MONGO_DUPLICATE_KEY_CODE) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || 'field';
    return {
      statusCode: HTTP.CONFLICT,
      message: `A record with this ${field} already exists`,
      code: 'DUPLICATE_KEY',
      details: [{ field, message: `"${(error.keyValue || {})[field] ?? ''}" is already taken`, code: 'duplicate' }],
    };
  }

  // --- Database reachable? -------------------------------------------------
  if (
    error instanceof mongoose.Error.MongooseServerSelectionError ||
    error.name === 'MongoServerSelectionError' ||
    error.name === 'MongoNetworkError' ||
    error.name === 'MongoTimeoutError'
  ) {
    return {
      statusCode: HTTP.SERVICE_UNAVAILABLE,
      message: 'The database is currently unreachable. Please retry shortly.',
      code: 'DATABASE_UNAVAILABLE',
    };
  }

  // --- Body parser: malformed JSON / oversized payload ---------------------
  if (error instanceof SyntaxError && 'body' in error) {
    return {
      statusCode: HTTP.BAD_REQUEST,
      message: 'Request body is not valid JSON',
      code: 'INVALID_JSON',
    };
  }

  if (error && error.type === 'entity.too.large') {
    return {
      statusCode: HTTP.PAYLOAD_TOO_LARGE,
      message: 'Request body is too large',
      code: 'PAYLOAD_TOO_LARGE',
    };
  }

  // --- Anything else is a bug: do not leak internals -----------------------
  return {
    statusCode: HTTP.INTERNAL_SERVER_ERROR,
    message: 'Something went wrong on our side',
    code: 'INTERNAL_SERVER_ERROR',
  };
}

/**
 * Terminal error middleware. Must be registered LAST, after all routes.
 * @type {import('express').ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  const { statusCode, message, code, details } = normaliseError(error);

  const logMeta = {
    requestId: req.id,
    status: statusCode,
    code,
    method: req.method,
    path: req.originalUrl,
  };

  if (statusCode >= HTTP.INTERNAL_SERVER_ERROR) {
    // Unexpected: log the full stack so it is debuggable.
    logger.error(message, { ...logMeta, error: error.message, stack: error.stack });
  } else {
    logger.warn(message, logMeta);
  }

  const body = { success: false, message, code };
  if (details) body.details = details;
  if (req.id) body.requestId = req.id;
  // Expose the stack only in development; it is genuinely useful while marking.
  if (!config.isProduction && statusCode >= HTTP.INTERNAL_SERVER_ERROR) {
    body.stack = error.stack;
  }

  // A response may already have started streaming — hand back to Express.
  if (res.headersSent) {
    return next(error);
  }

  return res.status(statusCode).json(body);
}

module.exports = { errorHandler, notFoundHandler, normaliseError };
