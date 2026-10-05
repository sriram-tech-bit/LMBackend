'use strict';

const BorrowRecord = require('../models/BorrowRecord');
const Member = require('../models/Member');
const ApiError = require('../utils/ApiError');
const { parsePagination } = require('../utils/pagination');
const { resolveSort } = require('../validators/common');
const { BORROW_STATUS } = require('../config/constants');

/**
 * Read-only borrow queries: the borrow list and GET /api/members/:id/history.
 */

/** The book summary embedded in every history row (no need to fetch Book). */
const BOOK_PROJECTION = 'title author isbn genre totalCopies availableCopies';
const MEMBER_PROJECTION = 'name email membershipId status';

/**
 * GET /api/borrows
 *
 * @param {{status?: string, member?: string, book?: string, overdue?: string,
 *          page?: string, limit?: string, sort?: string}} query
 */
async function listBorrows(query = {}) {
  const { page, limit, skip } = parsePagination(query);

  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.member) filter.member = query.member;
  if (query.book) filter.book = query.book;

  if (query.overdue === 'true') {
    filter.returnDate = null;
    filter.dueDate = { $lt: new Date() };
  } else if (query.overdue === 'false') {
    filter.$or = [
      { returnDate: { $ne: null } },
      { dueDate: { $gte: new Date() } },
    ];
  }

  const [records, total] = await Promise.all([
    BorrowRecord.find(filter)
      .sort(resolveSort(query.sort, { issueDate: -1 }))
      .skip(skip)
      .limit(limit)
      .populate('book', BOOK_PROJECTION)
      .populate('member', MEMBER_PROJECTION)
      .lean({ virtuals: true }),
    BorrowRecord.countDocuments(filter),
  ]);

  return { records, total, page, limit };
}

/**
 * GET /api/members/:id/history — full borrow history for one member.
 *
 * Returns the member plus every BorrowRecord, newest first, with the book
 * hydrated and a summary of how many are still out / overdue.
 *
 * @param {string} memberId
 * @param {{status?: string, includeBook?: string, page?: string, limit?: string, sort?: string}} query
 */
async function getMemberHistory(memberId, query = {}) {
  const member = await Member.findById(memberId);
  if (!member) {
    throw ApiError.notFound(`No member found with id ${memberId}`, { code: 'MEMBER_NOT_FOUND' });
  }

  const { page, limit, skip } = parsePagination(query);

  const filter = { member: member._id };
  if (query.status === 'active') {
    filter.returnDate = null;
  } else if (query.status) {
    filter.status = query.status;
  }

  const includeBook = query.includeBook !== 'false';

  const listQuery = BorrowRecord.find(filter)
    .sort(resolveSort(query.sort, { issueDate: -1 }))
    .skip(skip)
    .limit(limit);

  if (includeBook) listQuery.populate('book', BOOK_PROJECTION);

  const [records, total, counts] = await Promise.all([
    listQuery.lean({ virtuals: true }),
    BorrowRecord.countDocuments(filter),
    buildHistorySummary(member._id),
  ]);

  return { member, records, total, page, limit, summary: counts };
}

/** Totals across the member's whole history (not just the current page). */
async function buildHistorySummary(memberId) {
  const now = new Date();

  const [totalBorrows, returned, active, overdue] = await Promise.all([
    BorrowRecord.countDocuments({ member: memberId }),
    BorrowRecord.countDocuments({ member: memberId, returnDate: { $ne: null } }),
    BorrowRecord.countDocuments({ member: memberId, returnDate: null }),
    BorrowRecord.countDocuments({ member: memberId, returnDate: null, dueDate: { $lt: now } }),
  ]);

  return {
    totalBorrows,
    returned,
    active,
    overdue,
    neverReturnedAndNotActive:
      totalBorrows - returned - active,
  };
}

/** GET /api/borrows/:borrowId */
async function getBorrowById(borrowId) {
  const record = await BorrowRecord.findById(borrowId)
    .populate('book', BOOK_PROJECTION)
    .populate('member', MEMBER_PROJECTION)
    .populate('issuedBy', 'name email')
    .populate('receivedBy', 'name email');

  if (!record) {
    throw ApiError.notFound(`No borrow record found with id ${borrowId}`, {
      code: 'BORROW_NOT_FOUND',
    });
  }

  return record;
}

/**
 * Sweep every still-issued record past its due date into `overdue`.
 * Called on an interval by server.js and exposed at POST /api/borrows/refresh-overdue.
 */
async function refreshOverdue() {
  const result = await BorrowRecord.refreshOverdueStatuses();
  return { ...result, status: BORROW_STATUS.OVERDUE, checkedAt: new Date() };
}

module.exports = { listBorrows, getMemberHistory, getBorrowById, refreshOverdue, buildHistorySummary };
