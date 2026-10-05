'use strict';

const Librarian = require('../models/Librarian');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('./auth');
const { LIBRARIAN_ROLE } = require('../config/constants');

/**
 * Guard for POST /api/auth/register.
 *
 *   - On an EMPTY database the route is open, so a fresh clone can be
 *     bootstrapped over HTTP instead of only via `npm run seed`.
 *   - Once at least one librarian exists, only an authenticated ADMIN may add
 *     more — otherwise anyone could mint themselves an account.
 */
const registerGuard = asyncHandler(async (req, _res, next) => {
  const librarianCount = await Librarian.estimatedDocumentCount();

  if (librarianCount === 0) {
    req.isBootstrapRegistration = true;
    return next();
  }

  // Accounts already exist: fall through to real authentication.
  return authenticate(req, _res, (error) => {
    if (error) return next(error);

    if (req.user.role !== LIBRARIAN_ROLE.ADMIN) {
      return next(
        ApiError.forbidden('Only an admin can create additional librarian accounts', {
          code: 'INSUFFICIENT_ROLE',
        })
      );
    }

    return next();
  });
});

module.exports = registerGuard;
