'use strict';

/**
 * Zero-dependency structured logger.
 *
 * Deliberately tiny: the assignment only needs request/error logging, and this
 * keeps the dependency list honest. Output is a single line per event so logs
 * stay greppable:
 *
 *   2026-05-10T10:51:02.481Z INFO  [http] GET /api/books 200 - 18ms
 */

const LEVELS = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
});

/** Colours only when attached to a TTY — keeps piped output clean. */
const useColour = process.stdout.isTTY === true;

const COLOURS = Object.freeze({
  error: '\u001b[31m', // red
  warn: '\u001b[33m', // yellow
  info: '\u001b[36m', // cyan
  http: '\u001b[35m', // magenta
  debug: '\u001b[90m', // grey
  reset: '\u001b[0m',
});

function resolveLevel() {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase();
  if (configured && Object.prototype.hasOwnProperty.call(LEVELS, configured)) {
    return LEVELS[configured];
  }
  return process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug;
}

const activeLevel = resolveLevel();

/** Render a structured detail object as compact `key=value` pairs. */
function formatMeta(meta) {
  if (!meta || typeof meta !== 'object') return '';

  const pairs = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      const rendered = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}=${rendered}`;
    });

  return pairs.length > 0 ? ` ${pairs.join(' ')}` : '';
}

function write(level, message, meta) {
  if (LEVELS[level] > activeLevel) return;

  const timestamp = new Date().toISOString();
  const label = level.toUpperCase().padEnd(5);
  const prefix = `[${timestamp}] `;
  const suffix = formatMeta(meta);

  if (useColour) {
    // eslint-disable-next-line no-console
    console.log(`${prefix}${COLOURS[level]}${label}${COLOURS.reset} ${message}${suffix}`);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`${prefix}${label} ${message}${suffix}`);
}

const logger = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  http: (message, meta) => write('http', message, meta),
  debug: (message, meta) => write('debug', message, meta),
  level: activeLevel,
};

module.exports = logger;
