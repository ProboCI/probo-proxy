var util = require('util')
var request = require('request')
var should = require('should')

var utils = require('../lib/utils')

describe("utils", function(){
  describe("getBuildId", function(){
    it("gets buildId from query param", function(){
      var req = {
        url: '/?proboBuildId=1234'
      }

      var buildId = utils.getBuildId(req)
      buildId.should.eql('1234')
    })

    it("gets buildId from HOST subdomain", function(){
      var req = {
        url: '/',
        headers: {
          host: '1234.domain.com'
        }
      }

      var buildId = utils.getBuildId(req)
      buildId.should.eql('1234')
    })

    it("errors when no buildId is found", function(){
      var req = {
        url: '/',
        headers: {
          host: 'domain.com'
        }
      };

      (function(){
        utils.getBuildId(req)
      }).should.throw('Build ID not found in domain or query param, host: domain.com')
    })
  })

  describe("parseBuildId", function(){
    it("bare buildId", function(){
      var build = utils.parseBuildId("12345")
      build.id.should.eql("12345")
    })

    // it("buildId with prefix", function(){
    //   var build = utils.parseBuildId("aaa--12345")
    //   build.should.eql({
    //     id: "12345",
    //     pre: "aaa",
    //     post: undefined
    //   })
    // })

    it("buildId with postfix", function(){
      var build = utils.parseBuildId("12345--bbb")
      build.should.eql({
        id: "12345",
        // pre: undefined,
        post: "bbb"
      })
    })

    it("buildId with dashes and post", function(){
      var build = utils.parseBuildId("12-345--bbb")
      build.should.eql({
        id: "12-345",
        // pre: "aaa",
        post: "bbb"
      })
    })
  })
})
