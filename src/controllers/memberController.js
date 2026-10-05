'use strict';

const memberService = require('../services/memberService');
const borrowQueryService = require('../services/borrowQueryService');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { buildPaginationMeta } = require('../utils/pagination');
const { HTTP } = require('../config/constants');

/**
 * HTTP layer for /api/members.
 */

/** POST /api/members — register a new member (librarian only). */
const createMember = asyncHandler(async (req, res) => {
  const member = await memberService.createMember(req.body);

  return sendSuccess(
    res,
    HTTP.CREATED,
    `Member registered successfully with membership id ${member.membershipId}`,
    member
  );
});

/** GET /api/members — paginated list, optional ?status= and ?search=. */
const listMembers = asyncHandler(async (req, res) => {
  const { members, total, page, limit } = await memberService.listMembers(req.query);

  return sendSuccess(res, HTTP.OK, 'Members retrieved successfully', members, buildPaginationMeta(total, page, limit));
});

/** GET /api/members/:id */
const getMember = asyncHandler(async (req, res) => {
  const member = await memberService.getMemberById(req.params.id);
  return sendSuccess(res, HTTP.OK, 'Member retrieved successfully', member);
});

/** PATCH /api/members/:id */
const updateMember = asyncHandler(async (req, res) => {
  const member = await memberService.updateMember(req.params.id, req.body);
  return sendSuccess(res, HTTP.OK, 'Member updated successfully', member);
});

/** DELETE /api/members/:id */
const deleteMember = asyncHandler(async (req, res) => {
  const member = await memberService.deleteMember(req.params.id);
  return sendSuccess(res, HTTP.OK, `Member ${member.membershipId} deleted successfully`, {
    id: String(member._id),
  });
});

/**
 * GET /api/members/:id/history — a member's full borrow history.
 *
 *   ?status=active|issued|returned|overdue   filter by loan state
 *   &includeBook=false                       skip hydrating the book
 *   &page=&limit=&sort=                      pagination / ordering
 *
 * Responds with the member, the (paginated) records and a `summary` counting
 * how many are active, returned and overdue across their whole history.
 */
const getMemberHistory = asyncHandler(async (req, res) => {
  const { member, records, total, page, limit, summary } = await borrowQueryService.getMemberHistory(
    req.params.id,
    req.query
  );

  return sendSuccess(
    res,
    HTTP.OK,
    `Borrow history for ${member.name} (${member.membershipId}) retrieved successfully`,
    { member, summary, records },
    buildPaginationMeta(total, page, limit)
  );
});

module.exports = { createMember, listMembers, getMember, updateMember, deleteMember, getMemberHistory };
