'use strict';

var ms = require('ms')

var config = require('./lib/config');

process.title = 'probo-proxy'

config.load(function(error, config) {
  if (error) {
    throw error;
  }

  var server = require('./lib/proxy').server;
  var log = require('./lib/logger').getLogger();

  server.timeout = ms(config.serverTimeout || '10m');

  server.listen(config.port, function() {
    log.info('listening on port', server.address().port);
    log.debug({config: config}, 'config');
  });
});
