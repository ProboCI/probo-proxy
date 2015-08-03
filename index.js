var proxy = require('./lib/proxy')
var config = require('./lib/config')

config.load(function(error, config) {
  if (error){
    throw error
  }

  proxy.listen(5050);
  console.log("listening on port 5050")
  console.log("config: ", config)
});
