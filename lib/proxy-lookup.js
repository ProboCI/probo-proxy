var request = require('request')
var LRU = require("lru-cache")
var ms = require('ms')
var _ = require('lodash')
var util = require('util')

var logger = require('./logger')
var configLoader = require('./config')

var cache;

// init simple in memory cache of proxy responses
configLoader.load(function(err, config){
  if(err) throw err

  function truthy(val){
    return ["true", "t", "yes", "y", "1"].indexOf((""+val).toLowerCase()) >=0
  }

  // console.log("cache enabled pre truthy:", util.inspect(config.cacheEnabled))
  config.cacheEnabled = truthy(config.cacheEnabled)
  // console.log("cache enabled post truthy:", util.inspect(config.cacheEnabled))

  if(config.cacheEnabled){
    cache = LRU({
      max: config.cacheMax || 500,
      maxAge: ms(config.cacheMaxAge || "5m")
    })
  }
})



/**
 * Performs a proxy lookup to get the container port mapping for the specified destination.
 * If caching is enabled, uses the cache. A cache miss results in an HTTP lookup
 *
 * @param dest - Proxy destination object (dest string parsed)
 * @param dest.dest - Original unparsed destination string
 * @param dest.build - If referencing a build, this is set and is the the build id
 * @param dest.build - If referencing a pull request, or branch this is set to the project id (or alias)
 * @param dest.pr - If referencing a pull request, this is set and is the pull request number (as a string)
 * @param dest.branch - If referencing a branch, this is set and is the branch name
 *
 * @return On success, calls the callback with a proxy lookup response that looks like:
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
function lookup(dest, opts, cb){
  if(typeof opts === 'function'){
    cb = opts
    opts = {}
  }

  var log = (opts.log || logger.getLogger()).child({component: 'proxy-lookup'})
  var config = configLoader.load()

  // check cache first
  if(config.cacheEnabled){
    var cached = cache.get(dest.dest)
    if(cached){
      log.debug("proxy lookup cache HIT: " + dest.dest)

      return cb(null, cached)
    }

    log.debug("proxy lookup cache MISS: " + dest.dest)
  }


  /* not cached, perform lookup */

  // pull out .pr or .br with .project, or .build. Adding .dest for good measure too
  // TODO: should we just use the dest object directly?
  var query = _.pick(dest, "pr", "br", "project", "build", "dest")

  // example requests:
  //  POST /container/proxy?project=123e4567-e89b-12d3-a456-426655440000&pr=2
  //  POST /container/proxy?build=ccb2f22d-6b31-49e3-b95b-98ec823bd6f8
  var path = config.containerLookupPath || "/container/proxy"
  var request_opts = {
    qs: query
  }
  if(config.containerLookupAuthToken){
    request_opts.auth = {bearer: config.containerLookupAuthToken}
  }
  var url = config.containerLookupHost + path

  request.post(url, request_opts, function(err, response, body){
    if(err) {
      return cb(new Error("Proxy lookup failed: " + err.message))
    }

    // TODO: should we cache error responses as well?
    if(response.statusCode != 200){
      return cb(new Error(body))
    }

    try {
      body = JSON.parse(body)
    } catch(e){
      return cb(new Error("Invalid JSON in proxy lookup: " + util.inspect(body)))
    }

    log.debug({body: body, dest: dest}, "proxy response for " + dest.dest)

    if(config.cacheEnabled){
      cache.set(dest.dest, body)
    }
    cb(null, body)
  })
}

module.exports = lookup
