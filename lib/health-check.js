'use strict';

var request = require('request');
var LRU = require('lru-cache');
var ms = require('ms');

var logger = require('./logger');
var configLoader = require('./config');

var enabled = false;
var timeout = 5000;
var probePath;
var healthyCache;

function truthy(val) {
  return ['true', 't', 'yes', 'y', '1'].indexOf(('' + val).toLowerCase()) >= 0;
}

// Initialize from config. This module is required only after config has been
// loaded (see index.js), so the callback fires synchronously in practice.
configLoader.load(function (err, config) {
  if (err) {
    throw err;
  }

  enabled = truthy(config.healthCheckEnabled);
  timeout = ms('' + (config.healthCheckTimeout || '5s'));
  // Optional path to probe instead of the container root (e.g. '/health').
  probePath = config.healthCheckPath || null;

  healthyCache = LRU({
    max: config.healthCheckCacheMax || 500,
    maxAge: ms('' + (config.healthCheckCacheMaxAge || '30s')),
  });
});

/**
 * Whether the health check gate is turned on (config `healthCheckEnabled`).
 *
 * @return {boolean} True if health checks should run.
 */
function isEnabled() {
  return enabled;
}

/**
 * Whether the target URL has passed a health check recently (cache lookup only,
 * never probes the container). Used to let non-HTML requests through without
 * paying for a probe of their own.
 *
 * @param {string} url - The (already rewritten) target URL we proxy to.
 * @return {boolean} True if a recent health check passed for this URL.
 */
function isKnownHealthy(url) {
  return !!(healthyCache && healthyCache.get(url));
}

/**
 * Probe the container to see if it is ready to serve. Considers HTTP 2xx/3xx a
 * pass; connection errors, timeouts, and 4xx/5xx are treated as "activating".
 * Passing results are cached per URL for `healthCheckCacheMaxAge`; failures are
 * never cached so activation is re-checked on the next request.
 *
 * @param {object} target - The proxy target.
 * @param {string} target.url - The (already rewritten) URL to probe.
 * @param {object} opts - Options.
 * @param {object} opts.log - A bunyan-compatible logger.
 * @param {object} [opts.basicAuth] - Optional {username, password} to send, in
 *        case the container itself enforces basic auth.
 * @param {function} cb - Called as cb(null, healthy:boolean). Never errors.
 */
function check(target, opts, cb) {
  var log = (opts.log || logger.getLogger()).child({ component: 'health-check' });
  var url = target.url;

  if (isKnownHealthy(url)) {
    return cb(null, true);
  }

  // Probe a configured path (e.g. '/health') if set, else the container root.
  // Healthy state is still cached against the container URL, not the probe URL.
  var probeUrl = probePath ? new URL(probePath, url).toString() : url;

  var requestOpts = {
    url: probeUrl,
    method: 'GET',
    timeout: timeout,
    strictSSL: false,
    // A 3xx is a healthy response in its own right; don't chase it.
    followRedirect: false,
  };

  if (opts.basicAuth && opts.basicAuth.username) {
    requestOpts.auth = {
      user: opts.basicAuth.username,
      pass: opts.basicAuth.password,
      sendImmediately: true,
    };
  }

  var done = false;
  function finish(healthy) {
    if (done) return;
    done = true;
    cb(null, healthy);
  }

  var probe = request(requestOpts);

  probe.on('response', function (response) {
    var healthy = response.statusCode >= 200 && response.statusCode < 400;
    log.debug({ status: response.statusCode, healthy: healthy, url: probeUrl }, 'health check');

    if (healthy && healthyCache) {
      healthyCache.set(url, true);
    }

    // We only need the status line; don't download the body.
    probe.abort();
    finish(healthy);
  });

  probe.on('error', function (probeErr) {
    // Fires for connection refused / timeout, and also as a side effect of
    // abort() above (guarded by `done`).
    log.debug({ err: probeErr, url: probeUrl }, 'health check failed (no response)');
    finish(false);
  });
}

module.exports = {
  check: check,
  isEnabled: isEnabled,
  isKnownHealthy: isKnownHealthy,
};
