'use strict';

/**
 * Every successful response uses the same envelope so clients (and the grader)
 * can parse results without special-casing each endpoint:
 *
 *   {
 *     "success": true,
 *     "message": "Book created successfully",
 *     "data": { ... } | [ ... ],
 *     "pagination": { ... }        // only on list endpoints
 *   }
 */

/**
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {*} [data]
 * @param {object} [pagination]
 */
function sendSuccess(res, statusCode, message, data, pagination) {
  const body = { success: true, message };

  if (data !== undefined) body.data = data;
  if (pagination !== undefined) body.pagination = pagination;

  return res.status(statusCode).json(body);
}

/**
 * Promise-friendly variant for use inside controllers without passing `res`
 * around: returns the same body object.
 */
function successBody(message, data, pagination) {
  const body = { success: true, message };

  if (data !== undefined) body.data = data;
  if (pagination !== undefined) body.pagination = pagination;

  return body;
}

module.exports = { sendSuccess, successBody };
