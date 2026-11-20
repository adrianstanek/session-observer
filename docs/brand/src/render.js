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
].find(candidate => fs.existsSync(candidate));
if (!browser) { console.error('No Chrome or Edge found; pass its path.'); process.exit(1); }

// renders a page with headless Chrome / Edge into a PNG of the given size
function screenshot(page, pngFile, width, height) {
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${width},${height}`, `--screenshot=${pngFile}`, pathToFileURL(page).href], { stdio: 'ignore' });
  console.log(path.relative(OUT, pngFile), `${width}x${height}`);
}

screenshot(path.join(SRC, 'cover.html'), path.join(OUT, 'cover.png'), 1280, 640);

// an icon is drawn into a page of its exact size, so small sizes render crisply instead of being scaled down
for (const name of ICONS) {
  const iconDir = path.join(OUT, name);
  fs.mkdirSync(iconDir, { recursive: true });
  fs.copyFileSync(path.join(SRC, `${name}.svg`), path.join(iconDir, `${name}.svg`));
  for (const size of SIZES) {
    const page = path.join(SRC, `.tmp-${name}-${size}.html`);
    fs.writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}img{display:block;width:${size}px;height:${size}px}</style><img src="${name}.svg">`);
    try { screenshot(page, path.join(iconDir, `${name}-${size}.png`), size, size); } finally { fs.unlinkSync(page); }
  }
}
