'use strict';
// Session Observer dashboard — language and tool badges: what a tool call works with, and how its badge is drawn.
// ---------------------------------------------------------------- languages & tools
// What a tool call works with: the language of the file it reads or edits (C#, Kotlin, HTML…) or the program
// a shell command runs (node, dotnet, docker…). Each one has a badge drawn right here — its usual colour, a
// shape and a monogram or a small glyph — so there are no image files and nothing is downloaded.
// id: [name, shape, background, foreground, monogram | glyph (SVG in the 24×24 box, drawn in the foreground colour)]
const TECH = {
  js: ['JavaScript', 'sq', '#f7df1e', '#1b1d22', 'JS'],
  ts: ['TypeScript', 'sq', '#3178c6', '#fff', 'TS'],
  react: ['React', 'circ', '#20232a', '#61dafb', '<g stroke-width="1.2"><ellipse cx="12" cy="12" rx="8.6" ry="3.3"/><ellipse cx="12" cy="12" rx="8.6" ry="3.3" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="8.6" ry="3.3" transform="rotate(120 12 12)"/></g><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'],
  vue: ['Vue', 'sq', '#42b883', '#fff', 'V'],
  svelte: ['Svelte', 'sq', '#ff3e00', '#fff', 'S'],
  node: ['Node.js', 'hex', '#3c873a', '#fff', 'JS'],
  npm: ['npm', 'sq', '#cb3837', '#fff', 'npm'],
  pnpm: ['pnpm', 'sq', '#f69220', '#1b1d22', 'pn'],
  yarn: ['Yarn', 'circ', '#2c8ebb', '#fff', 'Y'],
  bun: ['Bun', 'circ', '#fbf0df', '#3b2a1a', 'bun'],
  deno: ['Deno', 'circ', '#1b1d22', '#fff', 'D'],
  cs: ['C#', 'hex', '#68217a', '#fff', 'C#'],
  dotnet: ['.NET', 'sq', '#512bd4', '#fff', '.NET'],
  fs: ['F#', 'hex', '#378bba', '#fff', 'F#'],
  vb: ['Visual Basic', 'sq', '#00539c', '#fff', 'VB'],
  py: ['Python', 'sq', '#3776ab', '#ffd43b', 'Py'],
  kt: ['Kotlin', 'sq', '#7f52ff', '#fff', 'K'],
  java: ['Java', 'sq', '#e76f00', '#fff', 'J'],
  gradle: ['Gradle', 'sq', '#02303a', '#00de7a', 'G'],
  maven: ['Maven', 'sq', '#c71a36', '#fff', 'mvn'],
  go: ['Go', 'sq', '#00add8', '#fff', 'GO'],
  rs: ['Rust', 'circ', '#b7410e', '#fff', 'Rs'],
  c: ['C', 'hex', '#5c6bc0', '#fff', 'C'],
  cpp: ['C++', 'hex', '#00599c', '#fff', 'C++'],
  rb: ['Ruby', 'sq', '#cc342d', '#fff', 'Rb'],
  php: ['PHP', 'circ', '#777bb4', '#fff', 'php'],
  swift: ['Swift', 'sq', '#f05138', '#fff', 'Sw'],
  dart: ['Dart', 'sq', '#0175c2', '#fff', 'Da'],
  html: ['HTML', 'shield', '#e34f26', '#fff', '5'],
  css: ['CSS', 'shield', '#1572b6', '#fff', '3'],
  sass: ['Sass', 'circ', '#cc6699', '#fff', 'S'],
  json: ['JSON', 'sq', '#3f3f46', '#facc15', '{}'],
  yaml: ['YAML', 'sq', '#cb171e', '#fff', 'yml'],
  toml: ['TOML', 'sq', '#9c4221', '#fff', 'T'],
  xml: ['XML', 'sq', '#0b7285', '#fff', '<>'],
  md: ['Markdown', 'sq', '#083fa1', '#fff', 'M↓'],
  sql: ['SQL', 'sq', '#336791', '#fff', '<g stroke-width="1.6"><ellipse cx="12" cy="7.5" rx="6" ry="2.5"/><path d="M6 7.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M6 12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/></g>'],
  sh: ['Shell script', 'sq', '#4eaa25', '#fff', '$_'],
  ps: ['PowerShell', 'sq', '#2671be', '#fff', '<path d="M7 7.5l5.5 4.5L7 16.5M13 16.5h4.5"/>'],
  docker: ['Docker', 'sq', '#1d63ed', '#fff', '<g fill="currentColor" stroke="none"><rect x="5.5" y="9.5" width="3" height="3" rx=".5"/><rect x="9.5" y="9.5" width="3" height="3" rx=".5"/><rect x="13.5" y="9.5" width="3" height="3" rx=".5"/><rect x="9.5" y="5.5" width="3" height="3" rx=".5"/><path d="M4 14h16c-.4 3.2-3 5-7.5 5S4.6 17.2 4 14z"/></g>'],
  k8s: ['Kubernetes', 'hex', '#326ce5', '#fff', 'K8'],
  git: ['Git', 'dia', '#f05032', '#fff', '<g stroke-width="1.6"><circle cx="9.5" cy="8" r="1.5"/><circle cx="9.5" cy="16" r="1.5"/><circle cx="15" cy="11" r="1.5"/><path d="M9.5 9.5v5M15 12.5c0 2-2.5 2-4.2 2.6"/></g>'],
  github: ['GitHub', 'circ', '#24292f', '#fff', 'GH'],
  azure: ['Azure', 'sq', '#0078d4', '#fff', 'Az'],
  aws: ['AWS', 'sq', '#232f3e', '#ff9900', 'aws'],
  tf: ['Terraform', 'sq', '#7b42bc', '#fff', 'TF'],
  lua: ['Lua', 'circ', '#000080', '#fff', 'Lua'],
  r: ['R', 'circ', '#276dc3', '#fff', 'R'],
  scala: ['Scala', 'sq', '#dc322f', '#fff', 'Sc'],
  ex: ['Elixir', 'sq', '#4b275f', '#fff', 'Ex'],
  zig: ['Zig', 'sq', '#f7a41d', '#1b1d22', 'Z'],
  perl: ['Perl', 'sq', '#39457e', '#fff', 'Pl'],
};
const TECH_SHAPE = {
  sq: '<rect x="1.5" y="1.5" width="21" height="21" rx="4.5"/>',
  circ: '<circle cx="12" cy="12" r="10.75"/>',
  hex: '<path d="M12 1l9.5 5.5v11L12 23l-9.5-5.5v-11z"/>',
  shield: '<path d="M2.5 1.5h19l-1.7 17.6L12 22.5l-7.8-3.4z"/>',
  dia: '<path d="M12 1.2L22.8 12 12 22.8 1.2 12z"/>',
};
// file extension → id
const TECH_EXT = {};
for (const [id, exts] of Object.entries({
  js: 'js mjs cjs', ts: 'ts mts cts', react: 'jsx tsx', vue: 'vue', svelte: 'svelte',
  cs: 'cs csx cshtml razor', dotnet: 'csproj sln slnx fsproj vbproj props targets nuspec', fs: 'fs fsx fsi', vb: 'vb',
  py: 'py pyi pyw ipynb', kt: 'kt kts', java: 'java', gradle: 'gradle', go: 'go', rs: 'rs', c: 'c h', cpp: 'cpp cc cxx hpp hh hxx',
  rb: 'rb erb gemspec', php: 'php', swift: 'swift', dart: 'dart', html: 'html htm', css: 'css', sass: 'scss sass',
  json: 'json jsonc json5 jsonl', yaml: 'yml yaml', toml: 'toml', xml: 'xml xaml xsd xslt svg', md: 'md mdx markdown', sql: 'sql',
  sh: 'sh bash zsh', ps: 'ps1 psm1 psd1', tf: 'tf tfvars', lua: 'lua', r: 'r', scala: 'scala', ex: 'ex exs', zig: 'zig', perl: 'pl pm',
})) for (const x of exts.split(' ')) TECH_EXT[x] = id;
// names ripgrep uses for a file type (Grep's `type`) where they differ from the extension
const TECH_ALIAS = { rust: 'rs', csharp: 'cs', kotlin: 'kt', ruby: 'rb', markdown: 'md', python: 'py', typescript: 'ts', javascript: 'js', shell: 'sh' };
// whole file names that say more than their extension does
const TECH_FILE = [
  [/^dockerfile(\..+)?$|^(docker-)?compose.*\.ya?ml$|^\.dockerignore$/, 'docker'],
  [/^package(-lock)?\.json$|^\.npmrc$/, 'npm'], [/^pnpm-(lock|workspace)\.yaml$/, 'pnpm'], [/^yarn\.lock$|^\.yarnrc(\.yml)?$/, 'yarn'],
  [/^tsconfig.*\.json$/, 'ts'], [/\.gradle\.kts$|^gradlew(\.bat)?$|^gradle\.properties$/, 'gradle'], [/^pom\.xml$/, 'maven'],
  [/^cargo\.(toml|lock)$/, 'rs'], [/^go\.(mod|sum|work)$/, 'go'], [/^(requirements.*\.txt|pyproject\.toml|pipfile|uv\.lock)$/, 'py'],
  [/^(gemfile|rakefile)(\.lock)?$/, 'rb'], [/^composer\.(json|lock)$/, 'php'],
  [/^(appsettings.*\.json|global\.json|nuget\.config|launchsettings\.json|packages\.lock\.json)$/, 'dotnet'],
  [/^\.git(ignore|attributes|modules)$/, 'git'],
];
// the language of a file path (also of a glob such as src/**/*.cs or *.{ts,tsx}); null when it is not a known one
function fileTech(p) {
  p = String(p || '');
  const f = base(p).toLowerCase().replace(/\{([^,}]*)[^}]*\}/g, '$1'); if (!f) return null;
  for (const [rx, id] of TECH_FILE) if (rx.test(f)) return id;
  if (/(^|[\\/])\.github[\\/]/.test(p)) return 'github';
  const i = f.lastIndexOf('.');
  return i < 0 ? null : TECH_EXT[f.slice(i + 1)] || null;
}
// program name → id (the name without its folder and without .exe / .cmd / .bat)
const TECH_CMD = [
  [/^dotnet(-[\w-]+)?$|^msbuild$|^nuget$|^csc$/, 'dotnet'],
  [/^node(js)?$/, 'node'], [/^np[mx]$/, 'npm'], [/^pnp[mx]$/, 'pnpm'], [/^yarn$/, 'yarn'], [/^bunx?$/, 'bun'], [/^deno$/, 'deno'], [/^tsc$|^tsx$|^ts-node$/, 'ts'],
  [/^python[\d.]*$|^py$|^pip[\d.]*$|^pipx$|^uvx?$|^poetry$|^pytest$|^conda$/, 'py'],
  [/^go$|^gofmt$/, 'go'], [/^cargo$|^rustc$|^rustup$/, 'rs'], [/^javac?$|^jar$/, 'java'], [/^gradlew?$/, 'gradle'], [/^mvnw?$/, 'maven'], [/^kotlinc?$/, 'kt'],
  [/^docker(-compose)?$|^podman$/, 'docker'], [/^kubectl$|^helm$|^minikube$/, 'k8s'], [/^git$/, 'git'], [/^gh$/, 'github'], [/^pwsh$|^powershell$/, 'ps'],
  [/^ruby$|^gem$|^bundle$|^rake$|^rails$/, 'rb'], [/^php$|^composer$/, 'php'], [/^swiftc?$/, 'swift'], [/^dart$|^flutter$/, 'dart'],
  [/^g?cc$|^clang$/, 'c'], [/^[gc]\+\+$|^clang\+\+$|^cmake$/, 'cpp'], [/^psql$|^sqlite3?$|^mysql$|^sqlcmd$|^pg_dump$/, 'sql'], [/^jq$/, 'json'],
  [/^azd?$/, 'azure'], [/^aws$/, 'aws'], [/^terraform$|^tofu$/, 'tf'], [/^lua$/, 'lua'], [/^rscript$/, 'r'], [/^scala$|^sbt$/, 'scala'],
  [/^elixir$|^mix$|^iex$/, 'ex'], [/^zig$/, 'zig'], [/^perl$/, 'perl'],
];
// a program name (or a script run directly, such as ./build.ps1) → id
function nameTech(w) {
  const p = base(String(w || '')).toLowerCase(), n = p.replace(/\.(exe|cmd|bat)$/, '');
  for (const [rx, id] of TECH_CMD) if (rx.test(n)) return id;
  return /\.(py|ps1|rb|[cm]?js|ts|php|pl|sh)$/.test(p) ? fileTech(p) : null;
}
// the separate commands of a shell line: split at ; | & and line ends, but not inside quotes; comments and
// heredoc bodies (a script handed to another program) are left out
function shellSegments(cmd) {
  const out = []; let cur = '', q = null, here = null;
  for (const line of String(cmd || '').split('\n')) {
    if (here) { if (line.trim() === here) here = null; continue; }
    const hm = !q && line.match(/<<-?\s*(['"]?)(\w+)\1/);
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { cur += c; if (c === '\\' && q === '"') cur += line[++i] ?? ''; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
      if (c === ';' || c === '|' || c === '&') { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (q) cur += '\n'; else { out.push(cur); cur = ''; }
    if (hm) here = hm[2];
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
// words that come before the program actually being run
const SH_LEAD = new Set(['sudo', 'env', 'time', 'command', 'exec', 'nohup', 'xargs', 'winpty', 'timeout', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '(']);
// the program one command runs: its first word after variable assignments, options and words like sudo / time
function progWord(seg) {
  let sub = 0; // inside a $( … ) that is part of an assignment: OUT=$(ls -d build) ./run
  for (const w0 of String(seg || '').match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) || []) {
    const inSub = sub > 0, w = w0.replace(/^["'(]+|["')]+$/g, '');
    sub = Math.max(0, sub + (w0.match(/\(/g) || []).length - (w0.match(/\)/g) || []).length);
    if (inSub || !w ||/^\$?[A-Za-z_][\w:]*=/.test(w) || /^-/.test(w) || /^\d+[smh]?$/.test(w) || /^\$[\w?:{}]*$/.test(w) || SH_LEAD.has(w.toLowerCase())) continue;
    return w;
  }
  return '';
}
// what a tool call works with → ids, in the order they appear. A chained shell line can run several programs:
// `cd api && npm ci && dotnet test` is npm and .NET. Empty when there is nothing specific to show
function techsOf(tool, ti) {
  ti = ti || {};
  if (!tool) return [];
  if (SHELL_TOOLS.has(tool)) {
    const ks = [...new Set(shellSegments(ti.command).map(seg => nameTech(progWord(seg))).filter(Boolean))];
    return ks.length ? ks : tool === 'PowerShell' ? ['ps'] : [];
  }
  let k = null;
  if (tool === 'Glob') k = fileTech(ti.pattern);
  else if (tool === 'Grep') { const ty = String(ti.type || '').toLowerCase(); k = fileTech(ti.glob) || TECH_EXT[TECH_ALIAS[ty] || ty] || fileTech(ti.path); }
  else if (FILE_TOOLS.has(tool)) k = fileTech(ti.file_path || ti.notebook_path || ti.path);
  return k ? [k] : [];
}
// the first of them (the one a Route stop is drawn with), or null
const techOf = (tool, ti) => techsOf(tool, ti)[0] || null;
// the monogram or glyph alone, in the 24×24 box (the Route draws it on a stop filled with the badge colour)
function techMark(id) {
  const [, , , fg, t] = TECH[id];
  if (/<\w/.test(t)) return `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:${fg}">${t}</g>`;
  const n = [...t].length;
  return `<text class="tkx" x="12" y="12" dy=".36em" text-anchor="middle" fill="${fg}" stroke="none" font-size="${[15, 15, 12, 9.4, 8][n] || 7}"${n > 2 ? ` textLength="${n > 3 ? 18.4 : 16.6}" lengthAdjust="spacingAndGlyphs"` : ''}>${esc(t)}</text>`;
}
// the whole badge as an inline icon; '' for an unknown id, so callers can fall back to the group icon
function techIcon(id, cls = 'ic') {
  const k = TECH[id]; if (!k) return '';
  return `<svg class="${cls} tech" viewBox="0 0 24 24" role="img" aria-label="${esc(k[0])}"><title>${esc(k[0])}</title><g fill="${k[2]}" stroke="#808080" stroke-opacity=".5" stroke-width=".7">${TECH_SHAPE[k[1]]}</g>${techMark(id)}</svg>`;
}
// several badges in a row (a chained command): the first few, then "+n" for the rest; '' for an empty list
function techIcons(ks, max = 3) {
  if (!ks || !ks.length) return '';
  const more = ks.slice(max);
  return ks.slice(0, max).map(k => techIcon(k)).join('') + (more.length ? `<span class="tmore" title="${esc(more.map(k => TECH[k][0]).join(', '))}">+${more.length}</span>` : '');
}
