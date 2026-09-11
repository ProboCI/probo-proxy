'use strict';

var LRU = require('lru-cache');
var ms = require('ms');

var configLoader = require('./config');

// Effective settings, populated by configure().
var enabled = false;
var max = 100;
var windowMs = 60 * 1000;
var blockMs = 10 * 60 * 1000;
var action = 'drop';
var queryOnly = false;

// Per-base-URL request counts for the current window: key -> {count, windowStart}.
var counters;
// Base URLs currently black-holed: key -> {until, count, dropped}.
var blocked;

// Matches the dest given as a query param (see utils.getDest). Kept as a regex
// rather than parsing the whole query string: this runs on every request.
var destParamRe = /[?&]probo(?:Dest|BuildId)=([^&]*)/;

function truthy(val) {
  return ['true', 't', 'yes', 'y', '1'].indexOf(('' + val).toLowerCase()) >= 0;
}

/**
 * (Re)configure the limiter and rebuild its tables. Called once from config at
 * load; tests call it directly with small numbers.
 *
 * @param {object} opts - Settings, matching the rateLimit* config keys.
 * @param {boolean} [opts.enabled] - Whether the gate runs at all.
 * @param {number} [opts.max] - Hits per base URL per window before black-holing.
 * @param {string|number} [opts.window] - Counting window (any `ms` unit).
 * @param {string|number} [opts.blockDuration] - How long a tripped key stays black-holed.
 * @param {string} [opts.action] - 'drop' (close the connection) or '429'.
 * @param {boolean} [opts.queryOnly] - Only count requests carrying a query string.
 * @param {number} [opts.cacheMax] - Max base URLs tracked.
 */
function configure(opts) {
  opts = opts || {};

  enabled = truthy(opts.enabled);
  max = parseInt(opts.max, 10) || 100;
  windowMs = ms('' + (opts.window || '1m'));
  blockMs = ms('' + (opts.blockDuration || '10m'));
  action = ('' + (opts.action || 'drop')).toLowerCase();
  queryOnly = truthy(opts.queryOnly);

  var cacheMax = parseInt(opts.cacheMax, 10) || 10000;

  // Expiry is decided in hit() against the caller's clock; maxAge here only
  // keeps idle keys from piling up.
  counters = LRU({ max: cacheMax, maxAge: windowMs });
  blocked = LRU({ max: cacheMax, maxAge: blockMs });
}

// Initialize from config. This module is required only after config has been
// loaded (see index.js), so the callback fires synchronously in practice.
configLoader.load(function (err, config) {
  if (err) {
    throw err;
  }

  configure({
    enabled: config.rateLimitEnabled,
    max: config.rateLimitMax,
    window: config.rateLimitWindow,
    blockDuration: config.rateLimitBlockDuration,
    action: config.rateLimitAction,
    queryOnly: config.rateLimitQueryOnly,
    cacheMax: config.rateLimitCacheMax,
  });
});

/**
 * Whether the rate limit gate is turned on (config `rateLimitEnabled`).
 *
 * @return {boolean} True if requests should be counted.
 */
function isEnabled() {
  return enabled;
}

/**
 * The configured black hole action: 'drop' or '429'.
 *
 * @return {string} The action.
 */
function getAction() {
  return action;
}

/**
 * Block duration in whole seconds, for a Retry-After header.
 *
 * @return {number} Seconds.
 */
function getBlockSeconds() {
  return Math.ceil(blockMs / 1000);
}

/**
 * The limiter key for a request: its base URL, i.e. host (port stripped,
 * lowercased) plus path with the query string removed. When the dest is given
 * as a query param instead of a subdomain the Host is the proxy's own, so the
 * dest value is appended to keep builds from sharing a key.
 *
 * @param {object} req - The incoming request.
 * @return {string} The key.
 */
function keyFor(req) {
  var host = (req.headers.host || '').split(':')[0].toLowerCase();
  var url = req.url || '/';
  var q = url.indexOf('?');
  var path = q < 0 ? url : url.slice(0, q);

  var key = host + path;

  if (q >= 0) {
    var m = destParamRe.exec(url.slice(q));
    if (m) {
      key += '|' + m[1];
    }
  }

  return key;
}

/**
 * Count a request against its base URL and say whether it should be black-holed.
 * Never touches the network. Cheap enough to run before anything else.
 *
 * @param {object} req - The incoming request.
 * @param {number} [now] - Clock override (ms since epoch), for tests.
 * @return {object} {blocked, tripped, key, count}. `tripped` is true only on the
 *         request that crossed the threshold, so callers can log it once.
 */
function hit(req, now) {
  now = now || Date.now();
  var key = keyFor(req);

  var b = blocked.get(key);
  if (b) {
    if (now < b.until) {
      b.dropped++;
      return { blocked: true, tripped: false, key: key, count: b.count };
    }
    blocked.del(key);
  }

  if (queryOnly && req.url.indexOf('?') < 0) {
    return { blocked: false, tripped: false, key: key, count: 0 };
  }

  var c = counters.get(key);
  if (!c || now - c.windowStart >= windowMs) {
    c = { count: 0, windowStart: now };
    counters.set(key, c);
  }
  c.count++;

  if (c.count > max) {
    blocked.set(key, { until: now + blockMs, count: c.count, dropped: 0 });
    counters.del(key);
    return { blocked: true, tripped: true, key: key, count: c.count };
  }

  return { blocked: false, tripped: false, key: key, count: c.count };
}

/**
 * Forget all counts and blocks (tests).
 */
function reset() {
  counters.reset();
  blocked.reset();
}

module.exports = {
  configure: configure,
  isEnabled: isEnabled,
  getAction: getAction,
  getBlockSeconds: getBlockSeconds,
  keyFor: keyFor,
  hit: hit,
  reset: reset,
};
