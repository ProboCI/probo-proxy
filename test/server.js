// APP LIBS BEING TESTED
var config = require('../lib/config')

// HTTP HELPERS
var http = require('http')
var request = require('superagent-promise')(require('superagent'), require('bluebird'));


// NOCK CONFIGUATION
// var default_nock_mode = "RECORD"
var default_nock_mode = "PLAY"

var nock = require('nock')
// opts: {processor, not_required, mode}
function init_nock(fixture, opts){
  var fixture_file = "./test/fixtures/" + fixture

  var nocked = {}
  var required_nocks = []

  opts = opts || {}
  opts.not_required = opts.not_required || []

  var nock_mode = opts.mode || default_nock_mode

  var nocks
  if(nock_mode === "PLAY"){
    nocks = nock.load(fixture_file)

    if(opts.processor){
      nocks = opts.processor(nocks)
    }

    nocks.forEach(function(n, i){
      nocked['loaded_' + i] = n
    })

    // allow some mocks to be not required
    Object.keys(nocked).filter(function(name){
      return opts.not_required.indexOf(name) < 0
    }).forEach(function(name){
      required_nocks.push(nocked[name])
    })
  }

  if(nock_mode === "RECORD"){
    console.log("recording")
    nock.recorder.rec({
      output_objects: true,
      dont_print: true
    })
  }

  return {
    nocked: nocked,
    nocks: nocks,
    required: required_nocks,
    cleanup: function(){
      if(nock_mode === "RECORD"){
        var nockCallObjects = nock.recorder.play();
        require('fs').writeFileSync(fixture_file, JSON.stringify(nockCallObjects, null, 2));
      }

      // makesure all internal calls were made
      try {
        for(var nock_name in required_nocks){
          required_nocks[nock_name].done();
        }
      } finally {
        nock.cleanAll()
      }
    }
  }
}

