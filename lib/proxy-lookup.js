var request = require('request')
var LRU = require("lru-cache")
var ms = require('ms')
var util = require('util')

var logger = require('./logger')
var configLoader = require('./config')

var cache;

// init simple in memory cache of proxy responses
configLoader.load(function(err, config){
  if(err) throw err

  cache = LRU({
    max: config.cacheMax || 500,
    maxAge: ms(config.cacheMaxAge || "5m")
  })
})



/**
 * proxy lookup response looks like:
 *  {
 *    "proxy": {
 *      "host": "localhost",
 *      "port": "49802",
 *      "url": "http://localhost:49802/"
 *    },
 *    "buildConfig": {
 *      "image": "lepew/ubuntu-14.04-lamp",
 *      "steps": [...]
 *    }
 *  }
 */
function lookup(buildId, opts, cb){
  if(typeof opts === 'function'){
    cb = opts
    opts = {}
  }

  var log = (opts.log || logger.getLogger()).child({component: 'proxy-lookup'})
  var config = configLoader.load()

  // check cache first
  var cached = cache.get(buildId)
  if(cached){
    return cb(null, cached)
  }

  // not cached, perform lookup
  var path = config.containerLookupPath || "/builds/:bid/container/proxy"
  var request_opts = {};
  if(config.containerLookupAuthToken){
    request_opts.auth = {bearer: config.containerLookupAuthToken}
  }
  path = path.replace(":bid", buildId).replace(/^\//, '')
  var url = `${config.containerLookupHost}/${path}`
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

    log.debug({body: body}, "response")

    cache.set(buildId, body)
    cb(null, body)
  })
}

module.exports = lookup
