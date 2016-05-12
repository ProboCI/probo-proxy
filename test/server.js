'use strict';

// APP LIBS BEING TESTED
var config = require('../lib/config');

// HTTP HELPERS
var http = require('http');
var request = require('superagent-promise')(require('superagent'), require('bluebird'));

var nockout = require('./__nockout');

describe('lookup tests', function() {
  var conf;
  var server;
  var proxyLookup;
  var proxyRewrite;

  before('load config', function(done) {
    config.load(function(err, _config) {
      conf = _config;

      // make sure to require these after config is loaded
      server = require('../lib/proxy').server;
      proxyLookup = require('../lib/proxy-lookup');
      proxyRewrite = require('../lib/proxy-rewrite');

      done(err, conf);
    });
  });

  before('start server', function(done) {
    server.listen(0, function() {
      console.log('listening on port', server.address().port);
      done();
    });
  });

  after('stop server', function() {
    server.close();
  });

  describe('proxy lookup', function() {
    var nocker;

    before('nock out network calls', function() {
      nocker = nockout('proxy_lookup_nocks.json');
    });

    after('cleanup', function() {
      nocker.cleanup();
    });

    it('good build id', function(done) {
      var buildId = 'ccb2f22d-6b31-49e3-b95b-98ec823bd6f8';
      proxyLookup({build: buildId}, function(err, response) {
        if (err) {
          return done(err);
        }

        response.should.containEql({
          proxy: {
            host: 'localhost',
            port: '49348',
            url: 'http://localhost:49348/',
          },
        });

        response.should.have.properties(['buildConfig', 'status']);
        done();
      });
    });

    it('bad build id', function(done) {
      var buildId = '404';
      proxyLookup({build: buildId}, function(err, response) {
        err.message.should.eql(
          '{"code":"ResourceNotFound","message":"Build not found for build id: 404"}'
        );
        done();
      });
    });


    it('good project & pr', function(done) {
      proxyLookup({pr: '2', project: 'project-alias'}, function(err, response) {
        if (err) {
          return done(err);
        }
        // no need for the full proxy response here,
        // just verify that we hit the right endpoint
        response.should.eql({mocked: true, pr: '2', project: 'project-alias'});
        done();
      });
    });

    it('good project & branch', function(done) {
      proxyLookup({branch: 'branch', project: 'project-alias'}, function(err, response) {
        if (err) {
          return done(err);
        }

        // No need for the full proxy response here, just verify that we hit
        // the right endpoint
        response.should.eql({mocked: true, branch: 'branch', project: 'project-alias'});
        done();
      });
    });
  });



  describe('proxy', function() {
    var nocker;

    before('nock out network calls', function() {
      nocker = nockout('proxy_nocks.json', {
        processor: function(nocks) {
          // persist first nock - it'll be called twice - for 'good build id' and 'server missing'
          nocks[0] = nocks[0].persist();
          return nocks;
        },
      });
    });

    after('cleanup', function() {
      nocker.cleanup();
    });

    it('good build id', function* () {
      var buildId = 'ccb2f22d-6b31-49e3-b95b-98ec823bd6f8';

      try {
        // Makes 2 HTTP calls - one to lookup the proxy endpoint, and one to
        // the endpoint itself.
        var result = yield request
            .get(`http://localhost:${server.address().port}`)
            .query({proboBuildId: buildId})
            .end();

        result.res.text.should.eql('proxied page');
      }
      catch (e) {
        if (e.response) {
          console.log(e.response.error);
        }
        throw e;
      }
    });

    it('bad build id', function* () {
      var buildId = '404';

      try {
        yield request
            .get(`http://localhost:${server.address().port}`)
            .query({proboBuildId: buildId})
            .end();
      }
      catch (e) {
        // Confirm a "Bad request" response (indicating lookup error).
        e.response.status.should.eql(400);
        e.response.text.should.eql(
          'Proxy error: {"code":"ResourceNotFound","message":"Build not found for build id: 404"}\n'
        );
      }
    });

    it('returns a redirection if it receives a 404', function* () {
      var buildId = 'aab2f22d-6b31-49e3-b95b-98ec823bd6f8';
      // Set the redirection URL;
      conf.redirectUrl = 'http://test.com';

      try {
        var result = yield request
          .get(`http://localhost:${server.address().port}`)
          .set('accept', 'text/html')
          .redirects(0)
          .query({proboBuildId: buildId})
          .end();

        // This shouldn't happen. We should throw an error so the real test in
        // the catch statement.
        result.should.equal(null);
      }
      catch (e) {
        // Since we have a redirection URL set and accept headers for HTML we
        // should get a redirection.
        e.response.statusCode.should.eql(302);
        e.response.header.location.should.eql('http://test.com?errorCode=404R');
      }
    });

    it('returns HTML if it receives a 404', function* () {
      var buildId = 'acb2f22d-6b31-49e3-b95b-98ec823bd6f8';
      // Set the redirection URL;
      conf.redirectUrl = '';
      // Set the redirection URL;
      conf.custom404Html = '<h1>NOGO</h1>';

      try {
        var result = yield request
          .get(`http://localhost:${server.address().port}`)
          .set('accept', 'text/html')
          .query({proboBuildId: buildId})
          .end();

        // This shouldn't happen. We should throw an error so the real test in
        // the catch statement.
        result.should.equal(null);
      }
      catch (e) {
        // Since we do not have a redirection URL set but do have accept
        // headers for HTML get an HTML page back.
        e.response.statusCode.should.eql(404);
        e.response.header['content-type'].should.eql('text/html');
        e.response.text.should.eql('<h1>NOGO</h1><p>Build has been reaped</p>');
      }
    });

    it('returns an HTML 404 response if the default is not set', function* () {
      var buildId = 'adb2f22d-6b31-49e3-b95b-98ec823bd6f8';
      // Set the redirection URL;
      conf.redirectUrl = '';
      // Set the redirection URL;
      conf.custom404Html = '';

      try {
        var result = yield request
          .get(`http://localhost:${server.address().port}`)
          .set('accept', 'text/html')
          .query({proboBuildId: buildId})
          .end();

        // This shouldn't happen. We should throw an error so the real test in
        // the catch statement.
        result.should.equal(null);
      }
      catch (e) {
        e.response.statusCode.should.eql(404);
        e.response.header['content-type'].should.eql('text/html');
        e.response.text.should.eql('<p>Build has been reaped</p>');
      }
    });

    it('returns a plaintext 404 response', function* () {
      var buildId = 'eeb2f22d-6b31-49e3-b95b-98ec823bd6f8';
      try {
        var result = yield request
          .get(`http://localhost:${server.address().port}`)
          .query({proboBuildId: buildId})
          .end();

        // This shouldn't happen. We should throw an error so the real test in
        // the catch statement.
        result.should.equal(null);
      }
      catch (e) {
        e.response.statusCode.should.eql(404);
        e.response.text.should.eql('Proxy error: Build has been reaped\n');
      }
    });

    it('returns a json 404 response', function* () {
      // Set the redirection URL;
      conf.redirectUrl = 'http://test.com';
      // Set the redirection URL;
      conf.custom404Html = '<h1>THIS SHOULD BE A JSON RESPONSE</h1>';
      var buildId = 'efb2f22d-6b31-49e3-b95b-98ec823bd6f8';
      try {
        var result = yield request
          .get(`http://localhost:${server.address().port}`)
          .set('accept', 'application/json')
          .query({proboBuildId: buildId})
          .end();

        // This shouldn't happen. We should throw an error so the real test in
        // the catch statement.
        result.should.equal(null);
      }
      catch (e) {
        var err = {
          message: 'Build has been reaped',
          statusCode: 404,
          errorCode: '404R',
          htmlResponse: '<h1>THIS SHOULD BE A JSON RESPONSE</h1><p>Build has been reaped</p>',
          redirectUrl: 'http://test.com?errorCode=404R'
        };
        e.response.statusCode.should.eql(404);
        e.response.text.should.eql(JSON.stringify(err));
      }
    });
  });


  describe('proxy rewrites', function() {
    function createProxyInfo(buildConfigSites, dest) {
      // sample options that will be passed in to the rewriter
      // (just including the probo part)
      var options = {
        probo: {
          target: {
            url: 'http://localhost:49348/',
            dest: dest || {
              id: 'ccb2f22d-6b31-49e3-b95b-98ec823bd6f8', post: null,
            },
            buildConfig: {
              image: 'lepew/ubuntu-14.04-lamp',
              sites: buildConfigSites,
            },
          },
        },
      };

      var proxyReq = http.request({
        // representative default headers
        headers: {
          'host': 'localhost:38937',
          'accept-encoding': 'gzip, deflate',
          'user-agent': 'node-superagent/1.3.0',
          'connection': 'close',
          'x-forwarded-for': '::ffff:127.0.0.1',
          'x-forwarded-port': '38937',
          'x-forwarded-proto': 'http',
        },
      });

      return {proxyReq, options};
    }

    it('nothing by default', function(done) {
      var proxyInfo = createProxyInfo();
      proxyRewrite(proxyInfo.proxyReq, null, null, proxyInfo.options);

      'localhost:38937'.should.eql(proxyInfo.proxyReq.getHeader('host'));
      done();
    });

    it('nothing by default but with sites specified', function(done) {
      var proxyInfo = createProxyInfo({us: 'us.domain.com'});
      proxyRewrite(proxyInfo.proxyReq, null, null, proxyInfo.options);

      'localhost:38937'.should.eql(proxyInfo.proxyReq.getHeader('host'));
      done();
    });

    it('default domain with bare build id', function(done) {
      var proxyInfo = createProxyInfo(
        {
          us: 'us.domain.com',
          default: 'domain.com',
        },
        {id: 'buildid'}
      );
      proxyRewrite(proxyInfo.proxyReq, null, null, proxyInfo.options);

      'domain.com'.should.eql(proxyInfo.proxyReq.getHeader('host'));
      done();
    });

    it('specified domain with postfix syntax', function(done) {
      var proxyInfo = createProxyInfo(
        {
          us: 'us.domain.com',
          default: 'domain.com',
        },
        {
          id: 'buildid',
          site: 'us',
        }
      );
      proxyRewrite(proxyInfo.proxyReq, null, null, proxyInfo.options);

      'us.domain.com'.should.eql(proxyInfo.proxyReq.getHeader('host'));
      done();
    });
  });
});
