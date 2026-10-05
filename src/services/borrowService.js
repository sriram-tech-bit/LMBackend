'use strict';

const mongoose = require('mongoose');
const Book = require('../models/Book');
const BorrowRecord = require('../models/BorrowRecord');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const logger = require('../utils/logger');
const { HTTP, BORROW_STATUS, LOAN } = require('../config/constants');
const { resolveBook, resolveMember, assertMemberCanBorrow } = require('./referenceResolver');

/* ===========================================================================
 * (e) RACE CONDITION — TWO LIBRARIANS, ONE LAST COPY
 * ===========================================================================
 * The decrement is NOT read-then-write. It is a single conditional update:
 *
 *   Book.findOneAndUpdate(
 *     { _id: bookId, availableCopies: { $gt: 0 } },   <- the guard
 *     { $inc: { availableCopies: -1 } },              <- the decrement
 *     { new: true })
 *
 * MongoDB applies writes to one document atomically, so the check and the
 * decrement happen as one indivisible operation. Two simultaneous requests for
 * the last copy are serialised: the first matches `availableCopies: {$gt: 0}`
 * and goes 1 -> 0; the second's filter no longer matches, returns null, and we
 * answer 409 with no record created. No lock, no optimistic-retry loop, and it
 * stays correct even with several API instances behind a load balancer.
 *
 * The BorrowRecord is then written in the SAME transaction when the deployment
 * supports one (a replica set / Atlas: MONGODB_TRANSACTIONS=true). Without
 * transactions we use a compensating action instead: if the record insert fails
 * we increment the copy straight back, so a book can never be silently lost.
 * The partial unique index on (book, member) where returnDate is null is the
 * final backstop against a duplicate active loan.
 * ======================================================================== */

/** Add whole days to a date without mutating the input. */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Atomically reserve one copy of a book.
 *
 * @param {import('mongoose').Types.ObjectId} bookId
 * @param {import('mongoose').ClientSession|null} session
 * @returns {Promise<import('mongoose').Document>} the book after the decrement
 * @throws {ApiError} 404 book gone, 409 nothing left to lend
 */
async function reserveOneCopy(bookId, session) {
  const options = { new: true };
  if (session) options.session = session;

  const updated = await Book.findOneAndUpdate(
    { _id: bookId, availableCopies: { $gt: 0 } },
    { $inc: { availableCopies: -1 } },
    options
  );

  if (updated) return updated;

  // The guard failed: either the book was deleted in the meantime, or every
  // copy is already out. Tell those two apart for a useful error message.
  const stillExists = await Book.exists({ _id: bookId }).session(session ?? null);

  if (!stillExists) {
    throw ApiError.notFound(`No book found with id ${bookId}`, { code: 'BOOK_NOT_FOUND' });
  }

  throw new ApiError(HTTP.CONFLICT, 'No copies of this book are currently available', {
    code: 'NO_COPIES_AVAILABLE',
  });
}

/** Give a reserved copy back (used when the BorrowRecord could not be written). */
async function releaseOneCopy(bookId, session = null) {
  // The $expr guard stops availableCopies from ever exceeding totalCopies.
  await Book.updateOne(
    { _id: bookId, $expr: { $lt: ['$availableCopies', '$totalCopies'] } },
    { $inc: { availableCopies: 1 } },
    session ? { session } : {}
  );
}

/** Refuse the loan when the member already holds too many books. */
async function assertBorrowLimitNotReached(memberId, session = null) {
  const activeCount = await BorrowRecord.countDocuments({ member: memberId, returnDate: null }).session(
    session ?? null
  );

  if (activeCount >= LOAN.MAX_ACTIVE_BORROWS) {
    throw new ApiError(
      HTTP.CONFLICT,
      `This member already holds ${activeCount} books (limit ${LOAN.MAX_ACTIVE_BORROWS}). Return one first.`,
      { code: 'BORROW_LIMIT_REACHED' }
    );
  }
}

/**
 * POST /api/borrow — issue a book to a member.
 *
 * @param {{book: string, member: string, issueDate?: Date, dueDate?: Date,
 *          notes?: string, librarianId?: string}} input
 * @returns {Promise<{borrow: object, book: object, member: object}>}
 */
