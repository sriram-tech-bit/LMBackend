'use strict';

const { z, nonEmptyString } = require('./common');
const { EMAIL_PATTERN } = require('../models/Member');
const { LIBRARIAN_ROLE_VALUES } = require('../config/constants');

/**
 * Request schemas for the /api/auth endpoints.
 */

const emailField = z
  .string({ required_error: 'email is required' })
  .trim()
  .toLowerCase()
  .refine((value) => EMAIL_PATTERN.test(value), {
    message: 'email must be a valid email address',
  });

/**
 * Password policy.
 * Deliberately modest (8+ chars, at least one letter and one digit) so the seed
 * credentials and the README examples stay usable, while still rejecting the
 * usual "123456" / "password" style inputs.
 */
const passwordField = z
  .string({ required_error: 'password is required' })
  .min(8, 'password must be at least 8 characters')
  .max(128, 'password cannot exceed 128 characters')
  .regex(/[A-Za-z]/, 'password must contain at least one letter')
  .regex(/\d/, 'password must contain at least one digit');

/** POST /api/auth/login */
const loginSchema = z
  .object({
    email: emailField,
    password: z.string({ required_error: 'password is required' }).min(1, 'password cannot be empty'),
  })
  .strict('Unknown field in request body');

/** POST /api/auth/register — used by an admin (or by the seed script) to add a librarian. */
const registerLibrarianSchema = z
  .object({
    name: nonEmptyString('name', 120).min(2, 'name must be at least 2 characters'),
    email: emailField,
    password: passwordField,
    role: z.enum(LIBRARIAN_ROLE_VALUES).optional(),
  })
  .strict('Unknown field in request body');

/** PATCH /api/auth/password — change your own password. */
const changePasswordSchema = z
  .object({
    currentPassword: z.string({ required_error: 'currentPassword is required' }).min(1),
    newPassword: passwordField,
  })
  .strict('Unknown field in request body')
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'newPassword must be different from currentPassword',
  });

module.exports = {
  loginSchema,
  registerLibrarianSchema,
  changePasswordSchema,
  passwordField,
};
