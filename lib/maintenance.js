'use strict';

var request = require('request');
var ms = require('ms');

var logger = require('./logger');
var configLoader = require('./config');

var enabled = false;
var url;
var authToken;
var timeout = 2000;
var cacheMaxAge = 10000;

// The coordinator's last answer (is Probo in maintenance?) and when it was
// asked, plus the callbacks waiting on a check in flight, if there is one.
var inMaintenance = false;
var checkedAt = 0;
var waiting = null;

function truthy(val) {
  return ['true', 't', 'yes', 'y', '1'].indexOf(('' + val).toLowerCase()) >= 0;
}

/**
 * (Re)configure the check. Called with the loaded config at startup; tests call
 * it directly. Resets the cached answer.
 *
 * @param {object} opts - Options.
 * @param {boolean|string} opts.enabled - Whether to check at all.
 * @param {string} opts.host - Coordinator base URL.
 * @param {string} opts.path - Path of the coordinator's maintenance endpoint.
 * @param {string} opts.authToken - Bearer token for the coordinator.
 * @param {string|number} opts.timeout - Request timeout, in any unit.
 * @param {string|number} opts.cacheMaxAge - How long to reuse an answer, in any unit.
 */
function configure(opts) {
  opts = opts || {};

  enabled = typeof opts.enabled === 'undefined' ? true : truthy(opts.enabled);
  url = (opts.host || '') + (opts.path || '/maintenance');
  authToken = opts.authToken || null;
  timeout = ms('' + (opts.timeout || '2s'));
  cacheMaxAge = typeof opts.cacheMaxAge === 'undefined' ? ms('10s') : ms('' + opts.cacheMaxAge);

  inMaintenance = false;
  checkedAt = 0;
  waiting = null;
}

// Initialize from config. This module is required only after config has been
// loaded (see index.js), so the callback fires synchronously in practice.
configLoader.load(function (err, config) {
  if (err) {
    throw err;
  }

  configure({
    enabled: config.maintenanceCheckEnabled,
    host: config.containerLookupHost,
    path: config.maintenanceCheckPath,
    authToken: config.containerLookupAuthToken,
    timeout: config.maintenanceCheckTimeout,
    cacheMaxAge: config.maintenanceCheckCacheMaxAge,
  });
});

/**
 * Whether the maintenance gate is turned on (config `maintenanceCheckEnabled`).
 *
 * @return {boolean} True if requests should be checked against maintenance mode.
 */
function isEnabled() {
  return enabled;
}

/**
 * Whether Probo is in maintenance mode, as the coordinator last said.
 *
 * The answer is reused for `maintenanceCheckCacheMaxAge`, and concurrent
 * checks while it is stale share one request to the coordinator. If the
 * coordinator can't be reached, or answers with something unexpected, the
 * last answer stands (off if there never was one), so a coordinator restarting
 * during a maintenance window doesn't let traffic through to builds.
 *
 * @param {object} opts - Options.
 * @param {object} opts.log - A bunyan compatible logging object.
 * @param {function} cb - Called with true while in maintenance, false
 *   otherwise. Never called with an error.
 */
function check(opts, cb) {
  if (Date.now() - checkedAt < cacheMaxAge) {
    cb(inMaintenance);
    return;
  }

  if (waiting) {
    waiting.push(cb);
    return;
  }
  waiting = [cb];

  var log = (opts.log || logger.getLogger()).child({ component: 'maintenance' });

  function finish(err, value) {
    if (err) {
      log.warn({ err: err, inMaintenance: inMaintenance }, 'Could not check maintenance mode; keeping the last known state');
    }
    else {
      if (value !== inMaintenance) {
        log.info({ inMaintenance: value }, value ? 'Probo is in maintenance mode' : 'Probo is out of maintenance mode');
      }
      inMaintenance = value;
    }
    // Set on failure too, so a coordinator that is down is not asked on every
    // single request.
    checkedAt = Date.now();

    var callbacks = waiting;
    waiting = null;
    callbacks.forEach(function (fn) {
      fn(inMaintenance);
    });
  }

  var requestOpts = { timeout: timeout, json: true };
  if (authToken) {
    requestOpts.auth = { bearer: authToken };
  }

  // Anything thrown has to end up in finish() as well: left behind, the
  // waiting list would hold every later request forever.
  try {
    request.get(url, requestOpts, function (err, response, body) {
      if (err) {
        finish(err);
      }
      else if (response.statusCode !== 200 || !body || typeof body.enabled !== 'boolean') {
        finish(new Error('Unexpected maintenance check response: HTTP ' + response.statusCode));
      }
      else {
        finish(null, body.enabled);
      }
    });
  }
  catch (e) {
    finish(e);
  }
}

module.exports = {
  configure: configure,
  isEnabled: isEnabled,
  check: check,
};
