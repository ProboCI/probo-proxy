var proxy = require('./lib/proxy')
var config = require('./lib/config')
var log = require('./lib/logger').getLogger()

config.load(function(error, config) {
  if (error){
    throw error
  }

  proxy.listen(config.port, function(){
    log.info("listening on port", proxy.address().port)
    log.debug({config: config}, "config")
  });
});
