'use strict';

// NOCK CONFIGUATION
var defaultNockMode = 'PLAY';

var nock = require('nock');
// opts: {processor, not_required, mode}
function initNock(fixture, opts) {
  var fixtureFile = './test/fixtures/' + fixture;

  var nocked = {};
  var requiredNocks = [];

  opts = opts || {};
  opts.not_required = opts.not_required || [];

  var nockMode = opts.mode || defaultNockMode;

  var nocks;
  if (nockMode === 'PLAY') {
    nocks = nock.load(fixtureFile);

    if (opts.processor) {
      nocks = opts.processor(nocks);
    }

    nocks.forEach(function(n, i) {
      nocked['loaded_' + i] = n;
    });

    // allow some mocks to be not required
    Object.keys(nocked).filter(function(name) {
      return opts.not_required.indexOf(name) < 0;
    }).forEach(function(name) {
      requiredNocks.push(nocked[name]);
    });
  }

  if (nockMode === 'RECORD') {
    console.log('recording');
    nock.recorder.rec({
      output_objects: true,
      dont_print: true,
    });
  }

  return {
    nocked: nocked,
    nocks: nocks,
    required: requiredNocks,
    cleanup: function() {
      if (nockMode === 'RECORD') {
        var nockCallObjects = nock.recorder.play();
        require('fs').writeFileSync(fixtureFile, JSON.stringify(nockCallObjects, null, 2));
      }

      // makesure all internal calls were made
      try {
        requiredNocks.forEach(function(n) {
          n.done();
        });
      }
      finally {
        nock.cleanAll();
      }
    },
  };
}


module.exports = initNock;
