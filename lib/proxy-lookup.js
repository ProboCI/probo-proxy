var request = require('request')
var LRU = require("lru-cache")
var ms = require('ms')

var configLoader = require('./config')

var cache;

// init simple in memory cache of proxy responses
var config = configLoader.load(function(err, config){
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
function lookup(buildId, cb){
  var config = configLoader.load()

  // check cache first
  var cached = cache.get(buildId)
  if(cached){
    return cb(null, cached)
  }

  // not cached, perform lookup
  var url = `${config.containerLookupHost}/container?bid=${buildId}`
  request.post(url, function(err, response, body){
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
      return cb(new Error("Invalid JSON in proxy lookup: " + body))
    }

    console.log("response", body)

    cache.set(buildId, body)
    cb(null, body)
  })
}

module.exports = lookup
