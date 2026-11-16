import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const tpl = (f) => fs.readFileSync(path.join(here, '..', 'template', f), 'utf8');
const vendor = (m) => fs.readFileSync(require.resolve(m), 'utf8');
// keep inline <script> blocks intact
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

export function render(out, opts = {}) {
  // null → the report picks saved preference / browser language at open time
  const defaultLang = opts.lang == null || opts.lang === true ? null : opts.lang;
  if (defaultLang !== null && !['en', 'zh'].includes(defaultLang)) throw new Error(`Unsupported --lang "${opts.lang}" (expected en or zh)`);
  const facts = JSON.parse(fs.readFileSync(path.join(out, 'facts.json'), 'utf8'));
  const ap = path.join(out, 'analysis.json');
  let analysis = null;
  if (fs.existsSync(ap)) {
    analysis = JSON.parse(fs.readFileSync(ap, 'utf8'));
    validate(analysis, facts);
  }
  const data = {
    facts,
    analysis,
    reportId: `${facts.meta.repoName}:${facts.meta.range.old.sha?.slice(0, 10)}..${facts.meta.range.new.sha?.slice(0, 10) ?? 'wt'}`,
    defaultLang,
  };
  const font = fs.readFileSync(path.join(here, '..', 'template', 'fonts', 'patchvista-mono.woff2')).toString('base64');
  const icons = JSON.parse(tpl('lucide-icons.json')).icons;
  const html = tpl('report.html')
    .replace('/*__THEME__*/', () => safe(tpl('theme.js')))
    .replace('/*__CSS__*/', () => tpl('app.css').replace('__FONT_DATA__', font))
    .replace('/*__CYTOSCAPE__*/', () => safe(vendor('cytoscape/dist/cytoscape.min.js')))
    .replace('/*__ELK__*/', () => safe(vendor('elkjs/lib/elk.bundled.js')))
    .replace('/*__APP__*/', () => safe(tpl('app.js')))
    .replace('__ICONS__', () => safe(JSON.stringify(icons)))
    .replace('__ICON_LICENSE__', () => safe(tpl('lucide-LICENSE.txt')))
    .replace('__DATA__', () => safe(JSON.stringify(data)))
    .replace('__TITLE__', () => escapeHtml(analysis?.title ?? `${facts.meta.repoName} · ${facts.meta.range.label}`));
  const file = path.join(out, 'report.html');
  fs.writeFileSync(file, html);
  return file;
}

function validate(a, facts) {
  const known = new Set([
    ...facts.entities.map((e) => e.sid), ...facts.contexts.map((c) => c.sid),
    ...facts.resources.map((r) => r.sid), ...facts.files.map((f) => f.id),
  ]);
  const bad = new Set();
  const check = (list) => (list ?? []).forEach((x) => { if (!known.has(x)) bad.add(x); });
  for (const cs of a.changeSets ?? []) { check(cs.entities); check(cs.files); check(cs.resources); check(cs.reviewOrder); }
  for (const r of a.risks ?? []) check(r.entities);
  check(Object.keys(a.entityNotes ?? {}));
  check(a.skim);
  if (bad.size) console.error(`[patchvista] analysis.json references unknown ids (ignored): ${[...bad].slice(0, 30).join(', ')}`);
  // entities not placed in any change set fall into an "其他" set in the UI
  const placed = new Set((a.changeSets ?? []).flatMap((cs) => cs.entities ?? []));
  const missing = facts.entities.filter((e) => !placed.has(e.sid) && !e.isTest && !e.importOnly && !(e.status === 'moved' && !e.bodyChanged));
  if (missing.length) console.error(`[patchvista] ${missing.length} non-trivial entities not in any change set: ${missing.slice(0, 20).map((e) => e.sid).join(',')}${missing.length > 20 ? '…' : ''}`);
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
