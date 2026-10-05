'use strict';

/**
 * Wrap an async Express handler so a rejected promise is forwarded to
 * `next()` instead of becoming an unhandled rejection. Removes the need for
 * try/catch in every controller.
 *
 * @param {(req, res, next) => Promise<any>} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('asyncHandler expects a function');
  }

  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
