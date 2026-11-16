import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('./template/theme.js', import.meta.url), 'utf8');
function boot({ saved, dark = false, blocked = false } = {}) {
  const values = new Map(saved === undefined ? [] : [['patchvista:theme', saved]]);
  const writes = [];
  const root = { dataset: {}, style: {} };
  const meta = {};
  const window = new EventTarget();
  const media = Object.assign(new EventTarget(), { matches: dark });
  const localStorage = {
    getItem(key) { if (blocked) throw new Error('denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('denied'); writes.push([key, value]); values.set(key, value); },
    removeItem(key) { if (blocked) throw new Error('denied'); values.delete(key); },
  };
  vm.runInNewContext(script, { window, document: { documentElement: root, querySelector: () => meta }, matchMedia: () => media, localStorage, Event });
  return { root, meta, window, media, writes, values, theme: window.patchvistaTheme };
}

test('first visit follows the system without writing a preference', () => {
  for (const dark of [false, true]) {
    const app = boot({ dark });
    assert.equal(app.theme.get(), 'system');
    assert.equal(app.root.dataset.theme, dark ? 'dark' : 'light');
    assert.equal(app.root.style.colorScheme, dark ? 'dark' : 'light');
    assert.equal(app.writes.length, 0);
  }
});

test('manual choices persist and survive reload, including system', () => {
  const app = boot();
  for (const mode of ['dark', 'light', 'system']) {
    app.theme.set(mode);
    assert.equal(app.values.get('patchvista:theme'), mode);
    assert.equal(app.root.dataset.themePreference, mode);
    assert.equal(boot({ saved: app.values.get('patchvista:theme') }).theme.get(), mode);
  }
  assert.equal(app.writes.length, 3);
});

test('system changes affect only system mode', () => {
  const app = boot();
  app.media.matches = true;
  app.media.dispatchEvent(new Event('change'));
  assert.equal(app.root.dataset.theme, 'dark');
  app.theme.set('light');
  app.media.dispatchEvent(new Event('change'));
  assert.equal(app.root.dataset.theme, 'light');
  app.theme.set('system');
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(app.meta.content, '#11161e');
});

test('invalid saved modes fall back to system; invalid actions are ignored', () => {
  const app = boot({ saved: 'unexpected', dark: true });
  assert.equal(app.theme.get(), 'system');
  app.theme.set('unexpected');
  assert.equal(app.theme.get(), 'system');
  assert.equal(app.writes.length, 0);
});

test('unavailable storage leaves a usable session-only theme', () => {
  const app = boot({ blocked: true });
  assert.equal(app.theme.get(), 'system');
  app.theme.set('dark');
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(app.window.patchvistaStorage.getItem('anything'), null);
  assert.doesNotThrow(() => app.window.patchvistaStorage.removeItem('anything'));
});

test('another tab can update or clear the preference', () => {
  const app = boot({ saved: 'light', dark: true });
  app.window.dispatchEvent(Object.assign(new Event('storage'), { key: 'patchvista:theme', newValue: 'dark' }));
  assert.equal(app.root.dataset.theme, 'dark');
  app.window.dispatchEvent(Object.assign(new Event('storage'), { key: null, newValue: null }));
  assert.equal(app.theme.get(), 'system');
  assert.equal(app.writes.length, 0);
});

test('both palettes provide readable primary, secondary and diff text', () => {
  const css = fs.readFileSync(new URL('./template/app.css', import.meta.url), 'utf8');
  const light = Object.fromEntries([...css.match(/:root \{([\s\S]*?)\n\}/)[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(([, key, value]) => [key, value]));
  const dark = { ...light, ...Object.fromEntries([...css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(([, key, value]) => [key, value])) };
  const luminance = (hex) => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const [name, palette] of Object.entries({ light, dark })) {
    for (const [fg, bg] of [['text', 'panel'], ['mute', 'panel'], ['faint', 'panel'], ['faint', 'selected'], ['ctx', 'ctx-bg'], ['accent', 'selected'], ['on-accent', 'accent'], ['add', 'add-bg'], ['mod', 'mod-bg'], ['del', 'del-bg'], ['syntax-key', 'diff-add'], ['syntax-string', 'diff-del'], ['mute', 'diff-add-no'], ['mute', 'diff-del-no']]) {
      const values = [luminance(palette[fg]), luminance(palette[bg])].sort((a, b) => b - a);
      assert((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${name}: ${fg} on ${bg}`);
    }
  }
});
