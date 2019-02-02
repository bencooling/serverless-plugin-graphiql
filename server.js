// dependencies
const http = require('http');
const fs = require('fs');
const path = require('path');
const createEvent = require('aws-event-mocks');

// utility functions
const readFile = file => new Promise((resolve, reject) =>
  fs.readFile(file, 'utf8', (err, data) =>
    (err) ? reject(err) : resolve(data)));

const getBody = req => new Promise(resolve => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', () => resolve(body));
});

// From serverless-offline
// https://github.com/dherault/serverless-offline
const listenForTermination = () => {
  // SIGINT will be usually sent when user presses ctrl+c
  const waitForSigInt = new Promise(resolve => {
    process.on('SIGINT', () => resolve('SIGINT'));
  });

  // SIGTERM is a default termination signal in many cases,
  // for example when "killing" a subprocess spawned in node
  // with child_process methods
  const waitForSigTerm = new Promise(resolve => {
    process.on('SIGTERM', () => resolve('SIGTERM'));
  });

  return Promise.race([waitForSigInt, waitForSigTerm]).then(command => {
    console.log(` Got ${command} signal. Graphiql Halting...`);
  });
};

const createRequestListener = handler => {

  const post = req => getBody(req).then(body => {
    const event = createEvent({
      template: 'aws:apiGateway',
      merge: { body: JSON.parse(body) },
    });
    return new Promise((resolve, reject) =>
      handler(event, {}, (err, data) => (err) ? reject(err) : resolve(data)));
  });

  const get = () =>
    readFile(path.join(__dirname, './index.html')).then(body => ({
      body,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }));

  const routes = {
    '/graphql': { get, post },
    '#': () => Promise.resolve({ statusCode: 404, body: 'Not found. Please visit /graphql. ' }),
  };

  return (req, res) => {
    const { method, url } = req;
    const defaults = {
      body: '',
      headers: { 'Content-Type': 'text/plain' },
      statusCode: 200,
    };
    const route = (routes[url]) ?
      routes[url][method.toLowerCase()] :
      routes['#'];
    route(req, res).then(data => {
      const { body, headers, statusCode } = Object.assign(defaults, data);
      res.writeHead(statusCode, headers);
      res.write(body);
      res.end();
    });
  };

};

// export api
module.exports = {
  start: ({ port = 8000, handler }) => {
    const requestListener = createRequestListener(handler);
    const server = http.createServer(requestListener);
    return new Promise(resolve => {
      server.on('clientError', (err, socket) => {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      });
      server.listen(port, () => {
        console.log('Server listening on: %s', port);
        resolve(server);
      });
    })
    .then(() => listenForTermination());
  },
};
