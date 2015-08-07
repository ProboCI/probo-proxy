var path = require('path'),
    util = require('util')

var Loader = require('yaml-config-loader');
var yargs = require('yargs');
var loader = new Loader();

var log = require('./logger').getLogger("config")

loader.on('error', function(error){
  if (error.name === 'YAMLException') {
    log.error({err: error}, util.print('Error parsing YAML file `', error.filePath, '`:', error.reason));
  }
});

var argv = yargs
  .describe('port', 'The port to listen on.')
  .alias('port', 'p')
  .describe('config', 'A YAML config file or directory of yaml files to load, can be invoked multiple times and later files will override earlier.')
  .alias('config', 'c')
  .argv;

loader.add(path.resolve(path.join(__dirname, '..', 'defaults.yaml')), {filterKeys: true});
loader.addAndNormalizeObject(process.env);

if (argv.config) {
  if (typeof argv.config === 'string') {
    argv.config = [ argv.config ];
  }
  for (var i in argv.config) {
    loader.add(path.resolve(argv.config[i]));
  }
}

var setOptions = {};
var key = null;
for (key in yargs.argv) {
  if (yargs.argv[key] !== undefined) {
    setOptions[key] = yargs.argv[key];
  }
}
loader.addAndNormalizeObject(setOptions);


var loaded_config = null
function load(cb){
  if(loaded_config){
    log.debug("returning pre-loaded config")

    if(typeof cb === 'function'){
      cb(null, loaded_config)
    }
    return loaded_config
  }

  loader.load(function(error, config) {
    if (error) return cb && cb(error)

    loaded_config = config
    if(typeof cb === 'function'){
      cb(null, loaded_config)
    }
  });
}

module.exports = {load}
