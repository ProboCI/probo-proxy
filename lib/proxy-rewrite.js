'use strict';

function rewrite(proxyReq, req, res, options) {
  // Get the build config sites definitions.
  var sites;
  var dest;
  try {
    sites = options.probo.target.buildConfig.sites;
    dest = options.probo.target.dest;
  }
  catch (e) {
    // ignore if we can't get to either
  }

  if (sites && dest) {
    var site = dest.site || 'default';
    var host = sites[site];

    if (host) {
      proxyReq.setHeader('host', host);
    }
  }
}

module.exports = rewrite;
