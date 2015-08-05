var bunyan, logger;

bunyan = require('bunyan');

logger = bunyan.createLogger({
  name: "proxy",
  level: 'debug',
  src: true,
  serializers: bunyan.stdSerializers,
  streams: [
    {
      stream: process.stdout
    }
  ]
});

module.exports = {
  getLogger: function(component) {
    if(component) {
      return logger.child({component: component})
    }
    else {
      return logger;
    }
  }
};
