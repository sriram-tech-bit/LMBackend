'use strict';

const mongoose = require('mongoose');
const Book = require('../models/Book');
const Member = require('../models/Member');
const ApiError = require('../utils/ApiError');
const { HTTP } = require('../config/constants');

/**
 * Resolve the *flexible* references accepted by POST /api/borrow.
 *
 * Being able to say `{"book": "9780132350884", "member": "LIB-000001"}` instead
 * of hunting for two ObjectIds makes the endpoint far easier to call from curl
 * (and from the sample requests in docs/), while still accepting ids.
 */

/** True for a 24-character hex string that is a legal ObjectId. */
function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) && String(value).length === 24;
}

/** Normalise an ISBN the same way the Book schema does. */
function normaliseIsbn(value) {
  return String(value).replace(/[\s-]/g, '').toUpperCase();
}

/**
 * @param {string} reference ObjectId or ISBN
 * @returns {Promise<import('mongoose').Document>}
 * @throws {ApiError} 404 when no matching book exists
 */
async function resolveBook(reference) {
  const query = isObjectId(reference)
    ? { _id: reference }
    : { isbn: normaliseIsbn(reference) };

  const book = await Book.findOne(query);

  if (!book) {
    throw ApiError.notFound(
      isObjectId(reference) ? `No book found with id ${reference}` : `No book found with ISBN ${reference}`,
      { code: 'BOOK_NOT_FOUND' }
    );
  }

  return book;
}

/**
 * @param {string} reference ObjectId, email or membershipId
 * @returns {Promise<import('mongoose').Document>}
 * @throws {ApiError} 404 when no matching member exists
 */
async function resolveMember(reference) {
  const trimmed = String(reference).trim();

  let query;
  if (isObjectId(trimmed)) {
    query = { _id: trimmed };
  } else if (trimmed.includes('@')) {
    query = { email: trimmed.toLowerCase() };
  } else {
    query = { membershipId: trimmed.toUpperCase() };
  }

  const member = await Member.findOne(query);

  if (!member) {
    throw ApiError.notFound(`No member found matching "${reference}"`, { code: 'MEMBER_NOT_FOUND' });
  }

  return member;
}

/**
 * Assert a member is allowed to borrow right now.
 * @param {import('mongoose').Document} member
 * @throws {ApiError} 409 when suspended
 */
function assertMemberCanBorrow(member) {
  if (member.status !== 'active') {
    throw new ApiError(
      HTTP.CONFLICT,
      `Member ${member.membershipId} is ${member.status} and cannot borrow books`,
      { code: 'MEMBER_NOT_ACTIVE' }
    );
  }
}

module.exports = { resolveBook, resolveMember, assertMemberCanBorrow, isObjectId, normaliseIsbn };
