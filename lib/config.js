'use strict';

var path = require('path');
var util = require('util');

var Loader = require('yaml-config-loader');
var yargs = require('yargs');
var loader = new Loader();

var log = require('./logger').getLogger('config');

loader.on('error', function(error) {
  if (error.name === 'YAMLException') {
    log.error({err: error}, util.print('Error parsing YAML file `', error.filePath, '`:', error.reason));
  }
});

var argv = yargs
  .option('port', {
    alias: 'p',
    describe: 'The port to listen on.',
    type: 'number',
  })
  .option('config', {
    alias: 'c',
    describe: 'A YAML config file or directory of yaml files to load, can be invoked multiple times and later files will override earlier.',
    type: 'string',
  })
  .argv;

loader.add(path.resolve(path.join(__dirname, '..', 'defaults.yaml')));
loader.addAndNormalizeObject(process.env);

if (argv.config) {
  if (typeof argv.config === 'string') {
    argv.config = [argv.config];
  }
  for (let conf of argv.config) {
    loader.add(path.resolve(conf));
  }

  argv.config.forEach(function(val) {
    loader.add(path.resolve(val));
  });
}

var setOptions = {};
var key = null;
for (key in yargs.argv) {
  if (yargs.argv.hasOwnProperty(key)) {
    setOptions[key] = yargs.argv[key];
  }
}
loader.addAndNormalizeObject(setOptions);


var loadedConfig = null;
function load(cb) {
  if (loadedConfig) {
    log.debug('returning pre-loaded config');

    if (typeof cb === 'function') {
      cb(null, loadedConfig);
    }
    return loadedConfig;
  }

  loader.load(function(error, config) {
    if (error) {
      return cb && cb(error);
    }

    loadedConfig = config;
    if (typeof cb === 'function') {
      cb(null, loadedConfig);
    }
  });
}

module.exports = {load};
