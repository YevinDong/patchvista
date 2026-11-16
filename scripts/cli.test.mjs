import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('CLI writes and renders reports under the PatchVista home directory', (t) => {
  const local = fileURLToPath(new URL('../.local/', import.meta.url));
  fs.mkdirSync(local, { recursive: true });
  const home = fs.mkdtempSync(path.join(local, 'patchvista-cli-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const repo = path.join(home, 'example');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git('init');
  fs.writeFileSync(path.join(repo, 'example.ts'), 'export const value = 1;\n');
  git('add', '.');
  git('-c', 'user.name=PatchVista Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Add fixture');
  fs.writeFileSync(path.join(repo, 'example.ts'), 'export const value = 2;\n');

  const cli = fileURLToPath(new URL('./patchvista.mjs', import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'pipe',
  });
  const result = JSON.parse(run('collect', '--repo', repo, '--no-refs'));
  const out = path.join(home, '.patchvista', 'example', 'worktree');
  assert.equal(result.out, out);
  assert.equal(result.stats.files, 1);
  assert(fs.existsSync(path.join(out, 'facts.json')));
  assert(fs.existsSync(path.join(out, 'digest.md')));
  const report = run('render', '--out', out).trim();
  assert.equal(report, path.join(out, 'report.html'));
  const html = fs.readFileSync(report, 'utf8');
  assert(html.includes('window.patchvistaStorage'));
  assert(html.includes('window.patchvistaTheme'));
  assert(html.includes("const key = 'patchvista:theme'"));
  assert(run('show', '--out', out, 'f1').includes('value = 2'));
});
