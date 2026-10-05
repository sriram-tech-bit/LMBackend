'use strict';

/**
 * Barrel file — require every model in one place so that:
 *  1. `mongoose.model('X')` lookups used by other modules always resolve, and
 *  2. callers do not need to know the file layout.
 */

const Book = require('./Book');
const Member = require('./Member');
const BorrowRecord = require('./BorrowRecord');
const Librarian = require('./Librarian');

module.exports = { Book, Member, BorrowRecord, Librarian };
