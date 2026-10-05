'use strict';

const express = require('express');
const bookController = require('../controllers/bookController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const {
  createBookSchema,
  updateBookSchema,
  listBooksQuerySchema,
  bookIdParamSchema,
} = require('../validators/bookValidators');

/**
 * /api/books
 *
 *   POST   /        add a book               (librarian only)
 *   GET    /        list + filter + paginate (public)
 *   GET    /:id     single book              (public)
 *   PATCH  /:id     update a book            (librarian only)
 *   DELETE /:id     remove a book            (librarian only)
 */

const router = express.Router();

router
  .route('/')
  .post(authenticate, validate({ body: createBookSchema }), bookController.createBook)
  .get(validate({ query: listBooksQuerySchema }), bookController.listBooks);

router
  .route('/:id')
  .get(validate({ params: bookIdParamSchema }), bookController.getBook)
  .patch(authenticate, validate({ params: bookIdParamSchema, body: updateBookSchema }), bookController.updateBook)
  .delete(authenticate, validate({ params: bookIdParamSchema }), bookController.deleteBook);

module.exports = router;
