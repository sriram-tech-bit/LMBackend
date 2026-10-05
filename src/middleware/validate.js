'use strict';

const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');
const { HTTP } = require('../config/constants');

/**
 * Input validation middleware (requirement c).
 *
 * Usage:
 *   router.post('/books', validate({ body: createBookSchema }), controller.add);
 *   router.get('/',       validate({ query: listBooksQuerySchema }), controller.list);
 *
 * Behaviour
 *  - Parses the requested request parts against their Zod schema.
 *  - Replaces `req.body` / `req.query` / `req.params` with the *parsed* values,
 *    so controllers only ever see coerced, whitelisted data (numbers are
 *    numbers, unknown keys are gone).
 *  - Collects issues from every part at once and returns them together as a
 *    422 with a per-field `details` array — far easier to debug than a single
 *    opaque message.
 */

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 * @returns {import('express').RequestHandler}
 */
function validate(schemas = {}) {
  const parts = ['params', 'query', 'body'].filter((part) => schemas[part]);

  return function validateRequest(req, _res, next) {
    const details = [];

    for (const part of parts) {
      const source = req[part] === undefined || req[part] === null ? {} : req[part];

      try {
        assignRequestPart(req, part, schemas[part].parse(source));
      } catch (error) {
        if (error instanceof ZodError) {
          details.push(...formatZodIssues(error, part));
          continue;
        }
        return next(error);
      }
    }

    if (details.length > 0) {
      return next(
        new ApiError(HTTP.UNPROCESSABLE_ENTITY, 'Validation failed', {
          code: 'VALIDATION_ERROR',
          details,
        })
      );
    }

    return next();
  };
}

/**
 * Turn Zod issues into a flat, client-friendly list.
 *
 *   [{ field: 'body.totalCopies', message: 'Expected number, received string', code: 'invalid_type' }]
 */
function formatZodIssues(error, part) {
  return error.issues.map((issue) => ({
    field: [part, ...issue.path].join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Assign a parsed part back onto the request.
 *
 * In Express 5 `req.query` is a getter with no setter, so a plain assignment
 * throws in strict mode. Defining an own property works on both Express 4 and 5.
 */
function assignRequestPart(req, part, value) {
  try {
    req[part] = value;
  } catch {
    Object.defineProperty(req, part, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

module.exports = validate;
module.exports.formatZodIssues = formatZodIssues;
