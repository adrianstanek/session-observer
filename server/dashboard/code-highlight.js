'use strict';
// Session Observer dashboard — a small syntax colouring for shell, Python and JavaScript (escaped token by token).
const KEYWORDS = {
  sh: new Set('if then else elif fi for while until do done case esac in function return export local set unset source exit'.split(' ')),
  py: new Set('def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda None True False global nonlocal yield async await assert del'.split(' ')),
  js: new Set('const let var function return if else for while do of in new class extends try catch finally throw typeof instanceof await async import export from default null undefined true false this switch case break continue delete void yield'.split(' ')),
};
const NEVER_MATCHES = '(?!)'; // a token kind the language doesn't have
// per language, the patterns for: comment · string · variable · operator · flag (numbers and words are shared)
const TOKEN_PATTERNS = {
  sh: [String.raw`(?<![\w$])#[^\n]*`, String.raw`"(?:\\[\s\S]|[^"\\])*"|'[^']*'`, String.raw`\$\{[^}\n]*\}|\$\w+|\$[@#?*!$0-9]`, String.raw`&&|\|\||2>&1|&>|>>|[|;<>]`, String.raw`(?<![\w./-])--?[A-Za-z][\w-]*`],
  py: [String.raw`#[^\n]*`, String.raw`\b[rRbBfFuU]{1,2}(?="|')(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`, NEVER_MATCHES, NEVER_MATCHES, NEVER_MATCHES],
  js: [String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`, String.raw`\x60(?:\\[\s\S]|[^\x60\\])*\x60|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`, NEVER_MATCHES, String.raw`=>`, NEVER_MATCHES],
};
const NUMBER_PATTERN = String.raw`\b\d+(?:\.\d+)?\b`;
const WORD_PATTERN = String.raw`[A-Za-z_$][\w$]*`;
// one regex per language; its capture groups in this order, and the CSS class (tk-<class>) of each
const TOKEN_REGEX = Object.fromEntries(Object.entries(TOKEN_PATTERNS).map(([language, patterns]) =>
  [language, new RegExp([...patterns, NUMBER_PATTERN, WORD_PATTERN].map(pattern => `(${pattern})`).join('|'), 'g')]));
const TOKEN_CLASSES = ['c', 's', 'v', 'o', 'f', 'n']; // comment, string, variable, operator, flag, number; a keyword is 'k'

function tokenClass(match, language) {
  for (let group = 1; group <= TOKEN_CLASSES.length; group++) if (match[group] !== undefined) return TOKEN_CLASSES[group - 1];
  return KEYWORDS[language].has(match[0]) ? 'k' : null;
}

function highlightCode(source, language) {
  source = String(source ?? '');
  const regex = TOKEN_REGEX[language];
  if (!regex) return escapeHtml(source);
  let html = '', last = 0;
  for (const match of source.matchAll(regex)) {
    const token = match[0], className = tokenClass(match, language);
    html += escapeHtml(source.slice(last, match.index)) + (className ? `<span class="tk-${className}">${escapeHtml(token)}</span>` : escapeHtml(token));
    last = match.index + token.length;
  }
  return html + escapeHtml(source.slice(last));
}

// the colouring language of a file, by its extension
function codeLanguageOfFile(filePath) {
  const extension = String(filePath || '').split('.').pop().toLowerCase();
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(extension)) return 'js';
  if (extension === 'py') return 'py';
  if (['sh', 'bash', 'zsh'].includes(extension)) return 'sh';
  if (extension === 'json') return 'json';
  return null;
}

// the language of a script handed to a program on the command line before it
function scriptLanguageOfCommand(command) {
  if (/\bpython3?\b/.test(command)) return 'py';
  if (/\b(node|deno|bun)\b/.test(command)) return 'js';
  if (/\b(bash|sh|zsh)\b/.test(command)) return 'sh';
  return null;
}

// A long shell line wraps at its top-level && || ; | (not inside quotes, $( ) or ( )), continuation lines indented.
const SHELL_WRAP_AT = 100;
function wrapLongShellLine(line) {
  if (line.length <= SHELL_WRAP_AT) return line;
  let wrapped = '', openQuote = null, depth = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index], pair = line.slice(index, index + 2);
    if (openQuote) {
      wrapped += char;
      if (char === '\\' && openQuote !== "'") wrapped += line[++index] ?? '';
      else if (char === openQuote) openQuote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { openQuote = char; wrapped += char; continue; }
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (!depth && (pair === '&&' || pair === '||')) {
      wrapped += pair + '\n  ';
      index += 1 + (line[index + 2] === ' ' ? 1 : 0);
      continue;
    }
    if (!depth && (char === ';' || (char === '|' && line[index + 1] !== '|'))) {
      wrapped += char + '\n  ';
      if (line[index + 1] === ' ') index++;
      continue;
    }
    wrapped += char;
  }
  return wrapped;
}

// `node -e '…'` / `python -c '…'`: [the command up to the script, the script, the rest]
const INLINE_SCRIPT = /^([\s\S]*?\b(?:node|python3?|deno|bun)\s+(?:-\S+\s+)*?-[ec]\s+)'([^']*)'([\s\S]*)$/;
const HEREDOC_START = /<<-?\s*(['"]?)(\w+)\1/;

// A shell command: shell coloured; heredoc bodies and inline scripts coloured as their language.
function highlightShellCommand(command) {
  command = String(command ?? '');
  const inline = !/<<-?\s*['"]?\w+/.test(command) && command.match(INLINE_SCRIPT);
  if (inline) {
    const [, before, script, after] = inline;
    return highlightCode(before, 'sh') + `<span class="tk-s">'</span>${highlightCode(script, scriptLanguageOfCommand(before))}<span class="tk-s">'</span>` + highlightShellCommand(after);
  }
  const lines = command.split('\n'), html = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], heredoc = line.match(HEREDOC_START);
    html.push(highlightCode(wrapLongShellLine(line), 'sh'));
    if (!heredoc) continue;
    const body = [];
    index++;
    while (index < lines.length && lines[index].trim() !== heredoc[2]) body.push(lines[index++]);
    html.push(highlightCode(body.join('\n'), scriptLanguageOfCommand(line.slice(0, heredoc.index))));
    if (index < lines.length) html.push(`<span class="tk-o">${escapeHtml(lines[index])}</span>`);
  }
  return html.join('\n');
}
