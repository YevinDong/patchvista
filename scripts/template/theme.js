(() => {
'use strict';
// File URLs and privacy settings can deny storage; the report must still open.
const storage = window.patchvistaStorage = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch { /* Session-only preference. */ } },
  removeItem(key) { try { localStorage.removeItem(key); } catch { /* Session-only preference. */ } },
};
const key = 'patchvista:theme';
const modes = new Set(['light', 'dark', 'system']);
const media = matchMedia('(prefers-color-scheme: dark)');
const root = document.documentElement;
let preference = storage.getItem(key);
if (!modes.has(preference)) preference = 'system';
function apply() {
  const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]').content = resolved === 'dark' ? '#11161e' : '#f6f7f9';
  window.dispatchEvent(new Event('patchvista:theme'));
}
window.patchvistaTheme = {
  get: () => preference,
  set(mode) {
    if (!modes.has(mode)) return;
    preference = mode;
    storage.setItem(key, mode);
    apply();
  },
};
media.addEventListener('change', () => { if (preference === 'system') apply(); });
window.addEventListener('storage', (event) => {
  if (event.key !== key && event.key !== null) return;
  preference = modes.has(event.newValue) ? event.newValue : 'system';
  apply();
});
apply();
})();
