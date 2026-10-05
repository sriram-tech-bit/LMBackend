'use strict';

const ApiError = require('../utils/ApiError');
const { verifyToken } = require('../utils/jwt');
const { HTTP } = require('../config/constants');
const Librarian = require('../models/Librarian');

/**
 * JWT authentication middleware (requirement d).
 *
 * Flow
 *  1. Read the token from `Authorization: Bearer <jwt>` (an `access_token`
 *     cookie is also accepted, which is convenient when testing in a browser).
 *  2. Verify signature, issuer and expiry.
 *  3. Re-load the librarian from MongoDB so a deleted/deactivated/password-changed
 *     account cannot keep using an old token.
 *  4. Attach the user to `req.user` for downstream middleware and controllers.
 */

/** Pull the raw token out of the request, or return null. */
function extractToken(req) {
  const header = req.get('authorization');

  if (typeof header === 'string' && header.length > 0) {
    const [scheme, value] = header.split(/\s+/);
    if (/^Bearer$/i.test(scheme) && value) return value.trim();
    // A bare token with no scheme is tolerated but flagged below.
    if (!/^Bearer$/i.test(scheme) && !value && scheme) return scheme.trim();
  }

  if (req.cookies && typeof req.cookies.access_token === 'string') {
    return req.cookies.access_token;
  }

  return null;
}

/**
 * Require a valid librarian token.
 * @type {import('express').RequestHandler}
 */
async function authenticate(req, _res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      throw ApiError.unauthorized(
        'Missing bearer token. Send "Authorization: Bearer <token>".',
        { code: 'TOKEN_MISSING' }
      );
    }

    const payload = verifyToken(token);

    const librarian = await Librarian.findById(payload.sub).select(
      '+password name email role isActive tokenValidFrom'
    );

    if (!librarian) {
      throw ApiError.unauthorized('The account for this token no longer exists', {
        code: 'ACCOUNT_NOT_FOUND',
      });
    }

    if (!librarian.isActive) {
      throw ApiError.forbidden('This librarian account has been deactivated', {
        code: 'ACCOUNT_INACTIVE',
      });
    }

    // Password change / forced logout bumps tokenValidFrom, invalidating older tokens.
    if (librarian.tokenValidFrom && payload.iat * 1000 < librarian.tokenValidFrom.getTime() - 1000) {
      throw ApiError.unauthorized('This token has been revoked, please log in again', {
        code: 'TOKEN_REVOKED',
      });
    }

    req.user = librarian;
    req.token = payload;

    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Role gate. Use after `authenticate`:
 *   router.post('/', authenticate, authorize('admin'), handler)
 *
 * @param {...string} allowedRoles
 * @returns {import('express').RequestHandler}
 */
function authorize(...allowedRoles) {
  return function authorizeRole(req, _res, next) {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', { code: 'TOKEN_MISSING' }));
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return next(
        new ApiError(
          HTTP.FORBIDDEN,
          `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
          { code: 'INSUFFICIENT_ROLE' }
        )
      );
    }

    return next();
  };
}

module.exports = { authenticate, authorize, extractToken };
