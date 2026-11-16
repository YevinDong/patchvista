import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanUses } from './extract-sitter.mjs';
import { langOf } from './classify.mjs';

const GENERIC = new Set(['get', 'set', 'run', 'init', 'main', 'new', 'close', 'open', 'start', 'stop', 'String', 'Error', 'len', 'update', 'delete', 'create', 'list', '__init__', 'setUp', 'tearDown']);

function grepFiles(dir, names) {
  if (!names.length) return [];
  const args = ['-C', dir, 'grep', '-l', '-w', '-F', '-I', '--untracked'];
  for (const n of names) args.push('-e', n);
  args.push('--', '*.go', '*.py');
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
  } catch {
    return []; // exit 1 = no match
  }
}

function confidence(target, hitFile, hitText, hit) {
  const tDir = path.dirname(target.file);
  if (hitFile === target.file) return 'high';
  if (target.lang === 'go') {
    if (path.dirname(hitFile) === tDir) return 'high';
    const pkg = path.basename(tDir);
    if (hit.qualifier === pkg && hitText.includes(`/${tDir}"`)) return 'high';
    if (hit.qualifier === pkg) return 'medium';
    return target.parent ? 'medium' : 'low';
  }
  // python: from a.b.c import name / import a.b.c
  const mod = target.file.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/').join('.');
  const tail = mod.split('.').slice(-2).join('.');
  if (new RegExp(`from\\s+[\\w.]*${tail.replace('.', '\\.')}\\s+import[^\\n]*\\b${target.name}\\b`).test(hitText)) return 'high';
  if (hitText.includes(tail)) return 'medium';
  return 'low';
}

/**
 * Name-based incoming references for go/py entities.
 * Returns [{target, ref, confidence}]
 */
export function incomingRefsSitter(dir, entities, { maxPerEntity = 200 } = {}) {
  const targets = entities.filter((e) => (e.lang === 'go' || e.lang === 'py') && e.status !== 'deleted' &&
    !e.isTest && e.name.length >= 3 && !GENERIC.has(e.name));
  const byName = new Map();
  for (const t of targets) {
    if (!byName.has(t.name)) byName.set(t.name, []);
    byName.get(t.name).push(t);
  }
  const files = grepFiles(dir, [...byName.keys()]);
  const results = [];
  const counts = new Map();
  for (const f of files) {
    const lang = langOf(f);
    if (lang !== 'go' && lang !== 'py') continue;
    let text;
    try {
      text = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    const names = new Set([...byName.keys()].filter((n) => text.includes(n)));
    for (const hit of scanUses(lang, f, text, names)) {
      if (hit.kind === 'import') continue;
      for (const t of byName.get(hit.name) ?? []) {
        if (t.lang !== lang) continue;
        const encId = hit.enclosing ? `${f}#${hit.enclosing.qname}` : `${f}#(module)`;
        if (encId === t.id) continue;
        // a method call obj.Foo() can't resolve to a free function Foo and vice versa
        if (t.kind === 'function' && hit.qualifier && lang === 'go' && hit.qualifier !== path.basename(path.dirname(t.file))) continue;
        const c = (counts.get(t.id) ?? 0) + 1;
        if (c > maxPerEntity) continue;
        counts.set(t.id, c);
        const enc = hit.enclosing ?? { qname: '(module)', kind: 'module', name: path.basename(f), line: 1 };
        results.push({
          target: t.id,
          confidence: confidence(t, f, text, hit),
          ref: {
            file: f,
            line: hit.line,
            kind: hit.kind,
            text: text.split('\n')[hit.line - 1]?.trim().slice(0, 160) ?? '',
            enclosing: { id: encId, kind: enc.kind, name: enc.name, qname: enc.qname, parent: enc.parent ?? null, file: f, line: enc.line },
          },
        });
      }
    }
  }
  return results;
}
