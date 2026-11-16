import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { render } from './lib/render.mjs';

test('report embeds the renamed WOFF2 font without an external asset request', (t) => {
  const local = fileURLToPath(new URL('../.local/', import.meta.url));
  fs.mkdirSync(local, { recursive: true });
  const out = fs.mkdtempSync(path.join(local, 'render-font-test-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const facts = {
    meta: { repoName: 'fixture', range: { label: 'main...dev', old: { sha: 'abc' }, new: { sha: 'def' } } },
    entities: [], contexts: [], resources: [], files: [],
  };
  fs.writeFileSync(path.join(out, 'facts.json'), JSON.stringify(facts));
  const report = render(out);
  const html = fs.readFileSync(report, 'utf8');
  assert(html.includes('<div class="brand">PatchVista</div>'));
  const cli = fileURLToPath(new URL('patchvista.mjs', import.meta.url));
  const help = execFileSync(process.execPath, [cli], { encoding: 'utf8' });
  assert(help.includes('PatchVista:'));
  assert(help.includes('collect'));
  assert.equal(execFileSync(process.execPath, [cli, 'render', '--out', out], { encoding: 'utf8' }).trim(), report);
  assert.equal(fs.readFileSync(report, 'utf8'), html);
  const embedded = html.match(/url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/);
  assert(embedded, 'Expected an inline WOFF2 font');
  const font = fs.readFileSync(new URL('./template/fonts/patchvista-mono.woff2', import.meta.url));
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  assert.deepEqual(Buffer.from(embedded[1], 'base64'), font);
  assert.equal(html.split('data:font/woff2;base64,').length - 1, 1);
  assert(!html.includes('__FONT_DATA__'));
  assert(!html.includes('TX-02'));
  assert(html.includes('font-family: "PatchVista Mono"'));
  assert(html.includes('await document.fonts.ready;'));
  assert(html.indexOf("const key = 'patchvista:theme'") < html.indexOf('<style>'));
  assert(!html.includes('__ICONS__'));
  assert(!html.includes('__ICON_LICENSE__'));
  assert(html.includes('Lucide'));
  assert(html.includes('Cole Bemis'));
  for (const mode of ['light', 'dark', 'system']) assert(html.includes(`data-theme-mode="${mode}"`));
  for (const lang of ['en', 'zh']) assert(html.includes(`data-lang="${lang}"`));
  for (const [, attrs, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/application\/json|text\/plain/.test(attrs)) new vm.Script(source);
  }
});

test('report supports bilingual English/Chinese; --lang is validated', (t) => {
  const local = fileURLToPath(new URL('../.local/', import.meta.url));
  fs.mkdirSync(local, { recursive: true });
  const out = fs.mkdtempSync(path.join(local, 'render-i18n-test-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const facts = {
    meta: { repoName: 'i18n-fixture', range: { label: 'main...dev', old: { sha: '111' }, new: { sha: '222' } } },
    entities: [], contexts: [], resources: [], files: [],
  };
  fs.writeFileSync(path.join(out, 'facts.json'), JSON.stringify(facts));

  const reportDefault = render(out);
  const htmlDefault = fs.readFileSync(reportDefault, 'utf8');
  assert(htmlDefault.includes('<html lang="en">'));
  assert(htmlDefault.includes('data-lang="en"'));
  assert(htmlDefault.includes('data-lang="zh"'));
  assert(htmlDefault.includes('"defaultLang":null'));

  const reportZh = render(out, { lang: 'zh' });
  const htmlZh = fs.readFileSync(reportZh, 'utf8');
  assert(htmlZh.includes('"defaultLang":"zh"'));
  assert.throws(() => render(out, { lang: 'fr' }), /Unsupported --lang/);
});

test('all declared UI and graph icon names exist in the vendored subset', () => {
  const { icons } = JSON.parse(fs.readFileSync(new URL('./template/lucide-icons.json', import.meta.url), 'utf8'));
  const app = fs.readFileSync(new URL('./template/app.js', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('./template/report.html', import.meta.url), 'utf8');
  const kindMap = app.match(/const KIND_ICON = \{([\s\S]*?)\n\};/)[1];
  const names = [
    ...[...app.matchAll(/icon\('([\w-]+)'\)/g)].map(m => m[1]),
    ...[...template.matchAll(/data-icon="([\w-]+)"/g)].map(m => m[1]),
    ...[...kindMap.matchAll(/: '([\w-]+)'/g)].map(m => m[1]),
    'circle', 'chevron-right', 'chevron-down',
  ];
  for (const name of names) assert(icons[name], `Missing Lucide icon: ${name}`);
});
