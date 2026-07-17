'use strict';

var fs = require('fs');

var log = require('./logger').getLogger('template');

// Rendered template sources are read from disk once and memoized here, keyed by
// absolute path. A failed read is memoized as null so we don't retry every hit.
var cache = {};

/**
 * Load a template file (memoized) and substitute {{name}} placeholders.
 * Placeholders with no matching key render as empty. If the file cannot be
 * read, `fallback` is rendered instead so a missing/bad template never takes
 * the proxy down.
 *
 * @param {string} templatePath - Absolute path to the template file.
 * @param {object} vars - Map of placeholder name -> value.
 * @param {string} fallback - Template string to use if the file can't be read.
 * @return {string} The rendered output.
 */
function render(templatePath, vars, fallback) {
  var source = load(templatePath);
  if (source === null) {
    source = fallback || '';
  }

  return source.replace(/{{\s*(\w+)\s*}}/g, function (match, key) {
    return vars && vars[key] !== undefined ? String(vars[key]) : '';
  });
}

function load(templatePath) {
  if (Object.prototype.hasOwnProperty.call(cache, templatePath)) {
    return cache[templatePath];
  }

  var source = null;
  try {
    source = fs.readFileSync(templatePath, 'utf8');
  } catch (e) {
    log.warn({ err: e, templatePath: templatePath }, 'could not read template; using fallback');
  }

  cache[templatePath] = source;
  return source;
}

module.exports = { render: render };
