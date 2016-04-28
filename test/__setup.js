'use strict';

// This file is name __setup so that it gets loaded first
// and performs initialization for tests
require('co-mocha');

// effectivley silence the logging
delete process.env.GRAYLOG_HOST;
var logger = (require('../lib/logger')).getLogger();
logger._level = Number.POSITIVE_INFINITY;

// APP CONFIGURATION

// this will be nocked out
process.env.CONTAINER_LOOKUP_HOST = 'http://localhost:3020';

// disable caching
process.env.CACHE_ENABLED = false;
