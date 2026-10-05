'use strict';

const express = require('express');
const borrowController = require('../controllers/borrowController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const {
  issueBookSchema,
  returnBookSchema,
  borrowIdParamSchema,
  listBorrowsQuerySchema,
} = require('../validators/borrowValidators');

/**
 * Borrowing endpoints — mounted at /api so the paths match the assignment
 * exactly:
 *
 *   POST /api/borrow                    issue a book   (librarian only)
 *   POST /api/return/:borrowId          return a book  (librarian only)
 *
 * Plus read-side helpers used by the docs/requests examples:
 *
 *   GET  /api/borrows                   list borrow records
 *   GET  /api/borrows/:borrowId         one borrow record
 *   POST /api/borrows/refresh-overdue   sweep past-due loans into `overdue`
 */

const router = express.Router();

// --- the two required endpoints -------------------------------------------
router.post('/borrow', authenticate, validate({ body: issueBookSchema }), borrowController.issueBook);

router.post(
  '/return/:borrowId',
  authenticate,
  validate({ params: borrowIdParamSchema, body: returnBookSchema }),
  borrowController.returnBook
);

// --- supporting reads ------------------------------------------------------
router.post('/borrows/refresh-overdue', authenticate, borrowController.refreshOverdue);

router.get('/borrows', validate({ query: listBorrowsQuerySchema }), borrowController.listBorrows);

router.get('/borrows/:borrowId', validate({ params: borrowIdParamSchema }), borrowController.getBorrow);

module.exports = router;
