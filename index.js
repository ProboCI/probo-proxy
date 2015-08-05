var proxy = require('./lib/proxy')
var config = require('./lib/config')
var log = require('./lib/logger').getLogger()

config.load(function(error, config) {
  if (error){
    throw error
  }

  proxy.listen(5050);
  log.info("listening on port 5050")
  log.debug({config: config}, "config")
});
