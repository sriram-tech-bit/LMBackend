'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { LIBRARIAN_ROLE, LIBRARIAN_ROLE_VALUES } = require('../config/constants');

/**
 * Librarian
 * ---------------------------------------------------------------------------
 * The account that can log in and perform privileged actions (issue / return /
 * create books & members). Not part of the assignment's three entities — it
 * backs requirement (d), the JWT authentication layer.
 *
 * Security notes
 *  - The password is hashed with bcrypt before it is ever stored; the hash is
 *    excluded from queries by default (`select: false`) so it cannot leak into a
 *    response by accident.
 *  - `comparePassword` is the ONLY supported way to check a password.
 */

/** bcrypt cost factor — 12 is a good balance of safety and latency. */
const SALT_ROUNDS = 12;

const librarianSchema = new mongoose.Schema(
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
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Email must be a valid email address'],
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // never returned unless explicitly asked for
    },

    role: {
      type: String,
      enum: {
        values: LIBRARIAN_ROLE_VALUES,
        message: `role must be one of: ${LIBRARIAN_ROLE_VALUES.join(', ')}`,
      },
      default: LIBRARIAN_ROLE.LIBRARIAN,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    /** Issued-at timestamp of the current token family; bumping it revokes
     *  every token handed out before the change. */
    tokenValidFrom: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.password;
        return ret;
      },
    },
  }
);

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Hash the password whenever it is set or changed. */
librarianSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();

  try {
    this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
    return next();
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Instance helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison against the stored hash.
 * @param {string} candidate plain-text password from the login request
 * @returns {Promise<boolean>}
 */
librarianSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!candidate || !this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

/** Shape safe to embed in a login response. */
librarianSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
  };
};

const Librarian = mongoose.model('Librarian', librarianSchema);

module.exports = Librarian;
module.exports.SALT_ROUNDS = SALT_ROUNDS;
