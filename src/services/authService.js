'use strict';

const Librarian = require('../models/Librarian');
const ApiError = require('../utils/ApiError');
const { signToken, getExpirySeconds } = require('../utils/jwt');
const { HTTP, MONGO_DUPLICATE_KEY_CODE, LIBRARIAN_ROLE } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Authentication (requirement d).
 *
 * POST /api/auth/login issues the JWT that the protected routes require.
 */

/**
 * Verify credentials and mint an access token.
 *
 * Security notes
 *  - A wrong password and an unknown email return the SAME 401 message, so the
 *    endpoint cannot be used to enumerate registered librarians.
 *  - The password hash is never returned; only the public fields are.
 *
 * @param {{email: string, password: string}} credentials
 * @returns {Promise<{token: string, tokenType: string, expiresIn: number, user: object}>}
 */
async function login({ email, password }) {
  const librarian = await Librarian.findOne({ email }).select('+password');

  const invalidCredentials = () =>
    ApiError.unauthorized('Invalid email or password', { code: 'INVALID_CREDENTIALS' });

  if (!librarian) throw invalidCredentials();

  if (!librarian.isActive) {
    throw new ApiError(HTTP.FORBIDDEN, 'This librarian account has been deactivated', {
      code: 'ACCOUNT_INACTIVE',
    });
  }

  const passwordMatches = await librarian.comparePassword(password);
  if (!passwordMatches) throw invalidCredentials();

  const token = signToken(librarian);

  // Fire-and-forget audit trail; a failure here must not fail the login.
  Librarian.updateOne({ _id: librarian._id }, { $set: { lastLoginAt: new Date() } }).catch((error) =>
    logger.warn('Could not record lastLoginAt', { message: error.message })
  );

  return {
    token,
    tokenType: 'Bearer',
    expiresIn: getExpirySeconds(),
    user: librarian.toPublicJSON(),
  };
}

/**
 * Create a librarian account. Used by the seed script and by an admin.
 *
 * @param {{name: string, email: string, password: string, role?: string}} payload
 * @returns {Promise<import('mongoose').Document>}
 */
async function registerLibrarian(payload) {
  try {
    const librarian = await Librarian.create({
      name: payload.name,
      email: payload.email,
      password: payload.password, // hashed by the pre-save hook
      role: payload.role ?? LIBRARIAN_ROLE.LIBRARIAN,
    });

    return librarian;
  } catch (error) {
    if (error && error.code === MONGO_DUPLICATE_KEY_CODE) {
      throw ApiError.conflict(`A librarian with email "${payload.email}" already exists`, {
        code: 'DUPLICATE_LIBRARIAN',
      });
    }
    throw error;
  }
}

/**
 * Change the caller's own password and revoke every token issued before now.
 *
 * @param {import('mongoose').Document} librarian loaded by the auth middleware
 * @param {{currentPassword: string, newPassword: string}} input
 */
async function changePassword(librarian, { currentPassword, newPassword }) {
  // Re-read with the hash, since `password` is `select: false`.
  const account = await Librarian.findById(librarian._id).select('+password');
  if (!account) {
    throw ApiError.notFound('Account not found', { code: 'ACCOUNT_NOT_FOUND' });
  }

  const matches = await account.comparePassword(currentPassword);
  if (!matches) {
    throw ApiError.unauthorized('Current password is incorrect', { code: 'INVALID_CREDENTIALS' });
  }

  account.password = newPassword; // pre-save hook re-hashes
  account.tokenValidFrom = new Date(); // invalidate previously issued tokens
  await account.save();

  logger.info('Librarian password changed', { librarianId: String(account._id) });

  return account.toPublicJSON();
}

/** Current account, for GET /api/auth/me. */
function describeCurrentUser(librarian) {
  return librarian.toPublicJSON();
}

module.exports = { login, registerLibrarian, changePassword, describeCurrentUser };
