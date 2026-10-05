'use strict';

const borrowService = require('../services/borrowService');
const borrowQueryService = require('../services/borrowQueryService');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { buildPaginationMeta } = require('../utils/pagination');
const { HTTP } = require('../config/constants');

/**
 * HTTP layer for the borrow / return endpoints.
 *
 * The interesting logic (atomic stock decrement, transactions, compensation)
 * lives in services/borrowService.js — see the race-condition note there.
 */

/**
 * POST /api/borrow — issue a book to a member (librarian only).
 *
 * Body: { "book": "<isbn|id>", "member": "<membershipId|email|id>",
 *         "dueDate"?: ISO, "issueDate"?: ISO, "notes"?: string }
 */
const issueBook = asyncHandler(async (req, res) => {
  const { borrow, book, member } = await borrowService.issueBook({
    book: req.body.book,
    member: req.body.member,
    issueDate: req.body.issueDate,
    dueDate: req.body.dueDate,
    notes: req.body.notes,
    librarianId: req.user ? req.user._id : null,
  });

  return sendSuccess(
    res,
    HTTP.CREATED,
    `"${book.title}" issued to ${member.name} (${member.membershipId}), due ${borrow.dueDate
      .toISOString()
      .slice(0, 10)}`,
    {
      borrow,
      book: {
        id: String(book._id),
        title: book.title,
        isbn: book.isbn,
        totalCopies: book.totalCopies,
        availableCopies: book.availableCopies,
      },
      member: {
        id: String(member._id),
        name: member.name,
        membershipId: member.membershipId,
      },
    }
  );
});

/**
 * POST /api/return/:borrowId — return a book (librarian only).
 *
 * Body (optional): { "returnDate"?: ISO, "notes"?: string }
 */
const returnBook = asyncHandler(async (req, res) => {
  const { borrow, book } = await borrowService.returnBook({
    borrowId: req.params.borrowId,
    returnDate: req.body.returnDate,
    notes: req.body.notes,
    librarianId: req.user ? req.user._id : null,
  });

  return sendSuccess(
    res,
    HTTP.OK,
    `"${book.title}" returned successfully`,
    {
      borrow,
      book: {
        id: String(book._id),
        title: book.title,
        isbn: book.isbn,
        totalCopies: book.totalCopies,
        availableCopies: book.availableCopies,
      },
    }
  );
});

/** GET /api/borrows — all borrow records (?status=&overdue=&member=&book=). */
const listBorrows = asyncHandler(async (req, res) => {
  const { records, total, page, limit } = await borrowQueryService.listBorrows(req.query);

  return sendSuccess(res, HTTP.OK, 'Borrow records retrieved successfully', records, buildPaginationMeta(total, page, limit));
});

/** GET /api/borrows/:borrowId — one borrow record. */
const getBorrow = asyncHandler(async (req, res) => {
  const record = await borrowQueryService.getBorrowById(req.params.borrowId);
  return sendSuccess(res, HTTP.OK, 'Borrow record retrieved successfully', record);
});

/** POST /api/borrows/refresh-overdue — sweep past-due loans into `overdue`. */
const refreshOverdue = asyncHandler(async (_req, res) => {
  const result = await borrowQueryService.refreshOverdue();
  return sendSuccess(res, HTTP.OK, 'Overdue sweep completed', result);
});

module.exports = { issueBook, returnBook, listBorrows, getBorrow, refreshOverdue };
