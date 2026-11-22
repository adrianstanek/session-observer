#!/usr/bin/env node
// Stops the dashboard server on PORT and starts the newest installed plugin version's server.
// Used after a plugin update: the old server keeps running in the background until it is stopped.
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = Number(process.env.OBSERVER_PORT || 4777);
const PORT_FREE_TIMEOUT_MS = 5000;
const PORT_POLL_MS = 200;
const SERVER_COMMAND_LINE = /server\.js/;
const PLUGIN_SERVER_COMMAND_LINE = /session-observer.*server\.js/;
const NODE_COMMAND = /^\s*\d+\s+(\S*[/\\])?node(\.exe)?\s/; // a `ps -eo pid=,args=` line of a node process

const pluginRoot = path.join(__dirname, '..');

// The marketplace cache keeps one folder per version (…/session-observer/0.7.1); pick the newest.
// A clone run with --plugin-dir has no version folders, so it restarts itself.
function newestPluginRoot() {
  const versionsDir = path.dirname(pluginRoot);
  const isVersion = (name) => /^\d+\.\d+\.\d+$/.test(name);
  if (!isVersion(path.basename(pluginRoot))) return pluginRoot;
  const byVersion = (a, b) => {
    const [pa, pb] = [a, b].map((v) => v.split('.').map(Number));
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  };
  const versions = fs.readdirSync(versionsDir).filter(isVersion)
    .filter((v) => fs.existsSync(path.join(versionsDir, v, 'scripts', 'start.js')))
    .sort(byVersion);
  return versions.length ? path.join(versionsDir, versions[versions.length - 1]) : pluginRoot;
}

// The pids listening on PORT, so only the dashboard on this port is stopped, not a server on another port; null when
// no lookup command works here (lsof and ss are both missing on some minimal Linux installs).
function pidsListeningOnPort() {
  const lookups = process.platform === 'win32' ? [
    ['powershell.exe', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess }`],
      (output) => output.split(/\r?\n/).map(Number)],
  ] : [
    ['lsof', ['-t', '-iTCP:' + PORT, '-sTCP:LISTEN'], (output) => output.split('\n').map(Number)],
    ['ss', ['-ltnpH', `sport = :${PORT}`], (output) => [...output.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]))],
  ];
  for (const [command, args, pidsOf] of lookups) {
    try {
      return new Set(pidsOf(execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).filter(Boolean));
    } catch (error) {
      if (error.code === 'ENOENT') continue; // not installed: try the next one
      // it ran, and found nothing: lsof and Get-NetTCPConnection exit non-zero when nothing listens
      return new Set(pidsOf(String(error.stdout || '')).filter(Boolean));
    }
  }
  return null;
}

// Node processes running a server.js that listen on PORT (one started with a relative path included). Without a port
// lookup, the plugin's own servers by their command line, as before: never stop nothing, nor a stranger's server.js.
function runningServerPids() {
  const listening = pidsListeningOnPort();
  return nodeServerProcesses()
    .filter(({ pid, commandLine }) => (listening ? listening.has(pid) : PLUGIN_SERVER_COMMAND_LINE.test(commandLine)))
    .map(({ pid }) => pid);
}

function nodeServerProcesses() {
  try {
    if (process.platform === 'win32') {
      const script = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
      const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
      return output.split(/\r?\n/).filter((line) => SERVER_COMMAND_LINE.test(line))
        .map((line) => ({ pid: Number(line.split('\t')[0]), commandLine: line }));
    }
    const output = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    return output.split('\n').filter((line) => NODE_COMMAND.test(line) && SERVER_COMMAND_LINE.test(line))
      .map((line) => ({ pid: Number(line.trim().split(/\s+/)[0]), commandLine: line }));
  } catch { return []; }
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ port: PORT, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function waitForFreePort() {
  const deadline = Date.now() + PORT_FREE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await portInUse())) return true;
    await new Promise((resolve) => setTimeout(resolve, PORT_POLL_MS));
  }
  return false;
}

async function main() {
  const pids = runningServerPids().filter((pid) => pid && pid !== process.pid);
  for (const pid of pids) {
    try { process.kill(pid); console.log(`Stopped dashboard server (pid ${pid})`); } catch { /* already gone */ }
  }
  if (!pids.length) console.log('No dashboard server was running');
  if (!(await waitForFreePort())) {
    console.log(`Port ${PORT} is still in use by another program; stop it and run this again.`);
    process.exitCode = 1;
    return;
  }
  const root = newestPluginRoot();
  console.log(`Starting ${path.basename(root)} from ${root}`);
  execFileSync(process.execPath, [path.join(root, 'scripts', 'start.js')], { stdio: 'inherit', env: process.env });
}

main();
