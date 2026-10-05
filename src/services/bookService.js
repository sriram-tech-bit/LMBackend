'use strict';

const Book = require('../models/Book');
const BorrowRecord = require('../models/BorrowRecord');
const ApiError = require('../utils/ApiError');
const { parsePagination } = require('../utils/pagination');
const { resolveSort } = require('../validators/common');
const { MONGO_DUPLICATE_KEY_CODE } = require('../config/constants');

/**
 * Catalogue operations: POST /api/books and the supporting reads/writes.
 */

/** Escape a user string before it goes into a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * POST /api/books
 *
 * @param {{title: string, author: string, isbn: string, genre: string,
 *          totalCopies: number, availableCopies?: number}} payload
 * @returns {Promise<import('mongoose').Document>}
 */
async function createBook(payload) {
  try {
    return await Book.create(payload);
  } catch (error) {
    // Turn the unique-index violation into a message that names the ISBN.
    if (error && error.code === MONGO_DUPLICATE_KEY_CODE) {
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      throw ApiError.conflict(`A book with this ${field} already exists`, {
        code: 'DUPLICATE_BOOK',
        details: [
          { field, message: `"${payload.isbn}" is already in the catalogue`, code: 'duplicate' },
        ],
      });
    }
    throw error;
  }
}

/**
 * GET /api/books — paginated, filterable by genre / availability / free text.
 *
 * @param {{genre?: string, search?: string, available?: string,
 *          page?: string, limit?: string, sort?: string}} query
 */
async function listBooks(query = {}) {
  const { page, limit, skip } = parsePagination(query);

  const filter = {};

  if (query.genre) {
    // Case-insensitive exact match, so ?genre=science+fiction works whatever
    // casing the client sends.
    filter.genre = { $regex: `^${escapeRegExp(query.genre)}$`, $options: 'i' };
  }

  if (query.available === 'true') filter.availableCopies = { $gt: 0 };
  if (query.available === 'false') filter.availableCopies = 0;

  if (query.search) {
    const pattern = new RegExp(escapeRegExp(query.search), 'i');
    filter.$or = [{ title: pattern }, { author: pattern }, { isbn: pattern }];
  }

  const [books, total] = await Promise.all([
    Book.find(filter)
      .sort(resolveSort(query.sort, { createdAt: -1 }))
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Book.countDocuments(filter),
  ]);

  return { books, total, page, limit };
}

/**
 * GET /api/books/:id
 * @throws {ApiError} 404
 */
async function getBookById(id) {
  const book = await Book.findById(id);
  if (!book) {
    throw ApiError.notFound(`No book found with id ${id}`, { code: 'BOOK_NOT_FOUND' });
  }
  return book;
}

/** How many copies of this book are currently out on loan. */
function borrowedCopiesOf(book) {
  return book.totalCopies - book.availableCopies;
}

/**
 * PATCH /api/books/:id
 *
 * Guard rail: `totalCopies` may not drop below the number of copies currently
 * on loan, because that would push `availableCopies` negative.
 *
 * @returns {Promise<import('mongoose').Document>}
 */
async function updateBook(id, payload) {
  const book = await Book.findById(id);
  if (!book) {
    throw ApiError.notFound(`No book found with id ${id}`, { code: 'BOOK_NOT_FOUND' });
  }

  const borrowedCopies = borrowedCopiesOf(book);

  if (payload.totalCopies !== undefined) {
    if (payload.totalCopies < borrowedCopies) {
      throw ApiError.conflict(
        `totalCopies cannot be lower than the ${borrowedCopies} copies currently on loan`,
        { code: 'INVALID_TOTAL_COPIES' }
      );
    }

    // Apply the same delta to availableCopies so the counters stay consistent.
    const delta = payload.totalCopies - book.totalCopies;
    const nextAvailable = payload.availableCopies ?? book.availableCopies + delta;

    if (nextAvailable < 0 || nextAvailable > payload.totalCopies) {
      throw ApiError.badRequest('availableCopies must be between 0 and totalCopies', {
        code: 'INVALID_AVAILABLE_COPIES',
      });
    }

    book.totalCopies = payload.totalCopies;
    book.availableCopies = nextAvailable;
  } else if (payload.availableCopies !== undefined) {
    if (payload.availableCopies > book.totalCopies) {
      throw ApiError.badRequest('availableCopies cannot be greater than totalCopies', {
        code: 'INVALID_AVAILABLE_COPIES',
      });
    }
    book.availableCopies = payload.availableCopies;
  }

  if (payload.title !== undefined) book.title = payload.title;
  if (payload.author !== undefined) book.author = payload.author;
  if (payload.genre !== undefined) book.genre = payload.genre;

  await book.save();
  return book;
}

/**
 * DELETE /api/books/:id — refused while any copy is still on loan, so a borrow
 * history never points at a missing book.
 */
async function deleteBook(id) {
  const book = await Book.findById(id);
  if (!book) {
    throw ApiError.notFound(`No book found with id ${id}`, { code: 'BOOK_NOT_FOUND' });
  }

  const activeLoans = await BorrowRecord.countDocuments({ book: book._id, returnDate: null });
  if (activeLoans > 0) {
    throw ApiError.conflict(
      `Cannot delete "${book.title}": ${activeLoans} cop${activeLoans === 1 ? 'y is' : 'ies are'} still on loan`,
      { code: 'BOOK_HAS_ACTIVE_LOANS' }
    );
  }

  await book.deleteOne();
  return book;
}

module.exports = { createBook, listBooks, getBookById, updateBook, deleteBook, escapeRegExp };
