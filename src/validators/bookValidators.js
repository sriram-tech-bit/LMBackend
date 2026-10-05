'use strict';

const { z, objectId, nonEmptyString, paginationQuery } = require('./common');
const { ISBN_PATTERN } = require('../models/Book');

/**
 * Request schemas for the /api/books endpoints.
 */

/** POST /api/books */
const createBookSchema = z
  .object({
    title: nonEmptyString('title', 200),
    author: nonEmptyString('author', 150),
    isbn: z
      .string({ required_error: 'ISBN is required' })
      .trim()
      .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
      .refine((value) => ISBN_PATTERN.test(value), {
        message: 'ISBN must be a valid 10- or 13-digit ISBN (hyphens allowed)',
      }),
    genre: nonEmptyString('genre', 80),
    totalCopies: z.coerce
      .number({ invalid_type_error: 'totalCopies must be a number' })
      .int('totalCopies must be a whole number')
      .min(0, 'totalCopies cannot be negative')
      .max(100000, 'totalCopies is unrealistically large'),
    /** Optional: defaults to totalCopies. Must not exceed totalCopies. */
    availableCopies: z.coerce
      .number({ invalid_type_error: 'availableCopies must be a number' })
      .int('availableCopies must be a whole number')
      .min(0, 'availableCopies cannot be negative')
      .optional(),
  })
  .strict('Unknown field in request body')
  .superRefine((value, ctx) => {
    if (value.availableCopies !== undefined && value.availableCopies > value.totalCopies) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['availableCopies'],
        message: 'availableCopies cannot be greater than totalCopies',
      });
    }
  });

/** PATCH /api/books/:id — every field optional, at least one required. */
const updateBookSchema = z
  .object({
    title: nonEmptyString('title', 200).optional(),
    author: nonEmptyString('author', 150).optional(),
    genre: nonEmptyString('genre', 80).optional(),
    totalCopies: z.coerce
      .number({ invalid_type_error: 'totalCopies must be a number' })
      .int('totalCopies must be a whole number')
      .min(0, 'totalCopies cannot be negative')
      .optional(),
    availableCopies: z.coerce
      .number({ invalid_type_error: 'availableCopies must be a number' })
      .int('availableCopies must be a whole number')
      .min(0, 'availableCopies cannot be negative')
      .optional(),
  })
  .strict('Unknown field in request body')
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

/** GET /api/books?genre=&search=&page=&limit=&sort=&available= */
const listBooksQuerySchema = z
  .object({
    ...paginationQuery,
    genre: z.string().trim().min(1, 'genre cannot be empty').max(80).optional(),
    search: z.string().trim().min(1, 'search cannot be empty').max(200).optional(),
    /** "true" returns only titles with availableCopies > 0. */
    available: z
      .enum(['true', 'false'], { errorMap: () => ({ message: 'available must be "true" or "false"' }) })
      .optional(),
  })
  .strict('Unknown query parameter');

/** GET /api/books/:id */
const bookIdParamSchema = z.object({ id: objectId });

module.exports = {
  createBookSchema,
  updateBookSchema,
  listBooksQuerySchema,
  bookIdParamSchema,
};
