'use strict';

const mongoose = require('mongoose');
const { MEMBER_STATUS, MEMBER_STATUS_VALUES } = require('../config/constants');

/**
 * Member
 * ---------------------------------------------------------------------------
 * Fields required by the assignment: name, email, membershipId, joinedDate
 *
 * Design notes
 *  - `email` and `membershipId` are both UNIQUE. Email is lower-cased on set so
 *    "Ada@Example.com" and "ada@example.com" are the same member.
 *  - `membershipId` is auto-generated (LIB-000123) when the client does not send
 *    one, so POST /api/members works with the minimum payload.
 *  - `joinedDate` defaults to "now" and is stored as a Date.
 *  - `status` lets a librarian suspend a member; suspended members cannot borrow.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MEMBERSHIP_ID_PATTERN = /^LIB-\d{6}$/;

/** Generate the next human-readable membership id: LIB-000001, LIB-000002, ... */
async function generateMembershipId() {
  const last = await mongoose
    .model('Member')
    .findOne({ membershipId: { $regex: /^LIB-\d{6}$/ } })
    .sort({ membershipId: -1 })
    .select('membershipId')
    .lean();

  const nextNumber = last ? Number.parseInt(last.membershipId.slice(4), 10) + 1 : 1;
  return `LIB-${String(nextNumber).padStart(6, '0')}`;
}

const memberSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [120, 'Name cannot exceed 120 characters'],
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (value) => EMAIL_PATTERN.test(value),
        message: 'Email must be a valid email address',
      },
    },

    membershipId: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true,
      validate: {
        validator: (value) => MEMBERSHIP_ID_PATTERN.test(value),
        message: 'membershipId must look like LIB-000123',
      },
    },

    joinedDate: {
      type: Date,
      default: Date.now,
      validate: {
        validator: (value) => !value || value <= new Date(Date.now() + 60_000),
        message: 'joinedDate cannot be in the future',
      },
    },

    phone: {
      type: String,
      trim: true,
      maxlength: [20, 'Phone cannot exceed 20 characters'],
    },

    status: {
      type: String,
      enum: {
        values: MEMBER_STATUS_VALUES,
        message: `status must be one of: ${MEMBER_STATUS_VALUES.join(', ')}`,
      },
      default: MEMBER_STATUS.ACTIVE,
      index: true,
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
// Hooks
// ---------------------------------------------------------------------------

memberSchema.pre('validate', async function assignMembershipId(next) {
  if (!this.membershipId) {
    try {
      this.membershipId = await generateMembershipId();
    } catch (error) {
      return next(error);
    }
  }
  return next();
});

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

/** The member's active (not yet returned) loans are read via BorrowRecord. */
memberSchema.virtual('borrowRecords', {
  ref: 'BorrowRecord',
  localField: '_id',
  foreignField: 'member',
});

memberSchema.virtual('isActive').get(function isActive() {
  return this.status === MEMBER_STATUS.ACTIVE;
});

memberSchema.index({ name: 1 });

const Member = mongoose.model('Member', memberSchema);

module.exports = Member;
module.exports.generateMembershipId = generateMembershipId;
module.exports.MEMBERSHIP_ID_PATTERN = MEMBERSHIP_ID_PATTERN;
module.exports.EMAIL_PATTERN = EMAIL_PATTERN;
