// Language / tool detection for the dashboard's badges. The code lives in the dashboard's inline script,
// between the ">>> tech" and "<<< tech" markers; this runs that part on its own.
// Zero dependencies — run with `node --test test/tech.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'server', 'dashboard.html'), 'utf8');
const block = html.match(/\/\/ >>> tech[^\n]*\n([\s\S]*?)\/\/ <<< tech/);
assert.ok(block, 'tech block markers not found in server/dashboard.html');
// the few helpers the block takes from the rest of the script
const pre = `
  const base = p => String(p || '').split(/[\\\\/]/).filter(Boolean).pop() || p || '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS']);
  const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash', 'Monitor']);
`;
const T = new Function(pre + block[1] + '\nreturn { TECH, TECH_SHAPE, TECH_EXT, TECH_CMD, TECH_FILE, fileTech, nameTech, shellSegments, progWord, techsOf, techOf, techMark, techIcon, techIcons };')();

const sh = (command, tool = 'Bash') => T.techOf(tool, { command });
const file = (file_path, tool = 'Edit') => T.techOf(tool, { file_path });

test('shell commands: the program being run', () => {
  assert.equal(sh('node scripts/seed.js'), 'node');
  assert.equal(sh("node -e 'console.log(1)'"), 'node');
  assert.equal(sh('dotnet build -c Release'), 'dotnet');
  assert.equal(sh('dotnet test && git status'), 'dotnet');
  assert.equal(sh('npm test'), 'npm');
  assert.equal(sh('npx tsc --noEmit'), 'npm');
  assert.equal(sh('python3 -m pytest -q'), 'py');
  assert.equal(sh('pip install -r requirements.txt'), 'py');
  assert.equal(sh('docker compose up -d redis'), 'docker');
  assert.equal(sh('./gradlew assembleDebug'), 'gradle');
  assert.equal(sh('cargo build --release'), 'rs');
  assert.equal(sh('go test ./...'), 'go');
  assert.equal(sh('git status'), 'git');
  assert.equal(sh('gh pr view 5'), 'github');
  assert.equal(sh('kubectl get pods'), 'k8s');
});

test('shell commands: what comes before the program is skipped', () => {
  assert.equal(sh('cd api && dotnet test'), 'dotnet');
  assert.equal(sh('cd /d/git/app; NODE_ENV=test node run.js'), 'node');
  assert.equal(sh('sudo docker ps'), 'docker');
  assert.equal(sh('timeout 30 node server.js'), 'node');
  assert.equal(sh('cat data.json | jq .name'), 'json');
  assert.equal(sh('"C:\\Program Files\\dotnet\\dotnet.exe" --info'), 'dotnet');
  assert.equal(sh('/usr/local/bin/python3.12 app.py'), 'py');
  assert.equal(sh('for f in *.cs; do dotnet format "$f"; done'), 'dotnet');
  assert.equal(sh('./build.ps1 -Configuration Release'), 'ps');
  assert.equal(sh('# build it\ndotnet build'), 'dotnet');
  assert.equal(sh('JAVA_HOME="/d/JetBrains Rider 2024.2.7/jbr" ./gradlew test --console=plain 2>&1 | tail -30'), 'gradle');
  assert.equal(sh('"$R/jbr/bin/java.exe" -version'), 'java');
  assert.equal(sh('OUT=$(ls -d build) dotnet publish -o "$OUT"'), 'dotnet');
  assert.equal(sh('X=$(dirname node) ; ls'), null);
});

test('shell commands: names inside quotes, heredocs and arguments do not count', () => {
  assert.equal(sh('echo "run npm install; then node app"'), null);
  assert.equal(sh('ls -la && cat README.md'), null);
  assert.equal(sh('grep -rn "dotnet" docs'), null);
  assert.equal(sh("cat > notes.txt <<'EOF'\nnode is great; python too\nEOF"), null);
  assert.equal(sh("python3 - <<'EOF'\nimport os; print(os.getcwd())\nEOF"), 'py');
  assert.equal(sh('echo done 2>&1'), null);
  assert.equal(sh(''), null);
  assert.equal(sh(undefined), null);
});

test('chained commands: every program in the chain, each once, in order', () => {
  const all = (command, tool = 'Bash') => T.techsOf(tool, { command });
  assert.deepEqual(all('cd api && npm ci && dotnet build && dotnet test'), ['npm', 'dotnet']);
  assert.deepEqual(all('git stash && dotnet test; git stash pop'), ['git', 'dotnet']);
  assert.deepEqual(all('npm run build && docker build -t app . && docker push app && kubectl rollout restart deploy/app'), ['npm', 'docker', 'k8s']);
  assert.deepEqual(all('cat data.json | jq .name | node fmt.js'), ['json', 'node']);
  assert.deepEqual(all('ls -la && cat README.md'), []);
  assert.deepEqual(all('Get-ChildItem', 'PowerShell'), ['ps']);
  assert.deepEqual(all('dotnet build; if ($?) { node post.js }', 'PowerShell'), ['dotnet', 'node']);
  assert.deepEqual(T.techsOf('Edit', { file_path: 'src/Orders/OrderService.cs' }), ['cs']);
  assert.deepEqual(T.techsOf('WebFetch', { url: 'https://example.com' }), []);
  // the first one is what techOf gives (the badge a Route stop is drawn with)
  assert.equal(sh('git stash && dotnet test'), 'git');
  // badges in a row: at most three, then "+n"
  assert.equal((T.techIcons(['npm', 'docker', 'k8s']).match(/<svg/g) || []).length, 3);
  assert.match(T.techIcons(['npm', 'docker', 'k8s', 'git', 'node']), /class="tmore" title="Git, Node\.js">\+2<\/span>$/);
  assert.equal(T.techIcons([]), '');
});