describe("lookup tests", function(){
  var conf, server, proxy, proxy_lookup, proxy_rewrite

  before("load config", function(done){
    config.load(function(err, _config){
      conf = _config
      // console.log({conf: conf}, "config")

      // make sure to require these after config is loaded
      server = require('../lib/proxy').server
      proxy = require('../lib/proxy').proxy
      proxy_lookup = require('../lib/proxy-lookup')
      proxy_rewrite = require('../lib/proxy-rewrite')

      done(err, conf)
    })
  })

  before("start server", function(done){
    server.listen(0, function(){
      console.log("listening on port", server.address().port)
      done()
    });
  });

  after("stop server", function(){
    server.close()
  });

  describe("proxy lookup", function(){
    var nocker

    before("nock out network calls", function(){
      nocker = init_nock('proxy_lookup_nocks.json')
    });

    after("cleanup", function(){
      nocker.cleanup()
    });

    it("good build id", function(done){
      var buildId = "ccb2f22d-6b31-49e3-b95b-98ec823bd6f8"
      proxy_lookup({build: buildId}, function(err, response){
        if(err) return done(err)

        response.should.containEql({
          proxy:
          { host: 'localhost',
            port: '49348',
            url: 'http://localhost:49348/' }
        })

        response.should.have.properties(["buildConfig", "status"])
        done()
      })
    })

    it("bad build id", function(done){
      var buildId = "404"
      proxy_lookup({build: buildId}, function(err, response){
        err.message.should.eql(
          '{"code":"ResourceNotFound","message":"Build not found for build id: 404"}'
        )
        done()
      })
    })
  })



  describe("proxy", function(){
    var nocker

    before("nock out network calls", function(){
      nocker = init_nock('proxy_nocks.json', {
        processor: function(nocks){
          // persist first nock - it'll be called twice - for 'good build id' and 'server missing'
          nocks[0] = nocks[0].persist()
          return nocks
        }
      })
    });

    after("cleanup", function(){
      nocker.cleanup()
    });

    it("good build id", function* (){
      var buildId = "ccb2f22d-6b31-49e3-b95b-98ec823bd6f8"

      try {
        // makes 2 HTTP calls - one to lookup the proxy endpoint, and one to to the endpoint itself
        var result = yield request
            .get(`http://localhost:${server.address().port}`)
            .query({proboBuildId: buildId})
            .end()

        result.res.text.should.eql("proxied page")
      } catch (e){
        if(e.response){
          console.log(e.response.error)
        }
        throw e
      }
    })

    // it("server missing", function* (){
    //   var buildId = "ccb2f22d-6b31-49e3-b95b-98ec823bd6f8"

    //   try {
    //     // makes 2 HTTP calls
    //     //  - one to lookup the proxy endpoint (first mock - 2nd time)
    //     //  - one to the endpoint itself (mocked to 500 second time)
    //     yield request
    //         .get(`http://localhost:${server.address().port}`)
    //         .query({proboBuildId: buildId})
    //         .end()
    //   } catch (e){
    //     // console.log(e.response)

    //     // confirm a 500 response (indicating lookup succeded, but proxied server isn't there)
    //     e.response.status.should.eql(500)
    //     e.response.text.should.eql(
    //       'Proxy error: connect ECONNREFUSED 127.0.0.1:49348\n'
    //     )
    //     return
    //   }
    //   throw new Error("should not reach here")
    // })

    it("bad build id", function* (){
      var buildId = "404"

      try {
        yield request
            .get(`http://localhost:${server.address().port}`)
            .query({proboBuildId: buildId})
            .end()
      } catch (e){
        // confirm a "Bad request" response (indicating lookup error)
        e.response.status.should.eql(400)
        e.response.text.should.eql(
          'Proxy error: {"code":"ResourceNotFound","message":"Build not found for build id: 404"}\n'
        )
      }
    })
  })


  describe("proxy rewrites", function(){
    function createProxyInfo(buildConfigSites, dest){
      // sample options that will be passed in to the rewriter
      // (just including the probo part)
      var options = {
        probo: {
          target: {
            url: 'http://localhost:49348/',
            dest: dest || {
              id: 'ccb2f22d-6b31-49e3-b95b-98ec823bd6f8', post: undefined
            },
            buildConfig: {
              image: 'lepew/ubuntu-14.04-lamp',
              sites: buildConfigSites
            }
          }
        }
      }

      var proxyReq = http.request({
        // representative default headers
        headers: {
          host: 'localhost:38937',
          'accept-encoding': 'gzip, deflate',
          'user-agent': 'node-superagent/1.3.0',
          connection: 'close',
          'x-forwarded-for': '::ffff:127.0.0.1',
          'x-forwarded-port': '38937',
          'x-forwarded-proto': 'http'
        }
      })

      return {proxyReq, options}
    }

    it("nothing by default", function(done){
      var proxyInfo = createProxyInfo()
      proxy_rewrite(proxyInfo.proxyReq, null, null, proxyInfo.options)

      "localhost:38937".should.eql(proxyInfo.proxyReq.getHeader('host'))
      done()
    })

    it("nothing by default but with sites specified", function(done){
      var proxyInfo = createProxyInfo({us: 'us.domain.com'})
      proxy_rewrite(proxyInfo.proxyReq, null, null, proxyInfo.options)

      "localhost:38937".should.eql(proxyInfo.proxyReq.getHeader('host'))
      done()
    })

    it("default domain with bare build id", function(done){
      var proxyInfo = createProxyInfo({ us: 'us.domain.com', default: 'domain.com' },
                                      { id: "buildid" })
      proxy_rewrite(proxyInfo.proxyReq, null, null, proxyInfo.options)

      "domain.com".should.eql(proxyInfo.proxyReq.getHeader('host'))
      done()
    })

    it("specified domain with postfix syntax", function(done){
      var proxyInfo = createProxyInfo({ us: 'us.domain.com', default: 'domain.com' },
                                      { id: "buildid", site: "us" })
      proxy_rewrite(proxyInfo.proxyReq, null, null, proxyInfo.options)

      "us.domain.com".should.eql(proxyInfo.proxyReq.getHeader('host'))
      done()
    })
  })

})
