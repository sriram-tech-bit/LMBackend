'use strict';

const { z, objectId, nonEmptyString, isoDateString, paginationQuery } = require('./common');
const { MEMBER_STATUS_VALUES } = require('../config/constants');
const { MEMBERSHIP_ID_PATTERN, EMAIL_PATTERN } = require('../models/Member');

/**
 * Request schemas for the /api/members endpoints.
 */

const emailField = z
  .string({ required_error: 'email is required' })
  .trim()
  .toLowerCase()
  .refine((value) => EMAIL_PATTERN.test(value), {
    message: 'email must be a valid email address',
  });

/** POST /api/members */
const createMemberSchema = z
  .object({
    name: nonEmptyString('name', 120).min(2, 'name must be at least 2 characters'),
    email: emailField,
    /** Optional — auto-generated as LIB-000001 when omitted. */
    membershipId: z
      .string()
      .trim()
      .toUpperCase()
      .refine((value) => MEMBERSHIP_ID_PATTERN.test(value), {
        message: 'membershipId must look like LIB-000123',
      })
      .optional(),
    /** Optional — defaults to now. Accepts an ISO string or a Date. */
    joinedDate: z
      .union([isoDateString, z.date()])
      .optional(),
    phone: z.string().trim().max(20, 'phone cannot exceed 20 characters').optional(),
    status: z.enum(MEMBER_STATUS_VALUES).optional(),
  })
  .strict('Unknown field in request body')
  .refine(
    (value) => !value.joinedDate || value.joinedDate.getTime() <= Date.now() + 60_000,
    { path: ['joinedDate'], message: 'joinedDate cannot be in the future' }
  );

/** PATCH /api/members/:id */
const updateMemberSchema = z
  .object({
    name: nonEmptyString('name', 120).min(2, 'name must be at least 2 characters').optional(),
    email: emailField.optional(),
    phone: z.string().trim().max(20, 'phone cannot exceed 20 characters').optional(),
    status: z.enum(MEMBER_STATUS_VALUES).optional(),
  })
  .strict('Unknown field in request body')
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

/** GET /api/members?page=&limit=&sort=&search=&status= */
const listMembersQuerySchema = z
  .object({
    ...paginationQuery,
    search: z.string().trim().min(1, 'search cannot be empty').max(200).optional(),
    status: z.enum(MEMBER_STATUS_VALUES).optional(),
  })
  .strict('Unknown query parameter');

/** GET /api/members/:id */
const memberIdParamSchema = z.object({ id: objectId });

/** GET /api/members/:id/history?page=&limit=&status=&includeBook= */
const memberHistoryQuerySchema = z
  .object({
    ...paginationQuery,
    status: z
      .enum(['issued', 'returned', 'overdue', 'active'], {
        errorMap: () => ({ message: 'status must be one of: issued, returned, overdue, active' }),
      })
      .optional(),
    /** Defaults to true — the book each record refers to is populated. */
    includeBook: z
      .enum(['true', 'false'], { errorMap: () => ({ message: 'includeBook must be "true" or "false"' }) })
      .optional(),
  })
  .strict('Unknown query parameter');

module.exports = {
  createMemberSchema,
  updateMemberSchema,
  listMembersQuerySchema,
  memberIdParamSchema,
  memberHistoryQuerySchema,
  emailField,
};
