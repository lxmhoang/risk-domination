#!/usr/bin/env node
// Build script: concatenates the modular source files in src/ into a single,
// self-contained dist/index.html — no bundler, no external dependencies.
// This keeps the shippable artifact exactly what it always was (one HTML file
// you can open directly in a browser, no server needed) while letting the
// source itself live as separate, individually-editable files.
"use strict";
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const JS_DIR = path.join(SRC, 'js');
const OUT_DIR = path.join(__dirname, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'index.html');
// docs/index.html is a duplicate copy for GitHub Pages, which (without a workflow-based
// deploy) can only serve from a branch's root or /docs folder — so we mirror the build
// output there too, kept in sync automatically on every `npm run build`.
const PAGES_DIR = path.join(__dirname, 'docs');
const PAGES_FILE = path.join(PAGES_DIR, 'index.html');

function read(p){ return fs.readFileSync(p, 'utf8'); }

const shell = read(path.join(SRC, 'shell.html'));
const style = read(path.join(SRC, 'style.css'));
const body = read(path.join(SRC, 'body.html'));

// config.json holds runtime-tunable settings (spectator mode delay, etc). It's inlined
// as a JS constant at build time — not fetched at runtime — because dist/index.html
// must stay a single file openable via file:// with no server (fetch() of local JSON
// is blocked by browsers under file://).
const config = JSON.parse(read(path.join(SRC, 'config.json')));
const configScript = `/* ---- src/config.json ---- */\nconst GAME_CONFIG = ${JSON.stringify(config, null, 2)};`;

// JS modules are concatenated in filename order (01-, 02-, ... prefixes make the
// dependency order explicit and stable — see src/js/README.md for what each does).
const jsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();
if (jsFiles.length === 0) {
  console.error('No JS modules found in ' + JS_DIR);
  process.exit(1);
}
const script = [configScript].concat(jsFiles.map(f => {
  const content = read(path.join(JS_DIR, f)).replace(/\s+$/, '');
  return `/* ---- src/js/${f} ---- */\n${content}`;
})).join('\n\n');

let out = shell
  .replace('__STYLE__', () => style.replace(/\s+$/, ''))
  .replace('__BODY__', () => body.replace(/\s+$/, ''))
  .replace('__SCRIPT__', () => script);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, out, 'utf8');
fs.mkdirSync(PAGES_DIR, { recursive: true });
fs.writeFileSync(PAGES_FILE, out, 'utf8');
console.log(`Built ${OUT_FILE} and ${PAGES_FILE} from ${jsFiles.length} JS modules (${out.length} bytes).`);
