#!/usr/bin/env node
// Renders the repo cover (src/cover.html → cover.png, 1280x640) and the app icon (src/icon-eye.svg → icon-eye/, 16-512 px)
// with headless Chrome or Edge. Run it after editing either source.
// Usage: node docs/brand/src/render.js [path-to-chrome]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const SRC = __dirname, OUT = path.join(__dirname, '..');
const ICONS = ['icon-eye'];
const SIZES = [16, 32, 48, 64, 128, 180, 256, 512];
const browser = process.argv[2] || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(p => fs.existsSync(p));
if (!browser) { console.error('No Chrome or Edge found; pass its path.'); process.exit(1); }

function shot(file, out, w, h) {
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${w},${h}`, `--screenshot=${out}`, pathToFileURL(file).href], { stdio: 'ignore' });
  console.log(path.relative(OUT, out), `${w}x${h}`);
}

shot(path.join(SRC, 'cover.html'), path.join(OUT, 'cover.png'), 1280, 640);

// an icon is drawn into a page of its exact size, so small sizes render crisply instead of being scaled down
for (const name of ICONS) {
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(SRC, `${name}.svg`), path.join(dir, `${name}.svg`));
  for (const size of SIZES) {
    const page = path.join(SRC, `.tmp-${name}-${size}.html`);
    fs.writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}img{display:block;width:${size}px;height:${size}px}</style><img src="${name}.svg">`);
    try { shot(page, path.join(dir, `${name}-${size}.png`), size, size); } finally { fs.unlinkSync(page); }
  }
}
