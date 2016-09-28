'use strict';

var http = require('http');
var httpProxy = require('http-proxy');
var uuid = require('uuid');

var utils = require('./utils');
var proxyLookup = require('./proxy-lookup');
var proxyRewrite = require('./proxy-rewrite');

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
proxy.on('proxyReq', proxyRewrite);

//
// Listen for the `proxyRes` event on `proxy`.
//
proxy.on('proxyRes', function(proxyRes, req, res) {
  req.log.info({status: proxyRes.statusCode}, 'proxy response');

  // Set a header with the ID of the initial request.
  res.setHeader('X-Proxy-Request-Id', req.id);
});


function respondWithLookupError(req, res, err) {
  req.log.error({err}, 'Error looking up proxy information');
  res.writeHead(400);
  res.end(`Proxy error: ${err.message}\n`);
}

function respondWithProxyError(req, res, err) {
  req.log.error({err}, 'Error proxying request to container');
  res.writeHead(500);
  res.end(`Proxy error: ${err.message}\n`);
}



var server = http.createServer(function(req, res) {
  var dest;
  req.id = uuid();
  req.log = log.child({req_id: req.id}, true);

  try {
    dest = utils.getAndParseDest(req);
    req.log.info({dest: dest}, 'using dest:');
  }
  catch (e) {
    return respondWithLookupError(req, res, e);
  }

  proxyLookup(dest, {log: req.log}, function(err, result) {
    if (err) {
      return respondWithLookupError(req, res, err);
    }

    var target = {
      url: result.proxy.url,
      dest: dest,
      buildConfig: result.buildConfig,
    };

    _proxy(target, function(err, request, response, targetObj) {
      // callback only fires on error
      // return custom error
      return respondWithProxyError(req, res, err);
    });
  });


  function _proxy(target, cb) {
    proxy.web(req, res, {
      target: target.url,
      xfwd: true,
      autoRewrite: true,
      probo: {
        target: target,
      },
    }, cb);
  }
});

module.exports = {server, proxy};
