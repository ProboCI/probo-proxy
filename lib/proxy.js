'use strict';

var http = require('http');
var httpProxy = require('http-proxy');
var auth = require('basic-auth');
var uuid = require('uuid');
var _ = require('lodash');

var utils = require('./utils');
var proxyLookup = require('./proxy-lookup');
var proxyRewrite = require('./proxy-rewrite');
var configLoader = require('./config');

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
proxy.on('proxyRes', function (proxyRes, req, res) {
  req.log.info({ status: proxyRes.statusCode }, 'proxy response');

  // Set a header with the ID of the initial request.
  res.setHeader('X-Proxy-Request-Id', req.id);
});

function respondWithLookupError(req, res, err) {
  req.log.error({ err }, 'Error looking up proxy information');
  if (err.errorCode) {
    respondWith404Message(req, res, err);
  }

  res.writeHead(400);
  res.end(`Proxy error: ${err.message}\n`);
}

function respondWithProxyError(req, res, err) {
  req.log.error({ err }, 'Error proxying request to container');
  res.writeHead(500);
  res.end(`Proxy error: ${err.message}\n`);
}

function respondWith404Message(req, res, err) {
  // If the request was from a browser asking for HTML, then hand back a
  // redirect to another page.
  function accepts(s) {
    return req.headers.accept && req.headers.accept.indexOf(s) >= 0;
  }
  var htmlAcceptStrings = ['text/html', 'application/xhtml', 'application/xml'];
  var jsonAcceptStrings = ['application/json'];

  if (_.includes(_.map(htmlAcceptStrings, accepts), true)) {
    if (err.redirectUrl) {
      res.writeHead(302, {
        location: err.redirectUrl,
      });
    } else {
      res.writeHead(404, {
        'Content-Type': 'text/html',
      });
      res.write(err.htmlResponse);
    }
  } else if (_.includes(_.map(jsonAcceptStrings, accepts), true)) {
    res.writeHead(404, {
      'Content-Type': 'application/json',
    });
    res.write(JSON.stringify(err));
  } else {
    res.writeHead(404);
    res.write(`Proxy error: ${err.message}\n`);
  }
  res.end();
}

function setupServer(config) {
  var server = http.createServer(function (req, res) {
    var dest;
    req.id = uuid();
    req.log = log.child({ req_id: req.id }, true);

    try {
      dest = utils.getAndParseDest(req);
      req.log.info({ dest: dest }, 'using dest:');
    } catch (e) {
      return respondWithLookupError(req, res, e);
    }

    proxyLookup(dest, { log: req.log }, function (err, result) {
      if (err) {
        return respondWithLookupError(req, res, err);
      }

      var target = {
        url: result.proxy.url,
        dest: dest,
        buildConfig: result.buildConfig,
      };

      if (result.proxy.basicAuth) {
        let creds = result.proxy.basicAuth;
        if (creds.username && creds.password) {
          let user = auth(req);
          if (
            !user ||
            String(user.name) !== String(creds.username) ||
            String(user.pass) !== String(creds.password)
          ) {
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="probo"' });
            return res.end('Access denied');
          }
        }
      }

      _proxy(target, function (err, request, response, targetObj) {
        // callback only fires on error
        // return custom error
        return respondWithProxyError(req, res, err);
      });
    });

    function _proxy(target, cb) {

      target.url = target.url.replace('localhost', config.hostname);
      target.url = target.url.replace('http', 'https');

      proxy.web(
        req,
        res,
        {
          target: target.url,
          xfwd: true,
          autoRewrite: true,
          secure: false,
          probo: {
            target: target,
          },
        },
        cb
      );
    }
  });
  return server;
}

module.exports = { setupServer, proxy };