async function issueBook(input) {
  const [book, member] = await Promise.all([
    resolveBook(input.book),
    resolveMember(input.member),
  ]);

  assertMemberCanBorrow(member);
  await assertBorrowLimitNotReached(member._id);

  // The model fills in dueDate = issueDate + DEFAULT_LOAN_DAYS when omitted.
  const issueDate = input.issueDate ?? new Date();

  const payload = {
    book: book._id,
    member: member._id,
    issueDate,
    status: BORROW_STATUS.ISSUED,
    issuedBy: input.librarianId ?? null,
  };
  if (input.dueDate) payload.dueDate = input.dueDate;
  if (input.notes) payload.notes = input.notes;

  const session = config.mongo.transactionsEnabled ? await mongoose.startSession() : null;

  try {
    let record;

    if (session) {
      // Preferred path: both writes commit or neither does.
      await session.withTransaction(async () => {
        await reserveOneCopy(book._id, session);
        record = new BorrowRecord(payload);
        await record.save({ session });
      });
    } else {
      // Standalone mongod: reserve, then insert, then compensate on failure.
      await reserveOneCopy(book._id, null);

      try {
        record = new BorrowRecord(payload);
        await record.save();
      } catch (error) {
        await releaseOneCopy(book._id);
        logger.warn('Borrow record insert failed — copy released back to stock', {
          bookId: String(book._id),
          code: error.code,
        });
        throw error;
      }
    }

    await record.populate([
      { path: 'book', select: 'title author isbn genre totalCopies availableCopies' },
      { path: 'member', select: 'name email membershipId' },
    ]);

    return { borrow: record, book: await Book.findById(book._id), member };
  } finally {
    if (session) await session.endSession();
  }
}

/**
 * POST /api/return/:borrowId — return a borrowed book.
 *
 * Idempotency comes from the same trick as issuing: the update is guarded by
 * `returnDate: null`, so only the first of two concurrent returns can match.
 * The loser gets a clear 409 instead of double-incrementing the stock.
 *
 * @param {{borrowId: string, returnDate?: Date, notes?: string, librarianId?: string}} input
 */
async function returnBook(input) {
  const returnedAt = input.returnDate ?? new Date();
  const session = config.mongo.transactionsEnabled ? await mongoose.startSession() : null;

  try {
    let record;

    const applyReturn = async (activeSession) => {
      const update = {
        $set: {
          returnDate: returnedAt,
          status: BORROW_STATUS.RETURNED,
          receivedBy: input.librarianId ?? null,
        },
      };
      if (input.notes) update.$set.notes = input.notes;

      const options = { new: true };
      if (activeSession) options.session = activeSession;

      const updated = await BorrowRecord.findOneAndUpdate(
        { _id: input.borrowId, returnDate: null },
        update,
        options
      );

      if (!updated) {
        const existing = await BorrowRecord.findById(input.borrowId).session(activeSession ?? null);

        if (!existing) {
          throw ApiError.notFound(`No borrow record found with id ${input.borrowId}`, {
            code: 'BORROW_NOT_FOUND',
          });
        }

        throw new ApiError(
          HTTP.CONFLICT,
          `This book was already returned on ${existing.returnDate.toISOString()}`,
          { code: 'ALREADY_RETURNED' }
        );
      }

      await releaseOneCopy(updated.book, activeSession);
      return updated;
    };

    if (session) {
      await session.withTransaction(async () => {
        record = await applyReturn(session);
      });
    } else {
      record = await applyReturn(null);
    }

    await record.populate([
      { path: 'book', select: 'title author isbn genre totalCopies availableCopies' },
      { path: 'member', select: 'name email membershipId' },
    ]);

    return {
      borrow: record,
      book: await Book.findById(record.book._id),
    };
  } finally {
    if (session) await session.endSession();
  }
}

module.exports = { issueBook, returnBook, reserveOneCopy, releaseOneCopy, assertBorrowLimitNotReached, addDays };
