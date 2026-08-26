'use strict';

var http = require('http');
var path = require('path');
var httpProxy = require('http-proxy');
var auth = require('basic-auth');
var uuid = require('uuid');
var _ = require('lodash');

var utils = require('./utils');
var proxyLookup = require('./proxy-lookup');
var proxyRewrite = require('./proxy-rewrite');
var healthCheck = require('./health-check');
var template = require('./template');
var configLoader = require('./config');

var DEFAULT_ACTIVATING_TEMPLATE = path.join(__dirname, '..', 'templates', 'activating.html');
var DEFAULT_ACTIVATING_MESSAGE = 'Your build is spinning up and will be ready in a moment.';

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
  if (res.headersSent) return;
  if (err.errorCode) {
    return respondWith404Message(req, res, err);
  }

  res.writeHead(400);
  res.end(`Proxy error: ${err.message}\n`);
}

function respondWithProxyError(req, res, err) {
  req.log.error({ err }, 'Error proxying request to container');
  if (res.headersSent) return;
  res.writeHead(500);
  res.end(`Proxy error: ${err.message}\n`);
}

function respondWith404Message(req, res, err) {
  if (res.headersSent) return;
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

function accepts(req, s) {
  return req.headers.accept && req.headers.accept.indexOf(s) >= 0;
}

function wantsHtml(req) {
  return accepts(req, 'text/html') || accepts(req, 'application/xhtml');
}

// Rewrite the URL reported by the lookup service into the one we actually
// connect to: the lookup reports localhost:<port> over http, but the container
// is reached over https at the configured hostname.
function rewriteTargetUrl(url, config) {
  return url.replace('localhost', config.hostname).replace('http', 'https');
}

// Minimal inline fallback, only used if the template file can't be read.
var fallbackActivatingHtml =
  '<!DOCTYPE html><html><head>' +
  '<meta charset="utf-8">' +
  '<meta http-equiv="refresh" content="{{refresh}}">' +
  '<title>{{title}}</title>' +
  '</head><body><h1>Probo.CI</h1><p>{{message}}</p></body></html>';

// The container is not answering health checks yet. Tell the client to come
// back: browsers get an auto-refreshing HTML page rendered from the activating
// template, everything else gets a 503 (JSON or plain text) with a Retry-After.
function respondWithActivating(req, res, config) {
  if (res.headersSent) return;

  var refresh = config.healthCheckRefreshSeconds || 3;
  var message = config.activatingMessage || DEFAULT_ACTIVATING_MESSAGE;
  var title = config.activatingTitle || 'Build activating';

  if (wantsHtml(req)) {
    var templatePath = config.activatingTemplate || DEFAULT_ACTIVATING_TEMPLATE;
    var html = template.render(
      templatePath,
      { refresh: refresh, message: message, title: title },
      fallbackActivatingHtml
    );
    res.writeHead(503, {
      'Content-Type': 'text/html',
      'Retry-After': refresh,
    });
    return res.end(html);
  }

  if (accepts(req, 'application/json')) {
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Retry-After': refresh,
    });
    return res.end(JSON.stringify({ status: 'activating', message: message }));
  }

  res.writeHead(503, { 'Retry-After': refresh });
  res.end(message + '\n');
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
        url: rewriteTargetUrl(result.proxy.url, config),
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

      function proxyToTarget() {
        _proxy(target, function (err, request, response, targetObj) {
          // callback only fires on error
          // return custom error
          return respondWithProxyError(req, res, err);
        });
      }

      // Health-check gate: make sure the container is up before routing to it.
      if (!healthCheck.isEnabled()) {
        return proxyToTarget();
      }

      // Probe the container before routing anything to it, assets and API
      // calls included: a build nothing ever navigates to in a browser would
      // otherwise never get a passing probe, and 503 forever. Concurrent
      // probes for the same container are coalesced in health-check, so a
      // page's worth of assets against a cold build costs one probe.
      healthCheck.check(
        target,
        { log: req.log, basicAuth: result.proxy.basicAuth },
        function (hcErr, healthy) {
          if (healthy) {
            return proxyToTarget();
          }
          // Not ready: browsers get the auto-refreshing "activating" screen,
          // everything else a 503 with Retry-After.
          return respondWithActivating(req, res, config);
        }
      );
    });

    function _proxy(target, cb) {
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
