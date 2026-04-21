
const http = require('http');

function checkEndpoint(port) {
  console.log(`Checking port ${port}...`);
  const options = {
    hostname: '127.0.0.1',
    port: port,
    path: '/api/suppliers?page=1&limit=200',
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    timeout: 5000
  };

  const req = http.request(options, (res) => {
    console.log(`Port ${port} STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`Port ${port} BODY: ${data.substring(0, 500)}...`);
    });
  });

  req.on('error', (e) => {
    console.error(`Port ${port} ERROR: ${e.message}`);
  });

  req.end();
}

checkEndpoint(3002);
checkEndpoint(3003);
