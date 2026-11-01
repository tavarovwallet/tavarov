// Every inline <script> in the deployed pages must parse. A syntax error in
// www/index.html takes the whole wallet down, so this runs before each deploy.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
const roots = ['www', 'creator', 'site'];
const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.html')) files.push(p); } };
for (const r of roots) walk(new URL('../' + r, import.meta.url).pathname);
let bad = 0, n = 0;
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1], code = m[2];
    if (/type=["']?(application\/(ld\+)?json|importmap|text\/template)/.test(attrs) || !code.trim()) continue;
    n++;
    try {
      if (/type=["']?module/.test(attrs)) new vm.SourceTextModule(code);
      else new vm.Script(code, { filename: f });
    } catch (e) { bad++; console.log('SYNTAX', f, String(e.message)); }
  }
}
console.log(`html-scripts-syntax: ${n} scripts in ${files.length} pages, ${bad} broken`);
process.exit(bad ? 1 : 0);
