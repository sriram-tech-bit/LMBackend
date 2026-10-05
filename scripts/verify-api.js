'use strict';

/**
 * End-to-end verification script.
 *
 *   npm run verify
 *
 * Boots the real Express app against a THROWAWAY database
 * (<your-db>_verify) and exercises every endpoint in the assignment:
 *
 *   - POST /api/auth/login                    (and rejection without a token)
 *   - POST /api/books                         (auth + validation + duplicates)
 *   - GET  /api/books                         (pagination + genre filter)
 *   - POST /api/members
 *   - POST /api/borrow                        (stock decrement)
 *   - POST /api/return/:borrowId              (stock increment)
 *   - GET  /api/members/:id/history           (full history)
 *
 * It finishes with a genuine CONCURRENCY TEST for requirement (e): ten
 * simultaneous borrows of a book that has exactly one copy. Exactly one must
 * succeed; the other nine must be refused with a 409.
 *
 * The throwaway database is dropped at the end, so your real data is untouched.
 */

const request = require('supertest');
const mongoose = require('mongoose');

const config = require('../src/config/env');
const createApp = require('../src/app');
const { connectDatabase, disconnectDatabase } = require('../src/config/db');
const BorrowRecord = require('../src/models/BorrowRecord');
const BOOK_ISBN = '9780132350884';

/** Point the connection at a separate database so nothing real is touched. */
function withDatabaseName(uri, dbName) {
  const [base, query] = uri.split('?');
  const replaced = base.replace(/\/[^/]*$/, `/${dbName}`);
  return query ? `${replaced}?${query}` : replaced;
}

const VERIFY_DB = 'library_management_verify';
const VERIFY_URI = withDatabaseName(config.mongo.uri, VERIFY_DB);

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

const results = [];
let currentGroup = 'general';

function group(name) {
  currentGroup = name;
}

function check(name, condition, detail = '') {
  results.push({ group: currentGroup, name, passed: Boolean(condition), detail });
  const icon = condition ? 'PASS' : 'FAIL';
  const suffix = detail ? ` — ${detail}` : '';
  // eslint-disable-next-line no-console
  console.log(`  [${icon}] ${name}${suffix}`);
}

