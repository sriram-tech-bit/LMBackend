'use strict';

const express = require('express');
const memberController = require('../controllers/memberController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const {
  createMemberSchema,
  updateMemberSchema,
  listMembersQuerySchema,
  memberIdParamSchema,
  memberHistoryQuerySchema,
} = require('../validators/memberValidators');

/**
 * /api/members
 *
 *   POST   /                register a member             (librarian only)
 *   GET    /                list + search + paginate
 *   GET    /:id             one member
 *   PATCH  /:id             update / suspend a member     (librarian only)
 *   DELETE /:id             remove a member               (librarian only)
 *   GET    /:id/history     full borrow history           <-- required endpoint
 */

const router = express.Router();

router
  .route('/')
  .post(authenticate, validate({ body: createMemberSchema }), memberController.createMember)
  .get(validate({ query: listMembersQuerySchema }), memberController.listMembers);

// Declared before '/:id' purely for readability — Express cannot confuse the
// two, since '/:id' only ever matches a single path segment.
router.get(
  '/:id/history',
  validate({ params: memberIdParamSchema, query: memberHistoryQuerySchema }),
  memberController.getMemberHistory
);

router
  .route('/:id')
  .get(validate({ params: memberIdParamSchema }), memberController.getMember)
  .patch(authenticate, validate({ params: memberIdParamSchema, body: updateMemberSchema }), memberController.updateMember)
  .delete(authenticate, validate({ params: memberIdParamSchema }), memberController.deleteMember);

module.exports = router;
