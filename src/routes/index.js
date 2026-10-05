'use strict';

const express = require('express');
const authRoutes = require('./authRoutes');
const bookRoutes = require('./bookRoutes');
const memberRoutes = require('./memberRoutes');
const borrowRoutes = require('./borrowRoutes');

/**
 * Mounts every feature router under /api.
 *
 * Paths therefore line up exactly with the assignment:
 *   /api/books, /api/members, /api/borrow, /api/return/:borrowId,
 *   /api/members/:id/history, plus /api/auth/login.
 */

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/books', bookRoutes);
router.use('/members', memberRoutes);
// Mounted at the root of /api because the required paths are /api/borrow and
// /api/return/:borrowId rather than /api/borrows/borrow.
router.use('/', borrowRoutes);

module.exports = router;
