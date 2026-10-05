'use strict';

const mongoose = require('mongoose');
const { BORROW_STATUS, BORROW_STATUS_VALUES, LOAN } = require('../config/constants');

/**
 * BorrowRecord
 * ---------------------------------------------------------------------------
 * Fields required by the assignment:
 *   book (ref), member (ref), issueDate, dueDate, returnDate, status
 *
 * Design notes
 *  - `book` and `member` are real ObjectId references (`ref`) so `populate()`
 *    can hydrate them, plus the assignment's "references between collections"
 *    requirement is satisfied at the schema level.
 *  - `dueDate` defaults to issueDate + DEFAULT_LOAN_DAYS (14) when omitted.
 *  - `returnDate` is null while the book is still out.
 *  - `status` moves issued -> returned on return; the `overdue` state is derived
 *    from `dueDate` and refreshed by a sweep (see static refreshOverdueStatuses)
 *    so a long-running server never reports a stale status.
 *  - A PARTIAL UNIQUE INDEX on (book, member) restricted to records with a null
 *    `returnDate` stops a member holding two active copies of the same title.
 */

const borrowRecordSchema = new mongoose.Schema(
  {
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: [true, 'book is required'],
      index: true,
    },

    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member',
      required: [true, 'member is required'],
      index: true,
    },

    /** The librarian who processed the issue (audit trail). */
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Librarian',
      default: null,
    },

    /** The librarian who processed the return (audit trail). */
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Librarian',
      default: null,
    },

    issueDate: {
      type: Date,
      default: Date.now,
      required: [true, 'issueDate is required'],
    },

    dueDate: {
      type: Date,
      required: [true, 'dueDate is required'],
      validate: {
        validator(value) {
          if (!value) return false;
          // dueDate must be on/after the issue date.
          return !this.issueDate || value.getTime() >= this.issueDate.getTime();
        },
        message: 'dueDate must be on or after issueDate',
      },
    },

    returnDate: {
      type: Date,
      default: null,
      validate: {
        validator(value) {
          if (!value) return true;
          // A book cannot be returned before it was issued.
          return !this.issueDate || value.getTime() >= this.issueDate.getTime();
        },
        message: 'returnDate cannot be before issueDate',
      },
    },

    status: {
      type: String,
      enum: {
        values: BORROW_STATUS_VALUES,
        message: `status must be one of: ${BORROW_STATUS_VALUES.join(', ')}`,
      },
      default: BORROW_STATUS.ISSUED,
      index: true,
    },

    /** Optional librarian remark, e.g. "cover damaged". */
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'notes cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/** History endpoint: GET /api/members/:id/history (newest first). */
borrowRecordSchema.index({ member: 1, issueDate: -1 });

/** Overdue sweep: find everything still out whose due date has passed. */
borrowRecordSchema.index({ status: 1, dueDate: 1 });

/**
 * One active loan per (member, book) pair. A "returned" record has a non-null
 * returnDate, so it falls outside this partial index and the member may borrow
 * the same title again later.
 */
borrowRecordSchema.index(
  { book: 1, member: 1 },
  {
    unique: true,
    partialFilterExpression: { returnDate: { $type: 'null' } },
    name: 'uniq_active_book_member',
  }
);

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Default the due date and keep `status` consistent with `returnDate`. */
borrowRecordSchema.pre('validate', function applyLoanDefaults(next) {
  if (this.issueDate && !this.dueDate) {
    const due = new Date(this.issueDate);
    due.setDate(due.getDate() + LOAN.DEFAULT_DAYS);
    this.dueDate = due;
  }

  // A record with a returnDate is, by definition, returned.
  if (this.returnDate) {
    this.status = BORROW_STATUS.RETURNED;
  }

  next();
});

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

/** True when the book is still out and past its due date. */
borrowRecordSchema.virtual('isOverdue').get(function isOverdue() {
  if (this.returnDate) return false;
  return Boolean(this.dueDate) && this.dueDate.getTime() < Date.now();
});

/** Whole days late (0 when on time or already returned). */
borrowRecordSchema.virtual('daysOverdue').get(function daysOverdue() {
  if (!this.isOverdue) return 0;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.ceil((Date.now() - this.dueDate.getTime()) / MS_PER_DAY);
});

/** Whole days until due (negative when overdue). */
borrowRecordSchema.virtual('daysUntilDue').get(function daysUntilDue() {
  if (!this.dueDate) return 0;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.ceil((this.dueDate.getTime() - Date.now()) / MS_PER_DAY);
});

borrowRecordSchema.virtual('isActive').get(function isActive() {
  return !this.returnDate;
});

// ---------------------------------------------------------------------------
// Instance helpers
// ---------------------------------------------------------------------------

/** Mark this record returned. Caller is responsible for saving it. */
borrowRecordSchema.methods.markReturned = function markReturned(returnedAt = new Date(), librarianId = null) {
  this.returnDate = returnedAt;
  this.status = BORROW_STATUS.RETURNED;
  if (librarianId) this.receivedBy = librarianId;
  return this;
};

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

/**
 * Flip every still-issued record whose dueDate has passed to `overdue`.
 * Cheap to call on a timer; returns how many documents were touched.
 *
 * @returns {Promise<{matched: number, modified: number}>}
 */
borrowRecordSchema.statics.refreshOverdueStatuses = async function refreshOverdueStatuses() {
  const result = await this.updateMany(
    {
      status: BORROW_STATUS.ISSUED,
      returnDate: null,
      dueDate: { $lt: new Date() },
    },
    { $set: { status: BORROW_STATUS.OVERDUE } }
  );

  return { matched: result.matchedCount, modified: result.modifiedCount };
};

const BorrowRecord = mongoose.model('BorrowRecord', borrowRecordSchema);

module.exports = BorrowRecord;
module.exports.ACTIVE_LOAN_INDEX_NAME = 'uniq_active_book_member';
