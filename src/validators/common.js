'use strict';

const { z } = require('zod');
const { PAGINATION } = require('../config/constants');

/**
 * Shared Zod primitives used by every request schema.
 *
 * Zod `.object()` strips keys it does not know about, which doubles as a
 * whitelist against mass-assignment (a client cannot inject `_id` or
 * `availableCopies` into a create payload).
 */

/** 24-character hex MongoDB ObjectId. */
const objectId = z
  .string({ required_error: 'id is required' })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a valid 24-character MongoDB ObjectId');

/** ISO-8601 date-time string that is also a real calendar date. */
const isoDateString = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'must be a valid ISO-8601 date, e.g. 2026-05-10T10:00:00.000Z',
  })
  .transform((value) => new Date(value));

/** A trimmed, non-empty string with an explicit maximum length. */
function nonEmptyString(field, max) {
  let schema = z.string({ required_error: `${field} is required` }).trim().min(1, `${field} cannot be empty`);
  if (max) schema = schema.max(max, `${field} cannot exceed ${max} characters`);
  return schema;
}

/** Shared pagination + sorting query parameters. */
const paginationQuery = {
  page: z.coerce
    .number({ invalid_type_error: 'page must be a number' })
    .int('page must be an integer')
    .min(1, 'page must be at least 1')
    .optional(),
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be a number' })
    .int('limit must be an integer')
    .min(1, 'limit must be at least 1')
    .max(PAGINATION.MAX_LIMIT, `limit must not be greater than ${PAGINATION.MAX_LIMIT}`)
    .optional(),
  sort: z
    .enum(
      [
        'newest',
        'oldest',
        'title',
        '-title',
        'author',
        '-author',
        'dueDate',
        '-dueDate',
        'issueDate',
        '-issueDate',
      ],
      { errorMap: () => ({ message: 'sort has an unsupported value' }) }
    )
    .optional(),
};

/** Map a `sort` keyword to a Mongoose sort object. */
function resolveSort(sort, fallback = { createdAt: -1 }) {
  switch (sort) {
    case 'newest':
      return { createdAt: -1 };
    case 'oldest':
      return { createdAt: 1 };
    case 'title':
      return { title: 1 };
    case '-title':
      return { title: -1 };
    case 'author':
      return { author: 1 };
    case '-author':
      return { author: -1 };
    case 'dueDate':
      return { dueDate: 1 };
    case '-dueDate':
      return { dueDate: -1 };
    case 'issueDate':
      return { issueDate: 1 };
    case '-issueDate':
      return { issueDate: -1 };
    default:
      return fallback;
  }
}

module.exports = {
  z,
  objectId,
  isoDateString,
  nonEmptyString,
  paginationQuery,
  resolveSort,
};
