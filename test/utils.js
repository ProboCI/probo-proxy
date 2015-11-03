var utils = require('../lib/utils')

describe("utils", function(){
  describe("getDest", function(){
    it("gets dest from query param", function(){
      var req = {
        url: '/?proboDest=1234'
      }

      var dest = utils.getDest(req)
      dest.should.eql('1234')
    })

    it("gets dest from proboBuildId query param (backwards compat)", function(){
      var req = {
        url: '/?proboBuildId=1234'
      }

      var dest = utils.getDest(req)
      dest.should.eql('1234')
    })

    it("gets dest from HOST subdomain", function(){
      var req = {
        url: '/',
        headers: {
          host: '1234.domain.com'
        }
      }

      var dest = utils.getDest(req)
      dest.should.eql('1234')
    })

    it("errors when no dest is found", function(){
      var req = {
        url: '/',
        headers: {
          host: 'domain.com'
        }
      };

      (function(){
        utils.getDest(req)
      }).should.throw('Destination identifier not found in domain or query param, host: domain.com, url: /')
    })
  })

  describe("parseDest", function(){
    it("bare buildId", function(){
      var dest = utils.parseDest("12345")
      dest.build.should.eql("12345")
    })

    it("buildId with site", function(){
      var dest_str = "12-345--site-us"
      var dest = utils.parseDest(dest_str)
      dest.should.eql({
        build: "12-345",
        site: "us",
        dest: dest_str
      })
    })

    it("modifier value can have dashes", function(){
      var dest_str = "12-345--site-us-awesome-site"
      var dest = utils.parseDest(dest_str)
      dest.should.eql({
        build: "12-345",
        site: "us-awesome-site",
        dest: dest_str
      })
    })

    it("project id with PR", function(){
      var dest_str = "12-345--pr-2"
      var dest = utils.parseDest(dest_str)
      dest.should.eql({
        project: "12-345",
        pr: "2",
        dest: dest_str
      })
    })

    it("project id with PR and site", function(){
      var dest_str = "12-345--pr-2--site-us"
      var dest = utils.parseDest(dest_str)
      dest.should.eql({
        project: "12-345",
        site: "us",
        pr: '2',
        dest: dest_str
      })
    })

    it("project id with branch", function(){
      var dest_str = "12-345--br-feature1"
      var dest = utils.parseDest(dest_str)
      dest.should.eql({
        project: "12-345",
        branch: "feature1",
        dest: dest_str
      })
    })

    it("project id with branch and site", function(){
      var dest_str = "12-345--br-feature2--site-us"
      var dest = utils.parseDest(dest_str)
      dest.should.eql({
        project: "12-345",
        site: "us",
        branch: 'feature2',
        dest: dest_str
      })
    })


    // test parse error conditions

    it("invalid modifier", function(){
      var dest_str = "12-345--blah";

      (function(){
        utils.parseDest(dest_str)
      }).should.throw("Destination identifier parse error: invalid modifier: blah")
    })

    it("invalid modifier type", function(){
      var dest_str = "12-345--hello-world";

      (function(){
        utils.parseDest(dest_str)
      }).should.throw("Destination identifier parse error: invalid modifier type: hello")
    })

    it("branch and pr should error", function(){
      var dest_str = "12-345--br-feature2--pr-34";

      (function(){
        utils.parseDest(dest_str)
      }).should.throw("Destination identifier parse error: PR specified (34), but branch already set (feature2)")
    })

    it("pr and branch should error", function(){
      var dest_str = "12-345--pr-34--br-feature2";

      (function(){
        utils.parseDest(dest_str)
      }).should.throw("Destination identifier parse error: branch specified (feature2), but PR already set (34)")
    })

    it("multiple site definitions should error", function(){
      var dest_str = "12-345--site-a--site-b";

      (function(){
        utils.parseDest(dest_str)
      }).should.throw("Destination identifier parse error: multiple site definitions not allowed: b")
    })

  })
})
