'use strict';

const express = require('express');
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const registerGuard = require('../middleware/bootstrapGuard');
const { loginSchema, registerLibrarianSchema, changePasswordSchema } = require('../validators/authValidators');

/**
 * /api/auth
 *
 *   POST  /login      issue a JWT                      (public, rate limited)
 *   POST  /register   create a librarian account       (open on an empty DB, then admin only)
 *   GET   /me         the account behind the token     (librarian only)
 *   PATCH /password   change your own password         (librarian only)
 */

const router = express.Router();

router.post('/login', authLimiter, validate({ body: loginSchema }), authController.login);

router.post('/register', authLimiter, registerGuard, validate({ body: registerLibrarianSchema }), authController.register);

router.get('/me', authenticate, authController.me);

router.patch('/password', authenticate, validate({ body: changePasswordSchema }), authController.changePassword);

module.exports = router;
