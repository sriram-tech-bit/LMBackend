'use strict';

const dns = require('node:dns');
const logger = require('../utils/logger');

/**
 * DNS resolution for `mongodb+srv://` connection strings.
 *
 * Why this module exists
 * ----------------------
 * An SRV connection string cannot be used until the driver resolves
 * `_mongodb._tcp.<cluster>`. Node performs that lookup with c-ares, which reads
 * the OS resolver configuration directly. On some machines (corporate VPNs,
 * Docker, certain Windows setups) the configured resolver is a local stub such
 * as 127.0.0.1 that is not listening for queries from c-ares. The lookup then
 * fails with `ECONNREFUSED` even though `nslookup` and every other tool work
 * fine, and the connection fails with a very confusing error.
 *
 * What it does
 * ------------
 *   1. `DNS_SERVERS=8.8.8.8,8.8.4.4` in .env always wins — explicit control.
 *   2. Otherwise, for an `mongodb+srv://` URI, it pre-flights the SRV lookup
 *      with the system resolver. If that fails and DNS_AUTO_FALLBACK is on
 *      (the default), it retries with public resolvers and says so in the log.
 *   3. `mongodb://` URIs are left completely alone.
 */

const PUBLIC_RESOLVERS = Object.freeze(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

/** Parse `"8.8.8.8, 1.1.1.1"` into an array; null when unset/empty. */
function parseServerList(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  const servers = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return servers.length > 0 ? servers : null;
}

/** Extract the cluster hostname from a `mongodb+srv://` URI. */
function srvHostnameFrom(uri) {
  const match = /^mongodb\+srv:\/\/(?:[^@/]+@)?([^/?]+)/i.exec(uri);
  return match ? match[1] : null;
}

/** Prefer IPv4 — some networks advertise IPv6 records that are not routable. */
function preferIpv4() {
  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch {
    // Older Node versions do not have this; harmless.
  }
}

/**
 * Make sure SRV lookups will work, then report which resolvers are in use.
 *
 * @param {string} uri the MongoDB connection string about to be used
 * @param {{autoFallback?: boolean}} [options]
 * @returns {Promise<{servers: string[], usedFallback: boolean}>}
 */
async function prepareDnsFor(uri, options = {}) {
  preferIpv4();

  const autoFallback = options.autoFallback !== false;
  const explicit = parseServerList(process.env.DNS_SERVERS);

  if (explicit) {
    dns.setServers(explicit);
    logger.info('Using DNS resolvers from DNS_SERVERS', { servers: explicit.join(',') });
    return { servers: explicit, usedFallback: false };
  }

  const hostname = srvHostnameFrom(uri);
  if (!hostname) {
    // A plain mongodb:// URI needs no SRV lookup.
    return { servers: dns.getServers(), usedFallback: false };
  }

  const systemServers = dns.getServers();

  if (await canResolveSrv(hostname)) {
    return { servers: systemServers, usedFallback: false };
  }

  if (!autoFallback) {
    logger.warn('SRV lookup failed with the system resolvers and DNS_AUTO_FALLBACK is off', {
      hostname,
      servers: systemServers.join(','),
    });
    return { servers: systemServers, usedFallback: false };
  }

  logger.warn(
    `SRV lookup for ${hostname} failed with the system resolvers (${systemServers.join(
      ','
    )}) — falling back to public resolvers. Set DNS_SERVERS in .env to pin this explicitly.`
  );

  dns.setServers(PUBLIC_RESOLVERS);

  if (!(await canResolveSrv(hostname))) {
    dns.setServers(systemServers);
    throw new Error(
      `Could not resolve the SRV record for "${hostname}" with the system resolvers or ` +
        `with public DNS (${PUBLIC_RESOLVERS.join(', ')}). Check your network connection, ` +
        'or set DNS_SERVERS in .env to a resolver that can reach MongoDB Atlas.'
    );
  }

  logger.info('SRV resolution now works via public DNS', { servers: PUBLIC_RESOLVERS.join(',') });

  return { servers: PUBLIC_RESOLVERS, usedFallback: true };
}

/** Does the currently configured resolver answer an SRV query? */
async function canResolveSrv(hostname) {
  try {
    const records = await dns.promises.resolveSrv(`_mongodb._tcp.${hostname}`);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

module.exports = { prepareDnsFor, parseServerList, srvHostnameFrom, PUBLIC_RESOLVERS };
