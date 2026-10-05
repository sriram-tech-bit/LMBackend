'use strict';

const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { HTTP } = require('../config/constants');

/**
 * HTTP layer for /api/auth — requirement (d).
 */

/**
 * POST /api/auth/login
 *
 * Body: { "email": "librarian@library.test", "password": "Librarian@123" }
 * Returns the JWT to send as `Authorization: Bearer <token>` on the protected
 * routes (POST /api/books, POST /api/members, POST /api/borrow, POST /api/return/:id).
 */
const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);

  return sendSuccess(res, HTTP.OK, 'Login successful', result);
});

/**
 * POST /api/auth/register — create another librarian.
 * Open the first time (so a fresh database can be bootstrapped) then
 * admin-only, once at least one account exists — see the route for the guard.
 */
const register = asyncHandler(async (req, res) => {
  const librarian = await authService.registerLibrarian(req.body);

  return sendSuccess(res, HTTP.CREATED, 'Librarian account created successfully', librarian);
});

/** GET /api/auth/me — the account behind the presented token. */
const me = asyncHandler(async (req, res) => {
  return sendSuccess(res, HTTP.OK, 'Authenticated librarian', authService.describeCurrentUser(req.user));
});

/**
 * PATCH /api/auth/password — change your own password.
 * Every token issued before the change stops working.
 */
const changePassword = asyncHandler(async (req, res) => {
  const user = await authService.changePassword(req.user, req.body);

  return sendSuccess(res, HTTP.OK, 'Password changed successfully. Please log in again.', user);
});

module.exports = { login, register, me, changePassword };
