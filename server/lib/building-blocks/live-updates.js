// Server-Sent Events: the open dashboard pages, and the messages pushed to them.
'use strict';

const RECONNECT_DELAY_MS = 2000; // how long a page waits before reconnecting after the stream drops
const clients = new Set(); // open /api/stream responses
let started = false;       // nothing is pushed while the server is still loading the log at start-up

const sseMessage = (type, payload) => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;

function broadcast(type, payload) {
  if (!started) return;
  const message = sseMessage(type, payload);
  for (const response of clients) response.write(message);
}

function addClient(request, response, helloPayload) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  response.write(`retry: ${RECONNECT_DELAY_MS}\n\n`);
  response.write(sseMessage('hello', helloPayload)); // on every (re)connect, so a restarted server shows its own version
  clients.add(response);
  request.on('close', () => clients.delete(response));
}

const pingClients = () => { for (const response of clients) response.write(': ping\n\n'); };
const startBroadcasting = () => { started = true; };
const isBroadcasting = () => started;

module.exports = { broadcast, addClient, pingClients, startBroadcasting, isBroadcasting };
