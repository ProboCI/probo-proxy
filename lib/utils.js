var url = require('url')

/**
 * build id can be specified either via a subdomain or by
 * a proboBuildId request param
 */
function getBuildId(req){
  // check query first
  var query = url.parse(req.url, true).query
  if(query.proboBuildId){
    return query.proboBuildId
  }

  // check hostname
  var hostname = req.headers.host.split(':')[0] // includes port
  var parts = hostname.split('.')

  if(parts.length < 3){
    throw new Error("Build ID not found in domain or query param, host: " + req.headers.host)
  }

  // parse out buildid[.host.com] part
  var buildId = parts[0]

  return buildId
}

/**
 * Parses/decodes the build id into its parts.
 * For example, BUILDID--us would get parsed into
 *
 * Spec:
 *
 *  BUILDID[--post].probo.build
 *
 * Currently, the buildId is parsed out, and the whole original host is passed to the
 * server on the container directly
 *
 */
function parseBuildId(buildId){
  var parts = buildId.split('--')

  return {
    // pre: parts[1],
    id: parts[0],
    post: parts[1]
  }
}

function getAndParseBuildId(req){
  return parseBuildId(getBuildId(req))
}


module.exports = {
  getBuildId: getBuildId,
  parseBuildId: parseBuildId,
  getAndParseBuildId: getAndParseBuildId
}
