var url = require('url')
var http = require('http')
var httpProxy = require('http-proxy')
var uuid = require('uuid')

var proxy_lookup = require('./proxy-lookup')

var log = require('./logger').getLogger();

//
// Create a proxy server with custom application logic
//
var proxy = httpProxy.createProxyServer({});

// To modify the proxy connection before data is sent, you can listen
// for the 'proxyReq' event. When the event is fired, you will receive
// the following arguments:
// (http.ClientRequest proxyReq, http.IncomingMessage req,
//  http.ServerResponse res, Object options). This mechanism is useful when
// you need to modify the proxy request before the proxy connection
// is made to the target.
//
proxy.on('proxyReq', function(proxyReq, req, res, options) {
  //proxyReq.setHeader('X-Special-Proxy-Header', 'foobar');
});

//
// Listen for the `proxyRes` event on `proxy`.
//
proxy.on('proxyRes', function (proxyRes, req, res) {
  //console.log('RAW Response from the target', JSON.stringify(proxyRes.headers, true, 2));
  req.log.info({status: proxyRes.statusCode}, "proxy response")

  // set a header with the ID of the initial request
  res.setHeader('X-Proxy-Request-Id', req.id)
});

/**
 * build id can be specified either via a subdomain or by
 * a proboBuildId request param
 */
function getBuildId(req){
  // check query first
  var query = url.parse(req.url, true).query
  if(query.proboBuildId){
    return query.proboBuildId
  }

  // check hostname
  var hostname = req.headers.host.split(':')[0] // includes port
  var parts = hostname.split('.')

  if(parts.length < 3){
    throw new Error("Build ID not found in domain or query param")
  }

  // parse out buildid.host.com part
  var buildId = parts[0]

  return buildId
}


function respondWithError(req, res, err){
  req.log.error({err}, "Proxy handling error")
  res.writeHead(400)
  res.end(`Bad request: ${err.message}\n`)
}

var server = http.createServer(function(req, res) {
  req.id = uuid()
  req.log = log.child({req_id: req.id}, true)

  try {
    var buildId = getBuildId(req);
    req.log.info("using buildId:", buildId)
  } catch (e){
    return respondWithError(req, res, e)
  }

  lookupTarget(buildId, proxycb, function(err, request, response, target_obj){
    // callback only fires on error
    // return custom error
    return respondWithError(req, res, err)
  })

  function lookupTarget(buildId, cb, done){
    proxy_lookup(buildId, {log: req.log}, function(err, response){
      if(err) return cb(err, null, done)

      // var target_url = "http://localhost:49802/"
      var target_url = response.proxy.url

      cb(null, target_url, done)
    })
  }

  function proxycb(err, target_url, cb){
    if(err) return cb(err)

    proxy.web(req, res, {
      target: target_url,
      xfwd: true,
      autoRewrite: true
    }, cb);
  }
});

module.exports = server
