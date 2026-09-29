'use strict';

var fs = require('fs');
var http = require('http');
var path = require('path');
var nock = require('nock');

var config = require('../lib/config');

// __setup points containerLookupHost here
var COORDINATOR = 'http://localhost:3020';
var PAGE = fs.readFileSync(path.join(__dirname, '..', 'templates', 'maintenance.html'), 'utf8');

describe('maintenance mode', function() {
  var maintenance;
  var server;

  before('load config and start server', function(done) {
    config.load(function(err, conf) {
      if (err) {
        return done(err);
      }
      // require after config is loaded, like the other lib modules
      maintenance = require('../lib/maintenance');
      server = require('../lib/proxy').setupServer(conf);
      server.listen(0, done);
    });
  });

  afterEach(function() {
    nock.cleanAll();
  });

  after(function() {
    server.close();
    // leave it the way __setup has it for the other test files
    maintenance.configure({enabled: false});
  });

  function configure(opts) {
    maintenance.configure(Object.assign({
      enabled: true,
      host: COORDINATOR,
      authToken: 'coordinator-token',
      cacheMaxAge: '1m',
    }, opts));
  }

  function coordinatorSays(enabled) {
    return nock(COORDINATOR)
      .matchHeader('authorization', 'Bearer coordinator-token')
      .get('/maintenance')
      .reply(200, {enabled: enabled, updatedAt: null, updatedBy: ''});
  }

  function check() {
    return new Promise(function(resolve) {
      maintenance.check({}, resolve);
    });
  }

  describe('check', function() {
    it('reports what the coordinator says', function* () {
      configure();
      var coordinator = coordinatorSays(true);

      (yield check()).should.be.true();
      coordinator.isDone().should.be.true();
    });

    it('reuses the answer while it is fresh', function* () {
      configure();
      coordinatorSays(true);
      var second = coordinatorSays(false);

      (yield check()).should.be.true();
      (yield check()).should.be.true();
      second.isDone().should.be.false();
    });

    it('asks again once the answer is stale', function* () {
      configure({cacheMaxAge: 0});
      coordinatorSays(true);
      coordinatorSays(false);

      (yield check()).should.be.true();
      (yield check()).should.be.false();
    });

    it('shares one request between concurrent checks', function* () {
      configure();
      nock(COORDINATOR).get('/maintenance').delay(50).reply(200, {enabled: true});
      var second = coordinatorSays(false);

      var results = yield Promise.all([check(), check(), check()]);

      results.should.eql([true, true, true]);
      second.isDone().should.be.false();
    });

    it('keeps the last answer if the coordinator cannot be reached', function* () {
      configure({cacheMaxAge: 0});
      coordinatorSays(true);
      nock(COORDINATOR).get('/maintenance').replyWithError('connect ECONNREFUSED');

      (yield check()).should.be.true();
      (yield check()).should.be.true();
    });

    it('keeps the last answer if the coordinator answers with an error', function* () {
      configure({cacheMaxAge: 0});
      coordinatorSays(true);
      nock(COORDINATOR).get('/maintenance').reply(500, 'Internal Server Error');

      (yield check()).should.be.true();
      (yield check()).should.be.true();
    });

    it('is off if the coordinator has never answered', function* () {
      configure();
      nock(COORDINATOR).get('/maintenance').replyWithError('connect ECONNREFUSED');

      (yield check()).should.be.false();
    });
  });

  describe('requests', function() {
    var lookup;

    beforeEach(function() {
      // Every request is for a build the lookup says doesn't exist, so a
      // request that makes it past the maintenance gate gets a 404.
      lookup = nock(COORDINATOR)
        .post('/container/proxy')
        .query(true)
        .reply(404, {errorCode: '404N', message: 'Whoops! We could not find that build.'});
    });

    function get(accept) {
      return new Promise(function(resolve, reject) {
        http.get({
          port: server.address().port,
          path: '/?proboBuildId=build-1',
          headers: accept ? {accept: accept} : {},
        }, function(res) {
          var body = '';
          res.setEncoding('utf8');
          res.on('data', function(chunk) {
            body += chunk;
          });
          res.on('end', function() {
            resolve({status: res.statusCode, headers: res.headers, body: body});
          });
        }).on('error', reject);
      });
    }

    it('gives browsers the maintenance page, without looking the build up', function* () {
      configure();
      coordinatorSays(true);

      var res = yield get('text/html,application/xhtml+xml,*/*;q=0.8');

      res.status.should.eql(503);
      res.headers['content-type'].should.eql('text/html');
      res.headers['retry-after'].should.eql('60');
      res.headers['cache-control'].should.eql('no-store');
      res.body.should.eql(PAGE);
      lookup.isDone().should.be.false();
    });

    it('gives JSON clients a JSON 503', function* () {
      configure();
      coordinatorSays(true);

      var res = yield get('application/json');

      res.status.should.eql(503);
      JSON.parse(res.body).should.have.property('status', 'maintenance');
      lookup.isDone().should.be.false();
    });

    it('gives everything else a plain 503', function* () {
      configure();
      coordinatorSays(true);

      var res = yield get();

      res.status.should.eql(503);
      res.body.should.match(/maintenance/);
      lookup.isDone().should.be.false();
    });

    it('routes as usual when Probo is not in maintenance', function* () {
      configure();
      coordinatorSays(false);

      var res = yield get('text/html');

      res.status.should.eql(404);
      lookup.isDone().should.be.true();
    });

    it('routes as usual when the check is turned off', function* () {
      configure({enabled: false});
      var coordinator = coordinatorSays(true);

      var res = yield get('text/html');

      res.status.should.eql(404);
      coordinator.isDone().should.be.false();
      lookup.isDone().should.be.true();
    });
  });
});
