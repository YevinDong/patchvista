#!/usr/bin/env node
// PatchVista: turn a git diff into an interactive impact map.
//
//   collect  [--repo DIR] [--base REF [--head REF] [--two-dot] | --commit REF] [--out DIR] [--no-refs]
//   show     --out DIR <id|sid|file>...      print entity / file diff from facts.json
//   render   --out DIR [--open]              facts.json (+ analysis.json) → report.html
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { collect } from './lib/collect.mjs';
import { writeDigest } from './lib/digest.mjs';
import { render } from './lib/render.mjs';

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key.startsWith('no') && key.length > 2) { opts[key[2].toLowerCase() + key.slice(3)] = false; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else { opts[key] = next; i++; }
  }
  return opts;
}

function defaultOut(repo, opts) {
  const name = path.basename(execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  const slug = (opts.commit ? `commit-${opts.commit}` : opts.base ? `${opts.base}...${opts.head ?? 'HEAD'}` : 'worktree')
    .replace(/[^\w.\-]+/g, '_');
  return path.join(os.homedir(), '.patchvista', name, slug);
}

const readFacts = (out) => JSON.parse(fs.readFileSync(path.join(out, 'facts.json'), 'utf8'));

function show(out, keys) {
  const facts = readFacts(out);
  for (const k of keys) {
    const e = facts.entities.find((x) => x.sid === k || x.id === k || x.qname === k);
    if (e) {
      console.log(`### ${e.sid} ${e.kind} ${e.qname}  [${e.status}${e.moved ? ', moved' : ''}]  ${e.file}:${e.line ?? e.old?.line}`);
      if (e.oldFile) console.log(`    from ${e.oldFile}`);
      if (e.signatureChanged) console.log(`    signature: ${e.old.signature}\n            → ${e.signature}`);
      for (const h of e.hunks) console.log(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join('\n')}`);
      console.log();
      continue;
    }
    const f = facts.files.find((x) => x.id === k || x.path === k || x.path.endsWith(k));
    if (f) {
      console.log(`### ${f.id} ${f.path} [${f.status}] +${f.additions} -${f.deletions}\n${f.patch}`);
      continue;
    }
    console.log(`### ${k}: not found`);
  }
}

function openFile(p) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', p] : [p];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch { /* headless */ }
}

const [cmd, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);
const repo = path.resolve(opts.repo ?? process.cwd());

if (cmd === 'collect') {
  const out = path.resolve(opts.out ?? defaultOut(repo, opts));
  fs.mkdirSync(out, { recursive: true });
  const facts = await collect({ ...opts, repo });
  fs.writeFileSync(path.join(out, 'facts.json'), JSON.stringify(facts));
  const digest = writeDigest(facts);
  fs.writeFileSync(path.join(out, 'digest.md'), digest);
  // stale analysis from a previous run would reference wrong ids
  const ap = path.join(out, 'analysis.json');
  if (fs.existsSync(ap)) fs.renameSync(ap, ap + '.prev');
  console.log(JSON.stringify({ out, facts: path.join(out, 'facts.json'), digest: path.join(out, 'digest.md'), digestLines: digest.split('\n').length, stats: facts.stats }, null, 2));
} else if (cmd === 'show') {
  show(path.resolve(opts.out), opts._);
} else if (cmd === 'render') {
  const out = path.resolve(opts.out);
  const html = render(out);
  console.log(html);
  if (opts.open) openFile(html);
} else {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n'));
  process.exit(cmd ? 1 : 0);
}
