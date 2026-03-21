'use strict';

const bunyan = require('bunyan');

var logger = null;

function createLogger(config) {
  var streams = [];

  if (config && config.logFile) {
    streams.push({
      type: 'rotating-file',
      path: config.logFile,
      period: config.logRotatePeriod || '1d',
      count: config.logRotateCount || 14,
    });
  } else {
    streams.push({
      stream: process.stdout,
    });
  }

  logger = bunyan.createLogger({
    name: 'proxy',
    level: (config && config.logLevel) || 'debug',
    src: true,
    serializers: bunyan.stdSerializers,
    streams: streams,
  });

  return logger;
}

module.exports = {
  getLogger: function (component) {
    if (!logger) {
      createLogger();
    }
    if (component) {
      return logger.child({ component: component });
    } else {
      return logger;
    }
  },
  createLogger: createLogger,
};
