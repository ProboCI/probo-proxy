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

// Probes currently in flight, keyed by container origin, each holding the
// callbacks waiting on that probe's result. See the coalescing note in check().
var inFlight = Object.create(null);

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
    maxAge: ms('' + (config.healthCheckCacheMaxAge || '30m')),
  });
});

/**
 * Cache key for a target: the container origin (scheme + host + port) with any
 * path stripped. Health is a property of the container, not of the path we
 * happened to probe, so one passing probe marks the whole container healthy.
 *
 * @param {string} url - A URL pointing at the container.
 * @return {string} The origin, or the original string if it can't be parsed.
 */
function containerKey(url) {
  try {
    return new URL(url).origin;
  }
  catch (e) {
    return url;
  }
}

/**
 * Whether the health check gate is turned on (config `healthCheckEnabled`).
 *
 * @return {boolean} True if health checks should run.
 */
function isEnabled() {
  return enabled;
}

/**
 * Whether the container has passed a health check recently (cache lookup only,
 * never probes). Keyed by container origin, so a pass on any path counts for
 * every request to that container.
 *
 * @param {string} url - Any URL pointing at the container.
 * @return {boolean} True if a recent health check passed for this container.
 */
function isKnownHealthy(url) {
  return !!(healthyCache && healthyCache.get(containerKey(url)));
}

/**
 * Resolve the canonical Host header for a target, matching the rewrite done for
 * real proxied requests in proxy-rewrite.js. Returns null if the build config
 * has no site mapping, in which case the probe keeps the target URL's own host.
 *
 * @param {object} target - The proxy target (carries dest and buildConfig).
 * @return {string|null} The site host, or null if none is configured.
 */
function resolveSiteHost(target) {
  try {
    var sites = target.buildConfig.sites;
    var site = target.dest.site || 'default';
    return sites[site] || null;
  }
  catch (e) {
    // buildConfig or dest missing; fall back to the target URL's host.
    return null;
  }
}

/**
 * Probe the container to see if it is ready to serve. Considers HTTP 2xx/3xx a
 * pass; connection errors, timeouts, and 4xx/5xx are treated as "activating".
 * Passing results are cached per container origin for `healthCheckCacheMaxAge`;
 * failures are never cached so activation is re-checked on the next request.
 * Callers arriving while a probe is already running for the same container wait
 * on that probe rather than starting one of their own.
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
  var key = containerKey(url);

  if (isKnownHealthy(url)) {
    return cb(null, true);
  }

  // Probe a configured path (e.g. '/health') if set, else the container root.
  // Healthy state is cached against the container origin, not the probe URL.
  var probeUrl;
  try {
    probeUrl = probePath ? new URL(probePath, url).toString() : url;
  }
  catch (e) {
    log.debug({ err: e, url: url }, 'health check failed (unparseable target)');
    return cb(null, false);
  }

  var requestOpts = {
    url: probeUrl,
    method: 'GET',
    timeout: timeout,
    strictSSL: false,
    // A 3xx is a healthy response in its own right; don't chase it.
    followRedirect: false,
  };

  // Present the same Host header that real proxied traffic gets from
  // proxy-rewrite (buildConfig.sites[dest.site || 'default']), so the app sees
  // its canonical domain and doesn't answer the probe with a redirect.
  var siteHost = resolveSiteHost(target);
  if (siteHost) {
    requestOpts.headers = { host: siteHost };
  }

  if (opts.basicAuth && opts.basicAuth.username) {
    requestOpts.auth = {
      user: opts.basicAuth.username,
      pass: opts.basicAuth.password,
      sendImmediately: true,
    };
  }

  // A cold container gets hit by a burst of requests at once — every asset on
  // the page the browser just asked for. Run a single probe per container and
  // hand its result to everyone waiting, rather than piling more connections
  // onto something that is still starting up. Claimed here, immediately before
  // the probe starts, so nothing above can leave a stale entry behind.
  if (inFlight[key]) {
    inFlight[key].push(cb);
    return;
  }
  inFlight[key] = [cb];

  var done = false;
  function finish(healthy) {
    if (done) return;
    done = true;

    var waiting = inFlight[key] || [];
    delete inFlight[key];
    waiting.forEach(function (waiter) {
      // One caller throwing must not strand the rest of the burst.
      try {
        waiter(null, healthy);
      }
      catch (e) {
        log.error({ err: e, url: url }, 'health check callback threw');
      }
    });
  }

  var probe;
  try {
    probe = request(requestOpts);
  }
  catch (e) {
    // A synchronous throw would otherwise leave inFlight[key] set forever,
    // wedging every later request for this container.
    log.debug({ err: e, url: probeUrl }, 'health check failed (request threw)');
    return finish(false);
  }

  probe.on('response', function (response) {
    var healthy = response.statusCode >= 200 && response.statusCode < 400;
    log.debug({ status: response.statusCode, healthy: healthy, url: probeUrl }, 'health check');

    if (healthy && healthyCache) {
      healthyCache.set(key, true);
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
