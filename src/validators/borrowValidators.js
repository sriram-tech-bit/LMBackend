'use strict';

const { z, objectId, isoDateString, paginationQuery } = require('./common');
const { BORROW_STATUS_VALUES } = require('../config/constants');
const { ISBN_PATTERN } = require('../models/Book');
const { MEMBERSHIP_ID_PATTERN, EMAIL_PATTERN } = require('../models/Member');

/**
 * Request schemas for the borrow / return endpoints.
 *
 * Convenience: `book` may be given as an ObjectId **or** an ISBN, and `member`
 * as an ObjectId **or** an email / membershipId. The service layer resolves
 * whichever form arrives, so the API is usable straight from curl without first
 * looking up ids.
 */

const objectIdString = z.string().trim().regex(/^[0-9a-fA-F]{24}$/);

/** Accepts: ObjectId | ISBN-10 | ISBN-13 (hyphens allowed). */
const bookReference = z
  .string({ required_error: 'book is required' })
  .trim()
  .min(1, 'book cannot be empty')
  .refine(
    (value) =>
      objectIdString.safeParse(value).success ||
      ISBN_PATTERN.test(value.replace(/[\s-]/g, '').toUpperCase()),
    { message: 'book must be an ISBN or a 24-character ObjectId' }
  );

/** Accepts: ObjectId | email | LIB-000123 membership id. */
const memberReference = z
  .string({ required_error: 'member is required' })
  .trim()
  .min(1, 'member cannot be empty')
  .refine(
    (value) =>
      objectIdString.safeParse(value).success ||
      EMAIL_PATTERN.test(value.toLowerCase()) ||
      MEMBERSHIP_ID_PATTERN.test(value.toUpperCase()),
    { message: 'member must be an email, a membershipId (LIB-000123) or a 24-character ObjectId' }
  );

/** POST /api/borrow */
const issueBookSchema = z
  .object({
    book: bookReference,
    member: memberReference,
    /** Optional custom due date; defaults to issueDate + DEFAULT_LOAN_DAYS. */
    dueDate: z.union([isoDateString, z.date()]).optional(),
    issueDate: z.union([isoDateString, z.date()]).optional(),
    notes: z.string().trim().max(500, 'notes cannot exceed 500 characters').optional(),
  })
  .strict('Unknown field in request body')
  .refine(
    (value) => !value.dueDate || !value.issueDate || value.dueDate.getTime() >= value.issueDate.getTime(),
    { path: ['dueDate'], message: 'dueDate must be on or after issueDate' }
  );

/** POST /api/return/:borrowId */
const returnBookSchema = z
  .object({
    /** Optional: lets a librarian back-date a return. Defaults to now. */
    returnDate: z.union([isoDateString, z.date()]).optional(),
    notes: z.string().trim().max(500, 'notes cannot exceed 500 characters').optional(),
  })
  .strict('Unknown field in request body')
  .default({});

const borrowIdParamSchema = z.object({ borrowId: objectId });

/** GET /api/borrows?status=&member=&book=&overdue=&page=&limit=&sort= */
const listBorrowsQuerySchema = z
  .object({
    ...paginationQuery,
    status: z.enum(BORROW_STATUS_VALUES).optional(),
    member: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'member must be a 24-character ObjectId')
      .optional(),
    book: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'book must be a 24-character ObjectId')
      .optional(),
    /** "true" -> only records whose dueDate has passed and are still out. */
    overdue: z
      .enum(['true', 'false'], { errorMap: () => ({ message: 'overdue must be "true" or "false"' }) })
      .optional(),
  })
  .strict('Unknown query parameter');

module.exports = {
  issueBookSchema,
  returnBookSchema,
  borrowIdParamSchema,
  listBorrowsQuerySchema,
  bookReference,
  memberReference,
};
