'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const ApiError = require('./ApiError');

/**
 * Thin wrapper around jsonwebtoken.
 *
 * Keeping sign/verify in one place means the secret, issuer and expiry policy
 * are impossible to get wrong in one route and right in another.
 */

/**
 * Sign a librarian access token.
 *
 * @param {{id: string, email: string, role: string}} librarian
 * @returns {string} signed JWT
 */
function signToken(librarian) {
  const payload = {
    sub: String(librarian.id),
    email: librarian.email,
    role: librarian.role,
    type: 'access',
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: config.jwt.issuer,
  });
}

/**
 * Verify a token and return its decoded payload.
 * Throws an ApiError(401) with a precise reason for every failure mode, so the
 * client can distinguish "expired" from "malformed" from "wrong signature".
 *
 * @param {string} token
 * @returns {{sub: string, email: string, role: string, iat: number, exp: number}}
 */
function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer,
    });

    if (decoded.type !== 'access') {
      throw ApiError.unauthorized('Invalid token type', { code: 'INVALID_TOKEN' });
    }

    return decoded;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (error.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Token has expired, please log in again', {
        code: 'TOKEN_EXPIRED',
      });
    }

    if (error.name === 'NotBeforeError') {
      throw ApiError.unauthorized('Token is not active yet', { code: 'TOKEN_NOT_ACTIVE' });
    }

    throw ApiError.unauthorized('Invalid or malformed token', { code: 'INVALID_TOKEN' });
  }
}

/** Seconds until the configured expiry — handy for the login response. */
function getExpirySeconds() {
  const decoded = jwt.decode(
    signToken({ id: 'probe', email: 'probe@library.test', role: 'librarian' })
  );
  return decoded.exp - decoded.iat;
}

module.exports = { signToken, verifyToken, getExpirySeconds };