test('the PowerShell tool: its own badge unless the command runs a known program', () => {
  assert.equal(sh('Get-ChildItem -Recurse', 'PowerShell'), 'ps');
  assert.equal(sh('dotnet build; if ($?) { dotnet test }', 'PowerShell'), 'dotnet');
  assert.equal(sh("$env:ASPNETCORE_ENVIRONMENT='Development'; dotnet run", 'PowerShell'), 'dotnet');
  assert.equal(sh('& "C:\\Program Files\\nodejs\\node.exe" -v', 'PowerShell'), 'node');
});

test('files: the language by extension', () => {
  assert.equal(file('D:\\git\\app\\src\\Orders\\OrderService.cs'), 'cs');
  assert.equal(file('/home/me/app/src/index.ts'), 'ts');
  assert.equal(file('src/App.tsx'), 'react');
  assert.equal(file('app/src/main/java/Main.kt'), 'kt');
  assert.equal(file('server/dashboard.html'), 'html');
  assert.equal(file('scripts/hook.js'), 'js');
  assert.equal(file('README.md'), 'md');
  assert.equal(file('deploy/values.yaml'), 'yaml');
  assert.equal(file('db/001_init.sql', 'Write'), 'sql');
  assert.equal(file('notes.txt'), null);
  assert.equal(file('LICENSE'), null);
  assert.equal(file(undefined), null);
});

test('files: names that say more than their extension', () => {
  assert.equal(file('api/Api.csproj'), 'dotnet');
  assert.equal(file('App.sln'), 'dotnet');
  assert.equal(file('src/Api/appsettings.Development.json'), 'dotnet');
  assert.equal(file('package.json'), 'npm');
  assert.equal(file('tsconfig.build.json'), 'ts');
  assert.equal(file('Dockerfile'), 'docker');
  assert.equal(file('docker-compose.override.yml'), 'docker');
  assert.equal(file('app/build.gradle.kts'), 'gradle');
  assert.equal(file('Cargo.toml'), 'rs');
  assert.equal(file('.github/workflows/ci.yml'), 'github');
  assert.equal(file('.gitignore'), 'git');
});

test('Glob and Grep: the language they look for', () => {
  assert.equal(T.techOf('Glob', { pattern: 'src/**/*.cs' }), 'cs');
  assert.equal(T.techOf('Glob', { pattern: '**/*.{ts,tsx}' }), 'ts');
  assert.equal(T.techOf('Glob', { pattern: '**/*' }), null);
  assert.equal(T.techOf('Grep', { pattern: 'TODO', glob: '*.py' }), 'py');
  assert.equal(T.techOf('Grep', { pattern: 'fn main', type: 'rust' }), 'rs');
  assert.equal(T.techOf('Grep', { pattern: 'x', path: 'server/dashboard.html' }), 'html');
  assert.equal(T.techOf('Grep', { pattern: 'x', path: 'src' }), null);
});

test('other tools have no badge', () => {
  assert.equal(T.techOf('WebFetch', { url: 'https://nodejs.org/api/fs.js' }), null);
  assert.equal(T.techOf('Agent', { description: 'check the node version' }), null);
  assert.equal(T.techOf(undefined, {}), null);
});

test('every id used by a table has a badge, and every badge draws', () => {
  const ids = new Set([...Object.values(T.TECH_EXT), ...T.TECH_CMD.map(x => x[1]), ...T.TECH_FILE.map(x => x[1]), 'github', 'ps']);
  for (const id of ids) assert.ok(T.TECH[id], `no badge for "${id}"`);
  for (const [id, k] of Object.entries(T.TECH)) {
    assert.equal(k.length, 5, id);
    assert.ok(T.TECH_SHAPE[k[1]], `${id}: unknown shape ${k[1]}`);
    const svg = T.techIcon(id);
    assert.match(svg, /^<svg class="ic tech"[\s\S]*<\/svg>$/, id);
    assert.ok(svg.includes(`<title>${k[0].replace(/&/g, '&amp;')}</title>`), id);
  }
  assert.equal(T.techIcon('nope'), '');
  assert.equal(T.techIcon(null), '');
  // a monogram is escaped text, a glyph is passed through as SVG
  assert.match(T.techMark('xml'), /&lt;&gt;<\/text>/);
  assert.match(T.techMark('ps'), /^<g [^>]*><path /);
});
