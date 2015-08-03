var path = require('path'),
    util = require('util')

var Loader = require('yaml-config-loader');
var yargs = require('yargs');
var loader = new Loader();

loader.on('error', function(error){
  if (error.name === 'YAMLException') {
    console.error(util.print('Error parsing YAML file `', error.filePath, '`:', error.reason));
    console.log(error);
  }
});

var argv = yargs
  .describe('config', 'A YAML config file or directory of yaml files to load, can be invoked multiple times and later files will override earlier.')
  .alias('config', 'c')
  .argv;

loader.add(path.resolve(path.join(__dirname, '..', 'defaults.yaml')), {filterKeys: true});
loader.addAndNormalizeObject(process.env);

var loaded_config = null
function load(cb){
  if(loaded_config){
    console.log("returning pre-loaded config")

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
