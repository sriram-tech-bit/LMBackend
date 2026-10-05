'use strict';

/**
 * Application-wide constants.
 *
 * Keeping magic strings/numbers in one place means validators, controllers and
 * models can never drift apart.
 *
 * Requires ./env first so `.env` is loaded and validated before any default is
 * derived from `process.env`.
 */

const config = require('./env');

/** BorrowRecord.status — exactly the three values required by the spec. */
const BORROW_STATUS = Object.freeze({
  ISSUED: 'issued',
  RETURNED: 'returned',
  OVERDUE: 'overdue',
});

const BORROW_STATUS_VALUES = Object.freeze(Object.values(BORROW_STATUS));

/** Member.status — a member can be suspended by a librarian. */
const MEMBER_STATUS = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
});

const MEMBER_STATUS_VALUES = Object.freeze(Object.values(MEMBER_STATUS));

/** Librarian roles: both can issue/return; only admin can manage librarians. */
const LIBRARIAN_ROLE = Object.freeze({
  LIBRARIAN: 'librarian',
  ADMIN: 'admin',
});

const LIBRARIAN_ROLE_VALUES = Object.freeze(Object.values(LIBRARIAN_ROLE));

/** Pagination defaults, overridable through env. */
const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: config.pagination.defaultLimit,
  MAX_LIMIT: config.pagination.maxLimit,
});

/** Loan policy. */
const LOAN = Object.freeze({
  DEFAULT_DAYS: config.loan.defaultDays,
  /** A member may not hold more than this many books at once. */
  MAX_ACTIVE_BORROWS: 5,
});

/** HTTP status codes used across the app (no bare numbers in controllers). */
const HTTP = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

/** Mongoose duplicate-key error code. */
const MONGO_DUPLICATE_KEY_CODE = 11000;

module.exports = {
  BORROW_STATUS,
  BORROW_STATUS_VALUES,
  MEMBER_STATUS,
  MEMBER_STATUS_VALUES,
  LIBRARIAN_ROLE,
  LIBRARIAN_ROLE_VALUES,
  PAGINATION,
  LOAN,
  HTTP,
  MONGO_DUPLICATE_KEY_CODE,
};
