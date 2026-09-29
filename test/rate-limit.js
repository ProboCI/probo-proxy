'use strict';

var config = require('../lib/config');

describe('rate limit', function() {
  var rateLimit;

  before('load config', function(done) {
    config.load(function(err) {
      // require after config is loaded, like the other lib modules
      rateLimit = require('../lib/rate-limit');
      done(err);
    });
  });

  function req(host, url) {
    return {headers: {host: host}, url: url, socket: {}};
  }

  describe('keyFor', function() {
    it('strips the query string', function() {
      rateLimit.keyFor(req('abc.probo.build', '/search?f[0]=type:article'))
        .should.eql('abc.probo.build/search');
    });

    it('strips the port and lowercases the host', function() {
      rateLimit.keyFor(req('ABC.Probo.Build:3050', '/search'))
        .should.eql('abc.probo.build/search');
    });

    it('keeps path and trailing slash as given', function() {
      rateLimit.keyFor(req('h', '/search/')).should.eql('h/search/');
      rateLimit.keyFor(req('h', '/search')).should.eql('h/search');
    });

    it('appends the dest when given as a query param', function() {
      rateLimit.keyFor(req('localhost:3050', '/search?proboBuildId=b1&f=1'))
        .should.eql('localhost/search|b1');
      rateLimit.keyFor(req('localhost:3050', '/search?f=1&proboDest=b2'))
        .should.eql('localhost/search|b2');
    });

    it('copes with a missing host header', function() {
      rateLimit.keyFor({headers: {}, url: '/x'}).should.eql('/x');
    });
  });

  describe('hit', function() {
    var t0 = 1000000;

    beforeEach(function() {
      rateLimit.configure({
        enabled: true,
        max: 3,
        window: '1m',
        blockDuration: '10m',
      });
    });

    it('allows up to max hits in a window', function() {
      for (var i = 1; i <= 3; i++) {
        var v = rateLimit.hit(req('h', '/p'), t0 + i);
        v.blocked.should.be.false();
        v.count.should.eql(i);
      }
    });

    it('trips on the hit after max, then blocks without re-tripping', function() {
      for (var i = 0; i < 3; i++) {
        rateLimit.hit(req('h', '/p'), t0);
      }

      var trip = rateLimit.hit(req('h', '/p?q=1'), t0 + 1);
      trip.blocked.should.be.true();
      trip.tripped.should.be.true();
      trip.count.should.eql(4);

      var next = rateLimit.hit(req('h', '/p?q=2'), t0 + 2);
      next.blocked.should.be.true();
      next.tripped.should.be.false();
    });

    it('lifts the block after blockDuration and counts afresh', function() {
      for (var i = 0; i < 4; i++) {
        rateLimit.hit(req('h', '/p'), t0);
      }
      rateLimit.hit(req('h', '/p'), t0 + 1).blocked.should.be.true();

      // 10m block; just before expiry still blocked, at expiry allowed.
      var tenMin = 10 * 60 * 1000;
      rateLimit.hit(req('h', '/p'), t0 + tenMin - 1).blocked.should.be.true();

      var v = rateLimit.hit(req('h', '/p'), t0 + tenMin);
      v.blocked.should.be.false();
      v.count.should.eql(1);
    });

    it('resets the count when the window rolls over', function() {
      for (var i = 0; i < 3; i++) {
        rateLimit.hit(req('h', '/p'), t0);
      }

      var v = rateLimit.hit(req('h', '/p'), t0 + 60 * 1000);
      v.blocked.should.be.false();
      v.count.should.eql(1);
    });

    it('tracks base URLs independently', function() {
      for (var i = 0; i < 4; i++) {
        rateLimit.hit(req('a.probo.build', '/search'), t0);
      }
      rateLimit.hit(req('a.probo.build', '/search'), t0).blocked.should.be.true();

      // same path, other build
      rateLimit.hit(req('b.probo.build', '/search'), t0).blocked.should.be.false();
      // same build, other path
      rateLimit.hit(req('a.probo.build', '/'), t0).blocked.should.be.false();
    });

    it('only counts requests with a query string when queryOnly is set', function() {
      rateLimit.configure({
        enabled: true,
        max: 2,
        window: '1m',
        blockDuration: '10m',
        queryOnly: true,
      });

      for (var i = 0; i < 10; i++) {
        rateLimit.hit(req('h', '/search'), t0).blocked.should.be.false();
      }

      rateLimit.hit(req('h', '/search?f=1'), t0).count.should.eql(1);
      rateLimit.hit(req('h', '/search?f=2'), t0).count.should.eql(2);
      rateLimit.hit(req('h', '/search?f=3'), t0).blocked.should.be.true();

      // once blocked, the bare path is black-holed too
      rateLimit.hit(req('h', '/search'), t0 + 1).blocked.should.be.true();
    });

    it('reset() forgets counts and blocks', function() {
      for (var i = 0; i < 4; i++) {
        rateLimit.hit(req('h', '/p'), t0);
      }
      rateLimit.hit(req('h', '/p'), t0).blocked.should.be.true();

      rateLimit.reset();
      rateLimit.hit(req('h', '/p'), t0).blocked.should.be.false();
    });
  });

  describe('configure', function() {
    it('reads enabled and action from config-style values', function() {
      rateLimit.configure({enabled: 'false', action: 'drop'});
      rateLimit.isEnabled().should.be.false();
      rateLimit.getAction().should.eql('drop');

      rateLimit.configure({enabled: 'true', action: '429', blockDuration: '90s'});
      rateLimit.isEnabled().should.be.true();
      rateLimit.getAction().should.eql('429');
      rateLimit.getBlockSeconds().should.eql(90);
    });
  });
});
