'use strict';

/**
 * Seeds a usable dataset:
 *   - one librarian account (credentials come from .env)
 *   - a small set of books and members
 *   - optionally a couple of active loans
 *
 * Safe to re-run: every step is an upsert / "create only if missing".
 *
 *   npm run seed
 */

const config = require('../src/config/env');
const logger = require('../src/utils/logger');
const { connectDatabase, disconnectDatabase, maskUri } = require('../src/config/db');
const { Book, Member, Librarian, BorrowRecord } = require('../src/models');
const { issueBook } = require('../src/services/borrowService');
const { BORROW_STATUS, LIBRARIAN_ROLE } = require('../src/config/constants');

const SAMPLE_BOOKS = [
  { title: 'Clean Code', author: 'Robert C. Martin', isbn: '9780132350884', genre: 'Software Engineering', totalCopies: 5 },
  { title: 'The Pragmatic Programmer', author: 'Andrew Hunt', isbn: '9780201616224', genre: 'Software Engineering', totalCopies: 3 },
  { title: 'Foundation', author: 'Isaac Asimov', isbn: '9780553293357', genre: 'Science Fiction', totalCopies: 4 },
  { title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', genre: 'Science Fiction', totalCopies: 2 },
  { title: 'Sapiens', author: 'Yuval Noah Harari', isbn: '9780062316097', genre: 'History', totalCopies: 3 },
  { title: 'The Hobbit', author: 'J. R. R. Tolkien', isbn: '9780547928227', genre: 'Fantasy', totalCopies: 6 },
  { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', isbn: '9780374533557', genre: 'Psychology', totalCopies: 2 },
  { title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', isbn: '9781449373320', genre: 'Software Engineering', totalCopies: 1 },
];

const SAMPLE_MEMBERS = [
  { name: 'Ada Lovelace', email: 'ada@library.test', membershipId: 'LIB-000001', phone: '9000000001' },
  { name: 'Alan Turing', email: 'alan@library.test', membershipId: 'LIB-000002', phone: '9000000002' },
  { name: 'Grace Hopper', email: 'grace@library.test', membershipId: 'LIB-000003', phone: '9000000003' },
  { name: 'Katherine Johnson', email: 'katherine@library.test', membershipId: 'LIB-000004', phone: '9000000004' },
];

async function seedLibrarian() {
  const email = config.seed.librarianEmail.toLowerCase();
  const existing = await Librarian.findOne({ email });

  if (existing) {
    logger.info('Librarian already exists — leaving it untouched', { email });
    return existing;
  }

  // Creating directly (rather than through the service) so we can set role,
  // but still going through the schema so the password is hashed.
  const librarian = await Librarian.create({
    name: config.seed.librarianName,
    email,
    password: config.seed.librarianPassword,
    role: LIBRARIAN_ROLE.ADMIN,
  });

  logger.info('Created librarian account', { email });
  return librarian;
}

async function seedBooks() {
  const created = [];

  for (const definition of SAMPLE_BOOKS) {
    const existing = await Book.findOne({ isbn: definition.isbn });
    if (existing) continue;

    created.push(await Book.create(definition));
  }

  logger.info(`Books: ${created.length} created, ${SAMPLE_BOOKS.length - created.length} already present`);
  return created;
}

async function seedMembers() {
  const created = [];

  for (const definition of SAMPLE_MEMBERS) {
    const existing = await Member.findOne({ email: definition.email });
    if (existing) continue;

    created.push(await Member.create(definition));
  }

  logger.info(`Members: ${created.length} created, ${SAMPLE_MEMBERS.length - created.length} already present`);
  return created;
}

/**
 * Issue a couple of books so GET /api/members/:id/history and
 * GET /api/borrows return something interesting straight away.
 */
async function seedLoans(librarian) {
  const activeLoans = await BorrowRecord.countDocuments({ returnDate: null });
  if (activeLoans > 0) {
    logger.info('Borrow records already exist — skipping the sample loans');
    return [];
  }

  const ada = await Member.findOne({ membershipId: 'LIB-000001' });
  const alan = await Member.findOne({ membershipId: 'LIB-000002' });
  const cleanCode = await Book.findOne({ isbn: '9780132350884' });
  const dune = await Book.findOne({ isbn: '9780441013593' });

  const issued = [];

  if (ada && cleanCode) {
    const { borrow } = await issueBook({
      book: String(cleanCode._id),
      member: String(ada._id),
      librarianId: librarian?._id,
    });
    issued.push(borrow);
  }

  if (alan && dune) {
    // Back-date this one so it is already overdue, which exercises the
    // `overdue` status and the sweep.
    const { borrow } = await issueBook({
      book: String(dune._id),
      member: String(alan._id),
      issueDate: daysAgo(30),
      dueDate: daysAgo(16),
      librarianId: librarian?._id,
    });
    borrow.status = BORROW_STATUS.OVERDUE;
    await borrow.save();
    issued.push(borrow);
  }

  logger.info(`Created ${issued.length} sample borrow record(s)`);
  return issued;
}

/** A Date `n` days in the past. */
function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function run() {
  logger.info('Seeding database', { uri: maskUri(config.mongo.uri) });

  await connectDatabase();

  const librarian = await seedLibrarian();
  await seedBooks();
  await seedMembers();
  await seedLoans(librarian);

  const counts = await Promise.all([
    Librarian.countDocuments(),
    Book.countDocuments(),
    Member.countDocuments(),
    BorrowRecord.countDocuments(),
  ]);

  logger.info('Seed complete', {
    librarians: counts[0],
    books: counts[1],
    members: counts[2],
    borrowRecords: counts[3],
  });

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '  ── Login credentials ──────────────────────────────────────────',
      `   email:    ${config.seed.librarianEmail}`,
      `   password: ${config.seed.librarianPassword}`,
      '',
      '   POST http://localhost:' + config.port + '/api/auth/login',
      '  ────────────────────────────────────────────────────────────────',
      '',
    ].join('\n')
  );
}

run()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('Seed failed', { message: error.message, stack: error.stack });
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