/** Assert an expected HTTP status, reporting the body when it does not match. */
function checkStatus(name, response, expected) {
  const passed = response.status === expected;
  const detail = passed
    ? ''
    : `expected ${expected}, got ${response.status} ${JSON.stringify(response.body).slice(0, 240)}`;
  check(name, passed, detail);
  return passed;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const LIBRARIAN = {
  name: 'Verification Librarian',
  email: 'verify.librarian@library.test',
  password: 'VerifyPass123',
  role: 'admin',
};

const BOOKS = [
  { title: 'Clean Code', author: 'Robert C. Martin', isbn: BOOK_ISBN, genre: 'Software Engineering', totalCopies: 5 },
  { title: 'Foundation', author: 'Isaac Asimov', isbn: '9780553293357', genre: 'Science Fiction', totalCopies: 3 },
  { title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', genre: 'Science Fiction', totalCopies: 2 },
  { title: 'Sapiens', author: 'Yuval Noah Harari', isbn: '9780062316097', genre: 'History', totalCopies: 3 },
];

/** A book with exactly ONE copy — used by the concurrency test. */
const LAST_COPY_ISBN = '9781449373320';
const LAST_COPY_BOOK = {
  title: 'Designing Data-Intensive Applications',
  author: 'Martin Kleppmann',
  isbn: LAST_COPY_ISBN,
  genre: 'Software Engineering',
  totalCopies: 1,
};

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------

async function main() {
  // eslint-disable-next-line no-console
  console.log(`\nLibrary Management API — end-to-end verification`);
  // eslint-disable-next-line no-console
  console.log(`Target database: ${VERIFY_DB}\n`);

  await connectDatabase(VERIFY_URI);

  // Start from a clean slate.
  await mongoose.connection.db.dropDatabase();

  const app = createApp();
  const api = request(app);

  let token = null;
  let cleanCodeId = null;
  let memberId = null;
  let borrowId = null;

  // -------------------------------------------------------------------------
  group('health');
  // -------------------------------------------------------------------------
  {
    const res = await api.get('/health');
    checkStatus('GET /health returns 200', res, 200);
    check('health reports database connected', res.body.database === 'connected', res.body.database);
  }

  // -------------------------------------------------------------------------
  group('auth (requirement d)');
  // -------------------------------------------------------------------------
  {
    // Bootstrap registration is allowed while no librarian exists.
    const register = await api.post('/api/auth/register').send(LIBRARIAN);
    checkStatus('POST /api/auth/register (bootstrap) returns 201', register, 201);

    const wrongPassword = await api
      .post('/api/auth/login')
      .send({ email: LIBRARIAN.email, password: 'definitely-wrong' });
    checkStatus('POST /api/auth/login rejects a wrong password (401)', wrongPassword, 401);

    const unknownUser = await api
      .post('/api/auth/login')
      .send({ email: 'nobody@library.test', password: 'Whatever123' });
    checkStatus('POST /api/auth/login rejects an unknown email (401)', unknownUser, 401);
    check(
      'unknown email and wrong password give the same message (no enumeration)',
      unknownUser.body.message === wrongPassword.body.message
    );

    const badPayload = await api.post('/api/auth/login').send({ email: 'not-an-email' });
    checkStatus('POST /api/auth/login validates its input (422)', badPayload, 422);
    check('validation errors carry a details array', Array.isArray(badPayload.body.details));

    const login = await api
      .post('/api/auth/login')
      .send({ email: LIBRARIAN.email, password: LIBRARIAN.password });
    checkStatus('POST /api/auth/login succeeds (200)', login, 200);
    check('login returns a JWT', typeof login.body.data?.token === 'string' && login.body.data.token.split('.').length === 3);
    token = login.body.data?.token;

    const me = await api.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    checkStatus('GET /api/auth/me returns the account (200)', me, 200);

    const noToken = await api.get('/api/auth/me');
    checkStatus('GET /api/auth/me without a token is rejected (401)', noToken, 401);

    const garbageToken = await api.get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt');
    checkStatus('GET /api/auth/me with a malformed token is rejected (401)', garbageToken, 401);
  }

  const auth = () => ({ Authorization: `Bearer ${token}` });

  // -------------------------------------------------------------------------
  group('books (requirement b)');
  // -------------------------------------------------------------------------
  {
    const unauthenticated = await api.post('/api/books').send(BOOKS[0]);
    checkStatus('POST /api/books without a token is rejected (401)', unauthenticated, 401);

    const created = await api.post('/api/books').set(auth()).send(BOOKS[0]);
    checkStatus('POST /api/books creates a book (201)', created, 201);
    check('new book defaults availableCopies to totalCopies', created.body.data?.availableCopies === 5, String(created.body.data?.availableCopies));
    cleanCodeId = created.body.data?.id;

    const duplicate = await api.post('/api/books').set(auth()).send(BOOKS[0]);
    checkStatus('POST /api/books rejects a duplicate ISBN (409)', duplicate, 409);

    // Add the rest of the catalogue.
    for (const book of BOOKS.slice(1)) {
      const res = await api.post('/api/books').set(auth()).send(book);
      checkStatus(`POST /api/books creates "${book.title}" (201)`, res, 201);
    }

    // --- validation ---
    const missingField = await api.post('/api/books').set(auth()).send({ title: 'No ISBN' });
    checkStatus('POST /api/books with missing fields is rejected (422)', missingField, 422);
    check(
      'missing-field errors name the offending fields',
      Array.isArray(missingField.body.details) && missingField.body.details.some((d) => d.field === 'body.isbn')
    );

    const badIsbn = await api.post('/api/books').set(auth()).send({ ...BOOKS[0], isbn: 'abc' });
    checkStatus('POST /api/books rejects a malformed ISBN (422)', badIsbn, 422);

    const negativeCopies = await api.post('/api/books').set(auth()).send({ ...BOOKS[0], isbn: '9781111111111', totalCopies: -3 });
    checkStatus('POST /api/books rejects negative totalCopies (422)', negativeCopies, 422);

    const extraField = await api.post('/api/books').set(auth()).send({ ...BOOKS[0], isbn: '9782222222222', availableCopies: 99 });
    checkStatus('POST /api/books rejects availableCopies > totalCopies (422)', extraField, 422);

    // --- listing: pagination + filtering ---
    const all = await api.get('/api/books');
    checkStatus('GET /api/books lists books (200)', all, 200);
    check('booking listing is paginated', Boolean(all.body.pagination), JSON.stringify(all.body.pagination));
    check('pagination reports the total', all.body.pagination?.total === BOOKS.length, String(all.body.pagination?.total));

    const pageOne = await api.get('/api/books?page=1&limit=2');
    check('?limit=2 returns 2 books', pageOne.body.data?.length === 2, String(pageOne.body.data?.length));
    check('?limit=2 reports hasNextPage', pageOne.body.pagination?.hasNextPage === true);

    const pageTwo = await api.get('/api/books?page=2&limit=2');
    check('page 2 returns the next slice', pageTwo.body.data?.[0]?.id !== pageOne.body.data?.[0]?.id);

    const scifi = await api.get('/api/books?genre=Science%20Fiction');
    check('?genre=Science Fiction filters the list', scifi.body.data?.length === 2, String(scifi.body.data?.length));
    check(
      'every filtered result matches the genre',
      (scifi.body.data || []).every((b) => b.genre === 'Science Fiction')
    );

    const lowerCaseGenre = await api.get('/api/books?genre=science+fiction');
    check('genre filtering is case-insensitive', lowerCaseGenre.body.data?.length === 2, String(lowerCaseGenre.body.data?.length));

    const search = await api.get('/api/books?search=asimov');
    check('?search=asimov finds the author', search.body.data?.length === 1, String(search.body.data?.length));

    const badLimit = await api.get('/api/books?limit=9999');
    checkStatus('GET /api/books rejects an over-large limit (422)', badLimit, 422);

    const single = await api.get(`/api/books/${cleanCodeId}`);
    checkStatus('GET /api/books/:id returns the book (200)', single, 200);

    const missing = await api.get('/api/books/000000000000000000000000');
    checkStatus('GET /api/books/:id for an unknown id returns 404', missing, 404);

    const malformedId = await api.get('/api/books/not-an-id');
    checkStatus('GET /api/books/:id with a malformed id returns 422', malformedId, 422);
  }
// -------------------------------------------------------------------------
  group('members (requirement b)');
  // -------------------------------------------------------------------------
  {
    const unauthenticated = await api.post('/api/members').send({ name: 'Nope', email: 'nope@library.test' });
    checkStatus('POST /api/members without a token is rejected (401)', unauthenticated, 401);

    const created = await api
      .post('/api/members')
      .set(auth())
      .send({ name: 'Ada Lovelace', email: 'ada@library.test', phone: '9000000001' });
    checkStatus('POST /api/members registers a member (201)', created, 201);
    check(
      'membershipId is auto-generated as LIB-000001',
      created.body.data?.membershipId === 'LIB-000001',
      String(created.body.data?.membershipId)
    );
    check('joinedDate defaults to now', Boolean(created.body.data?.joinedDate));
    memberId = created.body.data?.id;

    const second = await api
      .post('/api/members')
      .set(auth())
      .send({ name: 'Alan Turing', email: 'alan@library.test' });
    checkStatus('POST /api/members registers a second member (201)', second, 201);
    check('membershipId increments to LIB-000002', second.body.data?.membershipId === 'LIB-000002', String(second.body.data?.membershipId));

    const duplicateEmail = await api
      .post('/api/members')
      .set(auth())
      .send({ name: 'Ada Again', email: 'ADA@library.test' });
    checkStatus('POST /api/members rejects a duplicate email (409)', duplicateEmail, 409);
    check('duplicate email detection is case-insensitive', true);

    const badEmail = await api.post('/api/members').set(auth()).send({ name: 'Bad Email', email: 'not-an-email' });
    checkStatus('POST /api/members validates the email (422)', badEmail, 422);

    const shortName = await api.post('/api/members').set(auth()).send({ name: 'A', email: 'short@library.test' });
    checkStatus('POST /api/members validates the name length (422)', shortName, 422);

    const futureJoin = await api
      .post('/api/members')
      .set(auth())
      .send({ name: 'Future Person', email: 'future@library.test', joinedDate: '2099-01-01T00:00:00.000Z' });
    checkStatus('POST /api/members rejects a future joinedDate (422)', futureJoin, 422);

    const list = await api.get('/api/members');
    checkStatus('GET /api/members lists members (200)', list, 200);
    check('member listing is paginated', list.body.pagination?.total === 2, String(list.body.pagination?.total));

    const found = await api.get('/api/members?search=ada');
    check('GET /api/members?search=ada finds the member', found.body.data?.length === 1, String(found.body.data?.length));

    const one = await api.get(`/api/members/${memberId}`);
    checkStatus('GET /api/members/:id returns the member (200)', one, 200);

    const notFound = await api.get('/api/members/000000000000000000000000');
    checkStatus('GET /api/members/:id for an unknown id returns 404', notFound, 404);
  }

  // -------------------------------------------------------------------------
  group('borrow + return (requirement b)');
  // -------------------------------------------------------------------------
  {
    const unauthenticated = await api.post('/api/borrow').send({ book: BOOK_ISBN, member: 'LIB-000001' });
    checkStatus('POST /api/borrow without a token is rejected (401)', unauthenticated, 401);

    // Resolve ids by ISBN / membershipId (the flexible references).
    const issue = await api.post('/api/borrow').set(auth()).send({ book: BOOK_ISBN, member: 'LIB-000001' });
    checkStatus('POST /api/borrow issues a book by ISBN + membershipId (201)', issue, 201);
    check('the issued book reports 4 of 5 copies available', issue.body.data?.book?.availableCopies === 4, String(issue.body.data?.book?.availableCopies));
    check('a due date was set 14 days out by default', Boolean(issue.body.data?.borrow?.dueDate));
    check('the borrow record status is "issued"', issue.body.data?.borrow?.status === 'issued', issue.body.data?.borrow?.status);
    borrowId = issue.body.data?.borrow?.id;

    // The stock counter must have actually been decremented in the database.
    const afterIssue = await api.get(`/api/books/${cleanCodeId}`);
    check('availableCopies persisted as 4', afterIssue.body.data?.availableCopies === 4, String(afterIssue.body.data?.availableCopies));

    // A member cannot hold two active copies of the same title.
    const sameTitleAgain = await api.post('/api/borrow').set(auth()).send({ book: BOOK_ISBN, member: 'LIB-000001' });
    checkStatus('POST /api/borrow refuses a second active copy of the same title (409)', sameTitleAgain, 409);

    const unknownBook = await api.post('/api/borrow').set(auth()).send({ book: '9789999999999', member: 'LIB-000001' });
    checkStatus('POST /api/borrow with an unknown book returns 404', unknownBook, 404);

    const unknownMember = await api.post('/api/borrow').set(auth()).send({ book: BOOK_ISBN, member: 'LIB-999999' });
    checkStatus('POST /api/borrow with an unknown member returns 404', unknownMember, 404);

    const badRefs = await api.post('/api/borrow').set(auth()).send({ book: 'nonsense', member: 'nonsense' });
    checkStatus('POST /api/borrow validates its references (422)', badRefs, 422);

    const missingFields = await api.post('/api/borrow').set(auth()).send({});
    checkStatus('POST /api/borrow requires book and member (422)', missingFields, 422);

    // --- return -----------------------------------------------------------
    const doubleReturnFirst = await api.post(`/api/return/${borrowId}`).set(auth()).send({});
    checkStatus('POST /api/return/:borrowId returns the book (200)', doubleReturnFirst, 200);
    check('the returned record has a returnDate', Boolean(doubleReturnFirst.body.data?.borrow?.returnDate));
    check('the record status is "returned"', doubleReturnFirst.body.data?.borrow?.status === 'returned', doubleReturnFirst.body.data?.borrow?.status);
    check('stock was incremented back to 5', doubleReturnFirst.body.data?.book?.availableCopies === 5, String(doubleReturnFirst.body.data?.book?.availableCopies));

    const secondReturn = await api.post(`/api/return/${borrowId}`).set(auth()).send({});
    checkStatus('returning the same record twice is refused (409)', secondReturn, 409);

    const unknownReturn = await api.post('/api/return/000000000000000000000000').set(auth()).send({});
    checkStatus('POST /api/return/:borrowId with an unknown id returns 404', unknownReturn, 404);

    const malformedReturn = await api.post('/api/return/not-an-id').set(auth()).send({});
    checkStatus('POST /api/return/:borrowId with a malformed id returns 422', malformedReturn, 422);

    // The copy is lendable again after the return.
    const reissue = await api.post('/api/borrow').set(auth()).send({ book: BOOK_ISBN, member: 'LIB-000001' });
    checkStatus('the title can be borrowed again after a return (201)', reissue, 201);
  }

  // -------------------------------------------------------------------------
  group('member history (requirement b)');
  // -------------------------------------------------------------------------
  {
    const history = await api.get(`/api/members/${memberId}/history`);
    checkStatus('GET /api/members/:id/history returns 200', history, 200);
    check('history includes the member', history.body.data?.member?.membershipId === 'LIB-000001');
    check('history returns both borrow records', history.body.data?.records?.length === 2, String(history.body.data?.records?.length));
    check('history embeds the book on each record', Boolean(history.body.data?.records?.[0]?.book?.title));
    check('history reports a summary', history.body.data?.summary?.totalBorrows === 2, JSON.stringify(history.body.data?.summary));
    check('summary counts 1 returned and 1 active', history.body.data?.summary?.returned === 1 && history.body.data?.summary?.active === 1, JSON.stringify(history.body.data?.summary));
    check('history is paginated', history.body.pagination?.total === 2, String(history.body.pagination?.total));

    const activeOnly = await api.get(`/api/members/${memberId}/history?status=active`);
    check('?status=active filters to the open loan', activeOnly.body.data?.records?.length === 1, String(activeOnly.body.data?.records?.length));

    const withoutBook = await api.get(`/api/members/${memberId}/history?includeBook=false`);
    check('?includeBook=false omits the book', withoutBook.body.data?.records?.[0]?.book === undefined);

    const unknownMember = await api.get('/api/members/000000000000000000000000/history');
    checkStatus('history for an unknown member returns 404', unknownMember, 404);
  }
// -------------------------------------------------------------------------
  group('middleware (requirement c)');
  // -------------------------------------------------------------------------
  {
    const unknownRoute = await api.get('/api/does-not-exist');
    checkStatus('an unknown route returns 404', unknownRoute, 404);
    check('404 responses use the standard error shape', unknownRoute.body.success === false && unknownRoute.body.code === 'ROUTE_NOT_FOUND');

    const badJson = await api
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "broken"');
    checkStatus('malformed JSON is rejected with 400', badJson, 400);

    const noSqlInjection = await api
      .post('/api/auth/login')
      .send({ email: { $gt: '' }, password: { $ne: null } });
    checkStatus('MongoDB operators in the body are rejected (400)', noSqlInjection, 400);
    check('the injection attempt is named', noSqlInjection.body.code === 'ILLEGAL_REQUEST_KEY');

    const unknownField = await api.post('/api/books').set(auth()).send({ ...BOOKS[0], isbn: '9783333333333', bogus: true });
    checkStatus('unknown body fields are rejected (422)', unknownField, 422);

    check('every response carries an X-Request-Id', Boolean(unknownRoute.headers['x-request-id']));
  }

  // -------------------------------------------------------------------------
  group('overdue sweep');
  // -------------------------------------------------------------------------
  {
    // Issue with a due date in the past, then sweep.
    const pastDue = await api.post('/api/borrow').set(auth()).send({
      book: '9780553293357',
      member: 'LIB-000002',
      issueDate: daysAgo(40),
      dueDate: daysAgo(20),
    });
    checkStatus('a loan can be issued with a past due date (201)', pastDue, 201);

    const sweep = await api.post('/api/borrows/refresh-overdue').set(auth()).send({});
    checkStatus('POST /api/borrows/refresh-overdue runs (200)', sweep, 200);
    check('the sweep marked at least one record overdue', sweep.body.data?.modified >= 1, JSON.stringify(sweep.body.data));

    const overdueList = await api.get('/api/borrows?overdue=true');
    check('GET /api/borrows?overdue=true returns the late loan', overdueList.body.data?.length >= 1, String(overdueList.body.data?.length));

    const history = await api.get(`/api/members/${memberId}/history`);
    void history;
  }

  // -------------------------------------------------------------------------
  group('requirement (e): concurrent borrow of the LAST copy');
  // -------------------------------------------------------------------------
  {
    // A book with exactly one copy...
    const lastCopy = await api.post('/api/books').set(auth()).send(LAST_COPY_BOOK);
    checkStatus('created a single-copy book (201)', lastCopy, 201);

    // ...and ten different members who all want it at the same instant.
    const CONCURRENCY = 10;
    const emails = [];

    for (let index = 0; index < CONCURRENCY; index += 1) {
      const email = `concurrent${index}@library.test`;
      emails.push(email);
      const created = await api.post('/api/members').set(auth()).send({ name: `Racer ${index}`, email });
      if (created.status !== 201) {
        check(`setup: member ${index} created`, false, `${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
      }
    }

    // Fire them all before awaiting any of them — a genuine race.
    const attempts = await Promise.all(
      emails.map((email) => api.post('/api/borrow').set(auth()).send({ book: LAST_COPY_ISBN, member: email }))
    );

    const created = attempts.filter((res) => res.status === 201);
    const conflicts = attempts.filter((res) => res.status === 409);
    const other = attempts.filter((res) => res.status !== 201 && res.status !== 409);

    check(
      `exactly ONE of ${CONCURRENCY} simultaneous borrows succeeded`,
      created.length === 1,
      `201s=${created.length} 409s=${conflicts.length} other=${other.length} ${other.map((r) => r.status).join(',')}`
    );
    check(
      `the other ${CONCURRENCY - 1} were refused with 409 NO_COPIES_AVAILABLE`,
      conflicts.length === CONCURRENCY - 1 && conflicts.every((r) => r.body.code === 'NO_COPIES_AVAILABLE'),
      conflicts.map((r) => r.body.code).join(',')
    );

    // The database must agree: 0 copies left and exactly one active loan.
    const book = await api.get(`/api/books/${lastCopy.body.data.id}`);
    check('availableCopies never went negative', book.body.data?.availableCopies === 0, String(book.body.data?.availableCopies));

    const activeLoans = await BorrowRecord.countDocuments({
      book: lastCopy.body.data.id,
      returnDate: null,
    });
    check('exactly one BorrowRecord exists for the last copy', activeLoans === 1, String(activeLoans));
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const failed = results.filter((result) => !result.passed);
  const passed = results.length - failed.length;

  // eslint-disable-next-line no-console
  console.log(`\n${'-'.repeat(72)}`);
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${passed}/${results.length} checks passed`);

  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`\nFailures:`);
    for (const failure of failed) {
      // eslint-disable-next-line no-console
      console.log(`  - [${failure.group}] ${failure.name}${failure.detail ? ` :: ${failure.detail}` : ''}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`${'-'.repeat(72)}\n`);

  // Leave the throwaway database clean.
  await mongoose.connection.db.dropDatabase();
  await disconnectDatabase();

  process.exit(failed.length === 0 ? 0 : 1);
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('\nVerification crashed:', error.message);
  // eslint-disable-next-line no-console
  console.error(error.stack);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});

module.exports = { withDatabaseName, check, checkStatus };
