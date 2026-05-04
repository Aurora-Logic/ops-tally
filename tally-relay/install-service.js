const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'OPS Tally Relay',
  description: 'Background relay agent for syncing OPS orders with Tally Prime.',
  script: path.join(__dirname, 'relay.js'),
  env: [
    {
      name: "NODE_ENV",
      value: "production"
    }
  ]
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function() {
  console.log('OPS Tally Relay Service installed successfully!');
  svc.start();
});

svc.install();
