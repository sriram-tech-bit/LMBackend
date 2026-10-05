'use strict';

/**
 * Barrel for request schemas — validators are consumed by the `validate`
 * middleware as `validate({ body: ..., query: ..., params: ... })`.
 */

const bookValidators = require('./bookValidators');
const memberValidators = require('./memberValidators');
const borrowValidators = require('./borrowValidators');
const authValidators = require('./authValidators');
const common = require('./common');

module.exports = {
  ...bookValidators,
  ...memberValidators,
  ...borrowValidators,
  ...authValidators,
  objectId: common.objectId,
  isoDateString: common.isoDateString,
  resolveSort: common.resolveSort,
};
