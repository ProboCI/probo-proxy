'use strict';

var request = require('request');
var LRU = require('lru-cache');
var ms = require('ms');
var _ = require('lodash');
var util = require('util');

var logger = require('./logger');
var configLoader = require('./config');

var cache;

// Init simple in memory cache of proxy responses.
configLoader.load(function (err, config) {
  if (err) {
    throw err;
  }

  function truthy(val) {
    return (
      ['true', 't', 'yes', 'y', '1'].indexOf(('' + val).toLowerCase()) >= 0
    );
  }

  config.cacheEnabled = truthy(config.cacheEnabled);

  if (config.cacheEnabled) {
    cache = LRU({
      max: config.cacheMax || 500,
      maxAge: ms(config.cacheMaxAge || '5m'),
    });
  }
});

/**
 * Performs a proxy lookup to get the container port mapping for the specified destination.
 * If caching is enabled, uses the cache. A cache miss results in an HTTP lookup
 *
 * @param {object} dest - Proxy destination object (dest string parsed)
 * @param {string} dest.dest - Original unparsed destination string
 * @param {string} dest.build - If referencing a build, this is set and is the the build id
 * @param {string} dest.project - If referencing a pull request, or branch this is set to the project id (or alias)
 * @param {string} dest.pr - If referencing a pull request, this is set and is the pull request number (as a string)
 * @param {string} dest.branch - If referencing a branch, this is set and is the branch name
 * @param {object} opts - An options object.
 * @param {object} opts.log - A bunyan compatible logging object.
 * @param {function} cb - A function to call upon completion.
 *
 * @return {null} On success, calls the callback with a proxy lookup response that looks like:
 *         {
 *           "proxy": {
 *             "host": "localhost",
 *             "port": "49802",
 *             "url": "http://localhost:49802/"
 *           },
 *           "buildConfig": {
 *             "image": "lepew/ubuntu-14.04-lamp",
 *             "steps": [...]
 *           }
 *         }
 */
function lookup(dest, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }

  var log = (opts.log || logger.getLogger()).child({
    component: 'proxy-lookup',
  });
  var config = configLoader.load();

  // Check cache first...
  if (config.cacheEnabled) {
    var cachedProxyResponse = cache.get(dest.dest);
    if (cachedProxyResponse) {
      log.debug('proxy lookup cache HIT: ' + dest.dest);

      return cb(null, cachedProxyResponse);
    }

    log.debug('proxy lookup cache MISS: ' + dest.dest);
  }

  // Proxy to the build is not cached, so we perform a lookup.

  // pull out .pr or .branch with .project, or .build. Adding .dest for good measure too
  // TODO: should we just use the dest object directly?
  var query = _.pick(dest, ['pr', 'branch', 'project', 'build', 'dest']);

  // Example requests:
  //   POST /container/proxy?project=123e4567-e89b-12d3-a456-426655440000&pr=2
  //   POST /container/proxy?build=ccb2f22d-6b31-49e3-b95b-98ec823bd6f8
  var path = config.containerLookupPath || '/container/proxy';
  var requestOpts = {
    qs: query,
  };

  if (config.containerLookupAuthToken) {
    requestOpts.auth = { bearer: config.containerLookupAuthToken };
  }
  var url = config.containerLookupHost + path;

  request.post(url, requestOpts, function (err, response, body) {
    if (err) {
      return cb(new Error('Proxy lookup failed: ' + err.message));
    }

    if (response.statusCode !== 200) {
      var errorOptions = {
        redirectUrl: config.redirectUrl,
        custom404Html: config.custom404Html,
      };
      handleNonSuccessResponse(err, response, errorOptions, cb);
      return;
    }

    try {
      body = JSON.parse(body);
    } catch (e) {
      return cb(
        new Error('Invalid JSON in proxy lookup: ' + util.inspect(body))
      );
    }

    log.debug({ body: body, dest: dest }, 'proxy response for ' + dest.dest);

    if (config.cacheEnabled) {
      cache.set(dest.dest, body);
    }
    cb(null, body);
  });
}

function handleNonSuccessResponse(err, response, errorOptions, cb) {

  var proxyError = new Error(response.body);
  var proxyResponse = response.body;

  try {
    proxyResponse = JSON.parse(response.body);
  } catch (e) {
    return cb(proxyError);
  }

  if (proxyResponse.errorCode) {
    var proxyRedirect = null;
    if (errorOptions.redirectUrl) {
      proxyRedirect =
        errorOptions.redirectUrl + `?errorCode=${proxyResponse.errorCode}`;
      proxyRedirect += `&reason=${proxyResponse.message}`;
      proxyRedirect += `&buildId=${proxyResponse.buildId}`;
    }
    var proxyHtml =
      errorOptions.custom404Html + `<p>${proxyResponse.message}</p>`;
    proxyError = new Error();
    proxyError.message = proxyResponse.message;
    proxyError.statusCode = response.statusCode;
    proxyError.errorCode = proxyResponse.errorCode;
    proxyError.htmlResponse = proxyHtml;
    proxyError.redirectUrl = proxyRedirect;
  }

  return cb(proxyError);
}

module.exports = lookup;
