'use strict';

const ApiError = require('./ApiError');
const { PAGINATION } = require('../config/constants');

/**
 * Parse and clamp `?page=` / `?limit=` query values.
 *
 * Accepts strings (as Express always gives us) or numbers, rejects nonsense with
 * a 400 rather than silently returning an empty page, and caps `limit` so a
 * client cannot ask for the whole collection in one request.
 *
 * @param {{page?: string|number, limit?: string|number}} query
 * @returns {{page: number, limit: number, skip: number}}
 */
function parsePagination(query = {}) {
  const page = toPositiveInteger(query.page, PAGINATION.DEFAULT_PAGE, 'page');
  const limit = toPositiveInteger(query.limit, PAGINATION.DEFAULT_LIMIT, 'limit');

  if (limit > PAGINATION.MAX_LIMIT) {
    throw ApiError.badRequest(
      `"limit" must not be greater than ${PAGINATION.MAX_LIMIT}`,
      { code: 'INVALID_PAGINATION' }
    );
  }

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Build the metadata block that accompanies every paginated response.
 *
 * @param {number} total  Total matching documents
 * @param {number} page   1-based page number
 * @param {number} limit  Page size
 */
function buildPaginationMeta(total, page, limit) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/** Coerce to a strictly positive integer or fall back / throw. */
function toPositiveInteger(raw, fallback, fieldName) {
  if (raw === undefined || raw === null || raw === '') return fallback;

  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw ApiError.badRequest(`"${fieldName}" must be a positive integer`, {
      code: 'INVALID_PAGINATION',
    });
  }

  return parsed;
}

module.exports = { parsePagination, buildPaginationMeta };
