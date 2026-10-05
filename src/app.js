'use strict';

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const config = require('./config/env');
const routes = require('./routes');
const { attachRequestId, requestLogger, logRequestBody } = require('./middleware/requestLogger');
const { securityHeaders, apiLimiter, rejectMongoOperators } = require('./middleware/security');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { HTTP } = require('./config/constants');

/**
 * Builds the Express application.
 *
 * Kept separate from server.js so the app can be imported by the test suite
 * without opening a port.
 */

function createApp() {
  const app = express();

  // Behind nginx / a hosting proxy, trust one hop so req.ip is the real client.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // --- cross-cutting middleware, in order --------------------------------
  app.use(securityHeaders);
  app.use(cors({ origin: config.cors.origin === '*' ? true : config.cors.origin.split(','), credentials: true }));

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  app.use(attachRequestId);
  app.use(requestLogger);
  app.use(logRequestBody);

  // --- API --------------------------------------------------------------
  app.use('/api', rejectMongoOperators, apiLimiter, routes);

  // --- health / index ---------------------------------------------------
  app.get('/health', healthCheck);
  app.get('/api/health', healthCheck);
  app.get('/', indexResponse);

  // --- terminal middleware ----------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Liveness probe — also reports whether the database is connected. */
function healthCheck(_req, res) {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = states[mongoose.connection.readyState] || 'unknown';
  const isHealthy = mongoose.connection.readyState === 1;

  return res.status(isHealthy ? HTTP.OK : HTTP.SERVICE_UNAVAILABLE).json({
    success: isHealthy,
    status: isHealthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    database: dbState,
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
}

/** Human-readable index so hitting the base URL is not a dead end. */
function indexResponse(_req, res) {
  return res.status(HTTP.OK).json({
    success: true,
    name: 'Library Management API',
    version: require('../package.json').version,
    documentation: 'README.md',
    health: '/health',
    endpoints: {
      auth: {
        login: 'POST /api/auth/login',
        register: 'POST /api/auth/register',
        me: 'GET /api/auth/me',
        changePassword: 'PATCH /api/auth/password',
      },
      books: {
        create: 'POST /api/books  (librarian)',
        list: 'GET /api/books?genre=&search=&available=&page=&limit=',
        detail: 'GET /api/books/:id',
        update: 'PATCH /api/books/:id  (librarian)',
        remove: 'DELETE /api/books/:id  (librarian)',
      },
      members: {
        create: 'POST /api/members  (librarian)',
        list: 'GET /api/members?search=&status=&page=&limit=',
        detail: 'GET /api/members/:id',
        history: 'GET /api/members/:id/history',
        update: 'PATCH /api/members/:id  (librarian)',
        remove: 'DELETE /api/members/:id  (librarian)',
      },
      borrowing: {
        issue: 'POST /api/borrow  (librarian)',
        return: 'POST /api/return/:borrowId  (librarian)',
        list: 'GET /api/borrows?status=&overdue=&member=&book=',
        detail: 'GET /api/borrows/:borrowId',
        refreshOverdue: 'POST /api/borrows/refresh-overdue  (librarian)',
      },
    },
  });
}

module.exports = createApp;
module.exports.createApp = createApp;
