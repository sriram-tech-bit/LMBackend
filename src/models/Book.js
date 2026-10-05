'use strict';

const mongoose = require('mongoose');

/**
 * Book
 * ---------------------------------------------------------------------------
 * Fields required by the assignment:
 *   title, author, ISBN, genre, totalCopies, availableCopies
 *
 * Design notes
 *  - `isbn` is UNIQUE (unique index) and normalised (hyphens/spaces stripped)
 *    so "978-0-13-235088-4" and "9780132350884" cannot both be stored.
 *  - `availableCopies` can never exceed `totalCopies` nor drop below 0 — enforced
 *    by schema-level validators so no code path can corrupt the counters.
 *  - `availableCopies` defaults to `totalCopies` when a new book is created.
 *  - Both counters are stored so a client can show "3 of 5 available" without an
 *    extra aggregation.
 */

/** Strip hyphens and whitespace; upper-case a trailing 'X' check digit. */
function normaliseIsbn(value) {
  return String(value).replace(/[\s-]/g, '').toUpperCase();
}

const ISBN_PATTERN = /^(?:\d{9}[\dX]|\d{13})$/;

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [1, 'Title cannot be empty'],
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },

    author: {
      type: String,
      required: [true, 'Author is required'],
      trim: true,
      minlength: [1, 'Author cannot be empty'],
      maxlength: [150, 'Author cannot exceed 150 characters'],
    },

    isbn: {
      type: String,
      required: [true, 'ISBN is required'],
      unique: true,
      trim: true,
      set: normaliseIsbn,
      validate: {
        validator: (value) => ISBN_PATTERN.test(value),
        message: 'ISBN must be a valid 10- or 13-digit ISBN (hyphens allowed)',
      },
    },

    genre: {
      type: String,
      required: [true, 'Genre is required'],
      trim: true,
      maxlength: [80, 'Genre cannot exceed 80 characters'],
      index: true, // GET /api/books?genre=... filters on this
    },

    totalCopies: {
      type: Number,
      required: [true, 'totalCopies is required'],
      min: [0, 'totalCopies cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'totalCopies must be a whole number',
      },
    },

    availableCopies: {
      type: Number,
      min: [0, 'availableCopies cannot be negative'],
      validate: [
        {
          validator: Number.isInteger,
          message: 'availableCopies must be a whole number',
        },
        {
          // Runs on full document validation; `this` is the document being saved.
          validator(value) {
            if (value === undefined || value === null) return true;
            return value <= this.totalCopies;
          },
          message: 'availableCopies cannot be greater than totalCopies',
        },
      ],
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

/** Default availableCopies to totalCopies when a new book is created. */
bookSchema.pre('validate', function defaultAvailableCopies(next) {
  if (this.isNew && (this.availableCopies === undefined || this.availableCopies === null)) {
    this.availableCopies = this.totalCopies;
  }
  next();
});

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

bookSchema.virtual('borrowedCopies').get(function borrowedCopies() {
  return this.totalCopies - this.availableCopies;
});

bookSchema.virtual('isAvailable').get(function isAvailable() {
  return this.availableCopies > 0;
});

/** Full-text search across title/author (used by ?search=). */
bookSchema.index({ title: 'text', author: 'text' });

const Book = mongoose.model('Book', bookSchema);

module.exports = Book;
module.exports.normaliseIsbn = normaliseIsbn;
module.exports.ISBN_PATTERN = ISBN_PATTERN;
module.exports.ISBN_INDEX_NAME = 'isbn_1';
