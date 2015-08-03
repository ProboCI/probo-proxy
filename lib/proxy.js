var url = require('url'),
    http = require('http'),
    httpProxy = require('http-proxy');

var proxy_lookup = require('./proxy-lookup')

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


function respondWithError(res, err){
    res.writeHead(400)
    res.end(`Bad request: ${err.message}\n`)
}


var server = http.createServer(function(req, res) {
  // You can define here your custom logic to handle the request
  // and then proxy the request.



  try {
    var buildId = getBuildId(req);
    console.log("using buildId:", buildId)
  } catch (e){
    return respondWithError(res, e)
  }

  lookupTarget(buildId, proxycb, function(err, request, response, target_obj){
    console.log("proxied ", err ? "ERR" + err : "")

    // return custom error
    return respondWithError(res, err)
  })

  function lookupTarget(buildId, cb, done){
    proxy_lookup(buildId, function(err, response){
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
