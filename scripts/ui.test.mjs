import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('filter clicks keep their menu open even after replacing the clicked button', () => {
  const app = fs.readFileSync(new URL('./template/app.js', import.meta.url), 'utf8');
  const handler = app.match(/document\.addEventListener\('click', \(event\) => \{([\s\S]*?)\n\}\);/);
  assert(handler, 'Expected the outside-click handler');
  const menu = { open: true, contains: () => false };
  const onClick = vm.runInNewContext(`(event) => {${handler[1]}}`, {
    document: { querySelectorAll: () => [menu] },
  });
  onClick({ target: {}, composedPath: () => [{}, menu] });
  assert.equal(menu.open, true);
  onClick({ target: {}, composedPath: () => [{}] });
  assert.equal(menu.open, false);
});
