'use strict';

const bookService = require('../services/bookService');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { buildPaginationMeta } = require('../utils/pagination');
const { HTTP } = require('../config/constants');

/**
 * HTTP layer for /api/books.
 *
 * Controllers stay thin: read validated input, call the service, shape the
 * response. All thrown errors are forwarded to the central error handler.
 */

/** POST /api/books — add a new book (librarian only). */
const createBook = asyncHandler(async (req, res) => {
  const book = await bookService.createBook(req.body);

  return sendSuccess(res, HTTP.CREATED, 'Book added to the catalogue successfully', book);
});

/**
 * GET /api/books — list books with pagination + filtering.
 *   ?genre=Science%20Fiction&search=asimov&available=true&page=1&limit=10&sort=title
 */
const listBooks = asyncHandler(async (req, res) => {
  const { books, total, page, limit } = await bookService.listBooks(req.query);

  return sendSuccess(res, HTTP.OK, 'Books retrieved successfully', books, buildPaginationMeta(total, page, limit));
});

/** GET /api/books/:id */
const getBook = asyncHandler(async (req, res) => {
  const book = await bookService.getBookById(req.params.id);
  return sendSuccess(res, HTTP.OK, 'Book retrieved successfully', book);
});

/** PATCH /api/books/:id */
const updateBook = asyncHandler(async (req, res) => {
  const book = await bookService.updateBook(req.params.id, req.body);
  return sendSuccess(res, HTTP.OK, 'Book updated successfully', book);
});

/** DELETE /api/books/:id */
const deleteBook = asyncHandler(async (req, res) => {
  const book = await bookService.deleteBook(req.params.id);
  return sendSuccess(res, HTTP.OK, `Book "${book.title}" deleted successfully`, { id: String(book._id) });
});

module.exports = { createBook, listBooks, getBook, updateBook, deleteBook };
