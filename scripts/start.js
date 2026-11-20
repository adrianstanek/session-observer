#!/usr/bin/env node
// Starts the dashboard server in the background (if it isn't running) and prints its URL.
'use strict';
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.OBSERVER_PORT || 4777);
const dashboardUrl = `http://localhost:${PORT}`;

function startServer() {
  const serverScript = path.join(__dirname, '..', 'server', 'server.js');
  const child = spawn(process.execPath, [serverScript], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  console.log(`Session Observer started → ${dashboardUrl}`);
}

// something answering on the port is the server already running
const socket = net.connect({ port: PORT, host: '127.0.0.1' });
socket.once('connect', () => { socket.destroy(); console.log(`Session Observer already running → ${dashboardUrl}`); });
socket.once('error', startServer);
