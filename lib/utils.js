'use strict';

var url = require('url');

var parseErrorPrefix = 'Destination identifier parse error: ';

/**
 * destination identifier can be specified either via a subdomain or by
 * a proboDest/proboBuildId request param
 */
function getDest(req) {
  // check query first
  var query = url.parse(req.url, true).query;
  if (query.proboDest || query.proboBuildId) {
    return query.proboDest || query.proboBuildId;
  }

  // Check the hostname. The hostname includes the port.
  var hostname = req.headers.host.split(':')[0];
  var parts = hostname.split('.');

  if (parts.length < 3) {
    throw new Error(`Destination identifier not found in domain or query param, host: ${req.headers.host}, url: ${req.url}`);
  }

  // parse out buildid[.host.com] part
  var dest = parts[0];

  return dest;
}

/**
 * Parses/decodes the build id into its parts.
 * For example, BUILDID--site-us would get parsed into build:BUILDID, site: us
 *
 * Spec (simplified EBNF):
 *
 *  dest = build id | project id | project alias , {modifier} ;
 *  modifier = separator , ( pr modifier | branch modifier | site modifier ) ;
 *  separator = "--" ;
 *  pr modifier = "pr-" , pr number ;
 *  branch modifier = "br-" , branch name ;
 *  site modifier = "site-" , site identifier ;
 *  (* The following are specified as regexps for convenience: *)
 *  build id = ? /[0-9a-zA-Z-]+/ ? ;
 *  project id = ? /[0-9a-zA-Z-]+/ ? ;
 *  project alias = ? /[0-9a-zA-Z-]+/ ? ;
 *  pr number = ? /[1-9][0-9]* / ? ;
 *  branch name = ? /[0-9a-zA-Z-]+/ ? ;
 *  site identifier name = ? /[0-9a-zA-Z-]+/ ? ;
 *
 * Examples:
 *   "ccb2f22d-6b31-49e3-b95b-98ec823bd6f8"                      --  build id
 *   "ccb2f22d-6b31-49e3-b95b-98ec823bd6f8--site-us"             --  build id with site identifier
 *   "123e4567-e89b-12d3-a456-426655440000--pr-2"                --  project id with pull request number
 *   "123e4567-e89b-12d3-a456-426655440000--pr-2--site-us"       --  project id with pull request number and site identifier
 *   "123e4567-e89b-12d3-a456-426655440000--br-master"           --  project id with branch name (master)
 *   "123e4567-e89b-12d3-a456-426655440000--br-master--site-us"  --  project id with branch name (master)
 *   "github-proboci-probo-proxy--pr-23"                         --  project alias with pull request number
 *
 */
function parseDest(dest) {
  var modifiers = dest.split('--');

  var identifier = modifiers[0];
  var ret = {
    dest: dest,
  };

  var i;
  for (i = 1; i < modifiers.length; i++) {
    var modifier = parseModifier(modifiers[i]);
    switch (modifier.type) {
      case 'pr':
        setPr(ret, modifier);
        ret.project = identifier;
        break;
      case 'br':
        setBranch(ret, modifier);
        ret.project = identifier;
        break;
      case 'site':
        setSite(ret, modifier);
        break;
      default:
        throw new Error(parseErrorPrefix + 'invalid modifier type: ' + modifier.type);
    }
  }

  if (!ret.project) {
    ret.build = identifier;
  }

  return ret;

  function parseModifier(modifier) {
    var parts = modifier.split('-');

    if (!parts[1]) {
      throw new Error(parseErrorPrefix + 'invalid modifier: ' + modifier);
    }

    // Reassemble parts[1:] pieces into a string
    return {
      type: parts[0],
      value: parts.slice(1).join('-'),
      modifier: modifier,
    };
  }

  function setBranch(dest, branch) {
    if (dest.pr) {
      throw new Error(parseErrorPrefix + `branch specified (${branch.value}), but PR already set (${dest.pr})`);
    }

    dest.branch = branch.value;
  }

  function setPr(dest, pr) {
    if (dest.branch) {
      throw new Error(parseErrorPrefix + `PR specified (${pr.value}), but branch already set (${dest.branch})`);
    }

    dest.pr = pr.value;
  }

  function setSite(dest, site) {
    if (dest.site) {
      throw new Error(parseErrorPrefix + `multiple site definitions not allowed: ${site.value}`);
    }

    dest.site = site.value;
  }
}

function getAndParseDest(req) {
  return parseDest(getDest(req));
}


module.exports = {
  getDest: getDest,
  parseDest: parseDest,
  getAndParseDest: getAndParseDest,
};
