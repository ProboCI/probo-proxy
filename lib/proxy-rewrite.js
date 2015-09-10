var util = require('util')


function rewrite(proxyReq, req, res, options) {
  //proxyReq.setHeader('X-Special-Proxy-Header', 'foobar');
  // console.log(util.inspect(options, null, 5))
  // console.log("req headers:", proxyReq._headers)

  // get the build config sites definitions
  var sites, dest
  try {
    sites = options.probo.target.buildConfig.sites
    dest = options.probo.target.dest
  } catch (e) {
    // ignore if we can't get to either
  }

  if(sites && dest){
    var site = dest.site || "default"
    var host = sites[site]

    if(host){
      proxyReq.setHeader("host", host)
    }
  }
}

module.exports = rewrite
