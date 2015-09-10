var url = require('url')
var http = require('http')
var httpProxy = require('http-proxy')
var uuid = require('uuid')

var utils = require('./utils')
var proxy_lookup = require('./proxy-lookup')
var proxy_rewrite = require('./proxy-rewrite')

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
proxy.on('proxyReq', proxy_rewrite);

//
// Listen for the `proxyRes` event on `proxy`.
//
proxy.on('proxyRes', function (proxyRes, req, res) {
  //console.log('RAW Response from the target', JSON.stringify(proxyRes.headers, true, 2));
  req.log.info({status: proxyRes.statusCode}, "proxy response")

  // set a header with the ID of the initial request
  res.setHeader('X-Proxy-Request-Id', req.id)
});


function respondWithLookupError(req, res, err){
  req.log.error({err}, "Error looking up proxy information")
  res.writeHead(400)
  res.end(`Proxy error: ${err.message}\n`)
}

function respondWithProxyError(req, res, err){
  req.log.error({err}, "Error proxying request to container")
  res.writeHead(500)
  res.end(`Proxy error: ${err.message}\n`)
}



var server = http.createServer(function(req, res) {
  req.id = uuid()
  req.log = log.child({req_id: req.id}, true)

  try {
    var dest = utils.getAndParseDest(req)
    req.log.info({dest: dest}, "using dest:")
  } catch (e){
    return respondWithLookupError(req, res, e)
  }

  proxy_lookup(dest, {log: req.log}, function(err, result){
    if(err) return respondWithLookupError(req, res, err)

    var target = {
      url: result.proxy.url,
      dest: dest,
      buildConfig: result.buildConfig
    }

    _proxy(target, function(err, request, response, target_obj){
      // callback only fires on error
      // return custom error
      return respondWithProxyError(req, res, err)
    })
  })


  function _proxy(target, cb){
    proxy.web(req, res, {
      target: target.url,
      xfwd: true,
      autoRewrite: true,
      probo: {
        target: target
      }
    }, cb);
  }
});

module.exports = {server, proxy}
