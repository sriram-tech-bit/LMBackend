'use strict';

const { HTTP } = require('../config/constants');

/**
 * Operational error — an error we *expect* and can describe to the client
 * ("Book not found", "ISBN already exists"). Anything that is not an ApiError
 * is treated as a programmer error and reported as a generic 500.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status to return
   * @param {string} message    Human readable, client-safe message
   * @param {object} [options]
   * @param {string} [options.code]     Stable machine-readable code, e.g. BOOK_NOT_FOUND
   * @param {Array}  [options.details]  Per-field validation details
   */
  constructor(statusCode, message, options = {}) {
    super(message);

    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = options.code || ApiError.defaultCodeFor(statusCode);
    if (options.details) this.details = options.details;

    Error.captureStackTrace(this, this.constructor);
  }

  static defaultCodeFor(statusCode) {
    switch (statusCode) {
      case HTTP.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HTTP.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HTTP.FORBIDDEN:
        return 'FORBIDDEN';
      case HTTP.NOT_FOUND:
        return 'NOT_FOUND';
      case HTTP.CONFLICT:
        return 'CONFLICT';
      case HTTP.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HTTP.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL_SERVER_ERROR';
    }
  }

  static badRequest(message, options) {
    return new ApiError(HTTP.BAD_REQUEST, message, options);
  }

  static unauthorized(message = 'Authentication required', options) {
    return new ApiError(HTTP.UNAUTHORIZED, message, options);
  }

  static forbidden(message = 'You do not have permission to perform this action', options) {
    return new ApiError(HTTP.FORBIDDEN, message, options);
  }

  static notFound(message = 'Resource not found', options) {
    return new ApiError(HTTP.NOT_FOUND, message, options);
  }

  static conflict(message, options) {
    return new ApiError(HTTP.CONFLICT, message, options);
  }

  static unprocessable(message, options) {
    return new ApiError(HTTP.UNPROCESSABLE_ENTITY, message, options);
  }

  static internal(message = 'Something went wrong', options) {
    return new ApiError(HTTP.INTERNAL_SERVER_ERROR, message, options);
  }
}

module.exports = ApiError;
