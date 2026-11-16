/* PatchVista report app — vanilla JS, cytoscape for rendering, ELK for layout */
(async () => {
'use strict';
// Measure graph labels only after the embedded font has loaded (or fallen back).
await document.fonts.ready;
const D = JSON.parse(document.getElementById('data').textContent);
const F = D.facts;
const A = D.analysis || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS_KEY = `patchvista:${D.reportId}`;
const storage = window.patchvistaStorage;
const ICONS = JSON.parse(document.getElementById('icons').textContent);
const icon = (name) => `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] ?? ICONS.circle}</svg>`;
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
const readPalette = () => {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries([...css].filter((key) => key.startsWith('--')).map((key) => [key, css.getPropertyValue(key).trim()]));
};
let palette = readPalette();
const color = (token) => palette[`--${token}`];

// ---------------------------------------------------------------- model
const KIND_ICON = {
  function: 'braces', method: 'code-xml', class: 'box', interface: 'brackets', type: 'variable', enum: 'list', const: 'variable', namespace: 'network', test: 'test-tube-diagonal', module: 'layers',
  db: 'database', redis: 'zap', mq: 'mail', config: 'settings-2', route: 'route', http: 'globe', job: 'clock', dep: 'package', file: 'file',
};
const KIND_LABEL = {
  function: '函数', method: '方法', class: '类', interface: '接口', type: '类型', enum: '枚举', const: '常量/变量', namespace: '命名空间',
  test: '测试', module: '模块级代码', db: '数据库表', redis: 'Redis', mq: '消息/队列', config: '配置项', route: 'HTTP 路由',
  http: '外部 HTTP', job: '定时任务', dep: '依赖包',
};
const STATUS_LABEL = { added: '新增', modified: '修改', deleted: '删除', moved: '移动', renamed: '重命名', context: '未改动', removed: '移除', unchanged: '未变', existing: '已有' };
const OP_COLOR = { read: 'accent', write: 'orange', publish: 'purple', consume: 'teal', define: 'mute', schema: 'del', handle: 'add' };
const SHAPE_KINDS = new Set(['interface', 'type', 'enum']);
// DOM badges and graph SVGs use the same icon paths and semantic color tokens.
const KIND_STYLE = {
  function: { c: 'accent' }, method: { c: 'cyan' }, class: { c: 'purple' },
  interface: { c: 'purple' }, type: { c: 'pink' }, enum: { c: 'orange' },
  const: { c: 'add' }, namespace: { c: 'mute' }, test: { c: 'add' },
  module: { c: 'mute' }, file: { c: 'mute' },
  db: { c: 'mod' }, redis: { c: 'del' }, mq: { c: 'purple' }, config: { c: 'mute' },
  route: { c: 'add' }, http: { c: 'accent' }, job: { c: 'pink' }, dep: { c: 'purple' },
};
const STATUS_INK = { added: 'add', modified: 'mod', deleted: 'del', removed: 'del', moved: 'mov', renamed: 'ren', context: 'faint', unchanged: 'faint' };
const UI_FONT = getComputedStyle(document.documentElement).getPropertyValue('--ui').trim();
const NAME_FONT = `600 12.5px ${UI_FONT}`;
const META_FONT = `11px ${UI_FONT}`;
const CARD_H = 46;
const svgEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kindBadge = (kind) => {
  const k = KIND_STYLE[kind] ?? { c: 'mute' };
  return `<span class="kb" style="color:var(--${k.c});background:color-mix(in srgb,var(--${k.c}) 12%,transparent)">${icon(KIND_ICON[kind])}</span>`;
};
/**
 * name: label text (kept as a real cytoscape label so it stays crisp);
 * meta: [{t, c?, b?}] segments for the second line; bar: status colour or null.
 */
function card({ name, meta, kind, bar, faded, pill }) {
  const k = KIND_STYLE[kind] ?? { c: 'mute' };
  const ink = color(k.c);
  const bw = 22;
  const padL = 12 + bw + 11;
  const nameW = measure([name], NAME_FONT);
  const metaW = measure([meta.map((m) => m.t).join('')], META_FONT);
  const w = Math.ceil(padL + Math.max(nameW, metaW) + (pill ? 22 : 16));
  const tspans = meta.map((m) => `<tspan fill="${m.c ?? color('mute')}"${m.b ? ' font-weight="600"' : ''}>${svgEsc(m.t)}</tspan>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${CARD_H}" viewBox="0 0 ${w} ${CARD_H}">`
    + (bar && !pill ? `<rect x="0" y="0" width="3.5" height="${CARD_H}" fill="${bar}"/>` : '')
    + `<rect x="12" y="13" width="${bw}" height="20" rx="6" fill="${ink}" fill-opacity="${faded ? 0.06 : 0.12}"/>`
    + `<svg x="16" y="16" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[KIND_ICON[kind]] ?? ICONS.circle}</svg>`
    + `<text x="${padL}" y="34.5" font-family="${svgEsc(UI_FONT)}" font-size="11">${tspans}</text></svg>`;
  return { w, h: CARD_H, img: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, mx: padL + nameW / 2 - w / 2, label: name };
}
const st = (status, text) => ({ t: text ?? STATUS_LABEL[status] ?? status, c: color(STATUS_INK[status] ?? 'mute'), b: true });
const dot = { t: '  ·  ' };
const churn = (a, d) => [{ t: `+${a}`, c: color('add') }, { t: ' ' }, { t: `−${d}`, c: color('del') }];

const nodes = new Map(); // sid → node
const idToSid = new Map();
for (const e of F.entities) { nodes.set(e.sid, { ...e, nt: 'entity' }); idToSid.set(e.id, e.sid); }
for (const c of F.contexts) { nodes.set(c.sid, { ...c, nt: 'context' }); idToSid.set(c.id, c.sid); }
for (const r of F.resources) nodes.set(r.sid, { ...r, nt: 'resource', qname: r.name });
const files = new Map(F.files.map((f) => [f.id, f]));
const fileByPath = new Map(F.files.map((f) => [f.path, f]));

function moduleOf(p) {
  const parts = p.split('/'); parts.pop();
  if (!parts.length) return '(root)';
  const roots = new Set(['src', 'lib', 'app', 'apps', 'packages', 'internal', 'pkg', 'cmd', 'modules']);
  let i = 0; const keep = [];
  while (i < parts.length && roots.has(parts[i]) && keep.length < 2) keep.push(parts[i++]);
  return [...keep, ...parts.slice(i, i + 2)].join('/') || parts[0];
}
for (const n of [...nodes.values(), ...F.entities, ...F.contexts]) if (n.file) n.module = moduleOf(n.file);

const edges = []; // {s,t,kind:'ref'|'res', ...}
for (const ed of F.edges) {
  const s = idToSid.get(ed.from); const t = idToSid.get(ed.to);
  if (s && t) edges.push({ s, t, et: 'ref', kinds: ed.kinds, status: ed.status, refs: ed.refs, confidence: ed.confidence });
}
for (const r of F.resources) {
  const agg = new Map();
  for (const u of r.usages) {
    const s = idToSid.get(u.entity); if (!s) continue;
    const k = `${s}|${u.op}`;
    if (!agg.has(k)) agg.set(k, { s, t: r.sid, et: 'res', op: u.op, status: u.status, refs: [] });
    const a = agg.get(k);
    if (a.status !== u.status) a.status = 'modified';
    a.refs.push(u);
  }
  edges.push(...agg.values());
}
const outE = new Map(); const inE = new Map();
for (const e of edges) {
  (outE.get(e.s) ?? outE.set(e.s, []).get(e.s)).push(e);
  (inE.get(e.t) ?? inE.set(e.t, []).get(e.t)).push(e);
}
const isTrivial = (n) => n.nt === 'entity' && ((n.status === 'moved' && !n.bodyChanged) || n.importOnly);
const isTestNode = (n) => n.isTest;
const reviewable = F.entities.filter((e) => !e.isTest && !isTrivial(e));

// change sets (AI) or fallback by module
const changeSets = (() => {
  const known = (l) => (l ?? []).filter((x) => nodes.has(x) || files.has(x));
  if (A.changeSets?.length) {
    const sets = A.changeSets.map((cs, i) => ({ ...cs, id: cs.id ?? `cs${i + 1}`, entities: known(cs.entities), files: known(cs.files), resources: known(cs.resources), reviewOrder: known(cs.reviewOrder) }));
    const placed = new Set(sets.flatMap((s) => s.entities));
    const rest = reviewable.filter((e) => !placed.has(e.sid)).map((e) => e.sid);
    if (rest.length) sets.push({ id: 'cs-rest', title: '其他改动', summary: '未被 AI 归入任何改动集的实体', entities: rest, auto: true });
    return sets;
  }
  const byMod = new Map();
  for (const e of reviewable) (byMod.get(e.module) ?? byMod.set(e.module, []).get(e.module)).push(e.sid);
  const sets = [...byMod].sort((a, b) => b[1].length - a[1].length).map(([m, ents], i) => ({ id: `m${i}`, title: m, summary: `${ents.length} 个改动实体`, entities: ents, auto: true }));
  const moves = F.entities.filter(isTrivial).map((e) => e.sid);
  if (moves.length) sets.push({ id: 'moves', title: '纯移动 / 仅 import 变化', summary: '内容未变仅位置变化，或只改了 import', entities: moves, auto: true, risk: 'low' });
  const tests = F.entities.filter((e) => e.isTest).map((e) => e.sid);
  if (tests.length) sets.push({ id: 'tests', title: '测试', summary: `${tests.length} 个测试相关实体`, entities: tests, auto: true, risk: 'low' });
  return sets;
})();
const csById = new Map(changeSets.map((c) => [c.id, c]));
const risks = [...(A.risks ?? []).map((r) => ({ ...r, src: 'AI' })), ...F.risks.map((r) => ({ ...r, src: '规则' }))];

// ---------------------------------------------------------------- persistent state
const store = JSON.parse(storage.getItem(LS_KEY) || '{}');
store.reviewed ??= {};
const save = () => storage.setItem(LS_KEY, JSON.stringify(store));
const editorSel = $('#editor');
editorSel.value = storage.getItem('patchvista:editor') || 'vscode';
editorSel.onchange = () => storage.setItem('patchvista:editor', editorSel.value);

const state = {
  view: 'module', scope: { type: 'all' }, history: [], selected: null,
  opt: { context: true, res: true, tests: false, moves: false, types: true, depth: 1 },
};

// ---------------------------------------------------------------- header
$('#title').textContent = A.title || `${F.meta.repoName} · ${F.meta.range.label}`;
$('#title').title = F.meta.range.label;
$('#stats').innerHTML = `<span>${F.stats.files} 文件</span><span><b class="a">+${F.stats.additions}</b> <b class="d">−${F.stats.deletions}</b></span><span>${F.entities.length} 实体</span><span>${F.resources.length} 资源</span>`;
function updateProgress() {
  const done = reviewable.filter((e) => store.reviewed[e.sid] === 'ok').length;
  const pct = reviewable.length ? Math.round((done / reviewable.length) * 100) : 0;
  $('#progress i').style.width = pct + '%';
  $('#progress span').textContent = `已审 ${done}/${reviewable.length}`;
}

// ---------------------------------------------------------------- helpers
const openHref = (file, line) => {
  const abs = `${F.meta.repo}/${file}`;
  switch (editorSel.value) {
    case 'vscode': return `vscode://file${abs}:${line || 1}`;
    case 'cursor': return `cursor://file${abs}:${line || 1}`;
    case 'idea': return `idea://open?file=${encodeURIComponent(abs)}&line=${line || 1}`;
    default: return null;
  }
};
const pathLink = (file, line) => `<button type="button" class="path" data-open="${esc(file)}" data-line="${line || ''}" title="在编辑器中打开">${esc(file)}${line ? ':' + line : ''}</button>`;
const pill = (status, text) => `<span class="pill st-${status}">${esc(text ?? STATUS_LABEL[status] ?? status)}</span>`;
const nodeName = (n) => n.nt === 'resource' ? n.name : n.kind === 'module' ? `${n.name} · 模块级代码` : n.qname;
const chip = (sid) => {
  const n = nodes.get(sid) || files.get(sid);
  if (!n) return `<code>${esc(sid)}</code>`;
  const label = n.path ? n.path.split('/').pop() : nodeName(n);
  return `<button type="button" class="chip" data-sel="${esc(sid)}" title="${esc(n.path ?? n.file ?? n.kind)}">${icon(n.path ? 'file' : KIND_ICON[n.kind])} ${esc(label)}</button>`;
};
function md(text) {
  if (!text) return '';
  const inline = (s) => esc(s)
    .replace(/\[\[([ecrf]\d+)\]\]/g, (_, id) => chip(id))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const out = []; let list = null;
  for (const raw of String(text).split('\n')) {
    const l = raw.trimEnd();
    const li = l.match(/^\s*[-*]\s+(.*)/) || l.match(/^\s*\d+[.)]\s+(.*)/);
    if (li) { if (!list) { list = []; } list.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (!l.trim()) continue;
    const h = l.match(/^#{1,6}\s+(.*)/);
    out.push(h ? `<h4>${inline(h[1])}</h4>` : `<p>${inline(l)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return `<div class="md">${out.join('')}</div>`;
}

const plain = (t) => String(t ?? '').replace(/\[\[([ecrf]\d+)\]\]/g, (_, id) => { const n = nodes.get(id) || files.get(id); return n ? (n.path ?? nodeName(n)) : id; }).replace(/[`*]/g, '');

// tiny highlighter
const KW = /\b(async|await|break|case|catch|class|const|continue|def|default|defer|delete|do|elif|else|enum|except|export|extends|finally|for|from|func|function|go|if|implements|import|in|instanceof|interface|is|lambda|let|map|new|nil|None|not|null|of|or|and|package|pass|private|protected|public|raise|readonly|return|select|static|struct|super|switch|this|self|throw|true|false|True|False|try|type|typeof|undefined|var|void|while|with|yield)\b/;
const TOK = new RegExp(String.raw`(\/\/.*$|#.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + '`(?:[^`\\\\]|\\\\.)*`' + String.raw`)|(@\w+)|(\b\d[\d_.]*\b)|` + KW.source, 'g');
function hl(code, lang) {
  let out = ''; let last = 0;
  const src = lang === 'py' || lang === 'go' ? code : code.replace(/#/g, '\u0000');
  src.replace(TOK, (m, c, s, d, n, k, idx) => {
    out += esc(code.slice(last, idx));
    const t = code.slice(idx, idx + m.length);
    out += `<span class="tk-${c ? 'c' : s ? 's' : d ? 'd' : n ? 'n' : 'k'}">${esc(t)}</span>`;
    last = idx + m.length;
    return m;
  });
  return out + esc(code.slice(last));
}
function hunksHtml(hunks, lang) {
  const rows = [];
  for (const h of hunks) {
    rows.push(`<tr class="hunk"><td class="no"></td><td class="no"></td><td>@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${esc(h.ctx ?? '')}</td></tr>`);
    let o = h.oldStart; let n = h.newStart;
    for (const l of h.lines) {
      const s = l[0]; const t = l.slice(1);
      if (s === '\\') continue;
      if (s === '+') rows.push(`<tr class="add"><td class="no"></td><td class="no">${n++}</td><td>+${hl(t, lang)}</td></tr>`);
      else if (s === '-') rows.push(`<tr class="del"><td class="no">${o++}</td><td class="no"></td><td>-${hl(t, lang)}</td></tr>`);
      else rows.push(`<tr><td class="no">${o++}</td><td class="no">${n++}</td><td> ${hl(t, lang)}</td></tr>`);
    }
  }
  return `<table>${rows.join('')}</table>`;
}
function parsePatch(patch) {
  const hunks = []; let cur = null;
  for (const line of (patch || '').split('\n')) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
    if (m) { cur = { oldStart: +m[1], oldLines: +(m[2] ?? 1), newStart: +m[3], newLines: +(m[4] ?? 1), ctx: m[5], lines: [] }; hunks.push(cur); continue; }
    if (cur && line !== '') cur.lines.push(line);
    else if (cur && line === '') cur.lines.push(' ');
  }
  for (const h of hunks) while (h.lines.length && h.lines.at(-1) === ' ') h.lines.pop();
  return hunks;
}

// ---------------------------------------------------------------- left panel
let leftTab = 'files';
// file tab: collapsed dirs are per report, the extension/kind filter is a global preference
store.collapsed ??= {};
const fileFilter = { q: '', hide: new Set(JSON.parse(storage.getItem('patchvista:hideFileTypes') || '[]')) };
const extOf = (p) => { const b = p.split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i).toLowerCase() : b; };
// one filter state shared by the file list and the graph
const typeHidden = (p) => Boolean(p) && fileFilter.hide.has(extOf(p));
const fileVisible = (f) => !typeHidden(f.path)
  && (!fileFilter.q || f.path.toLowerCase().includes(fileFilter.q) || (f.oldPath ?? '').toLowerCase().includes(fileFilter.q));
function renderLeft() {
  document.querySelectorAll('#leftTabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === leftTab);
    b.setAttribute('aria-pressed', String(b.dataset.tab === leftTab));
  });
  const body = $('#leftBody');
  if (leftTab === 'sets') {
    const csCur = state.scope.type === 'cs' ? state.scope.key : null;
    body.innerHTML = (A.changeSets?.length ? '' : `<div class="hint" style="padding:6px 12px">未提供 AI 分析，按模块自动分组</div>`) +
      changeSets.map((cs, i) => {
        const rv = cs.entities.filter((s) => store.reviewed[s] === 'ok').length;
        const tot = cs.entities.length;
        return `<button type="button" class="cs ${csCur === cs.id ? 'on' : ''}" data-cs="${esc(cs.id)}" aria-pressed="${csCur === cs.id}">
          <span class="h"><span class="n">${i + 1}</span><span class="t">${esc(cs.title)}</span>${cs.risk ? `<span class="pill lv-${esc(cs.risk)}">${esc(cs.risk)}</span>` : ''}</span>
          ${cs.summary ? `<span class="s">${esc(plain(cs.summary))}</span>` : ''}
          <span class="m"><span>${tot} 实体</span>${cs.files?.length ? `<span>${cs.files.length} 文件</span>` : ''}<span class="${rv === tot && tot ? 'done' : ''}">${icon('check')} ${rv}/${tot}</span></span>
        </button>`;
      }).join('');
  } else if (leftTab === 'files') {
    if (!$('#ftree', body)) {
      body.innerHTML = `<div class="ftools">
        <div class="fsearch"><input id="fq" name="file-search" aria-label="筛选文件路径" placeholder="筛选文件路径…" autocomplete="off" spellcheck="false"><button id="fexp" aria-label="展开全部目录" title="展开全部目录">${icon('chevrons-up-down')}</button><button id="fcol" aria-label="收起全部目录" title="收起全部目录">${icon('chevrons-down-up')}</button></div>
        <div id="fchips" class="fchips"></div></div><div id="ftree" class="tree"></div>`;
      $('#fq', body).value = fileFilter.q;
    }
    renderFileTree();
  } else if (leftTab === 'risks') {
    body.innerHTML = risks.length ? risks.map((r, i) => `<button type="button" class="risk" data-risk="${i}">
      <span><span class="pill lv-${r.level}">${r.level}</span> <span class="t">${esc(r.title)}</span> <span class="src">${r.src}</span></span>
      ${r.detail ? `<span class="d">${esc(r.detail)}</span>` : ''}</button>`).join('') : '<div class="hint" style="padding:12px">没有发现风险项</div>';
  } else if (leftTab === 'res') {
    const byKind = new Map();
    for (const r of F.resources) (byKind.get(r.kind) ?? byKind.set(r.kind, []).get(r.kind)).push(r);
    body.innerHTML = [...byKind].map(([k, list]) => `<div class="group-h">${icon(KIND_ICON[k])} ${KIND_LABEL[k] ?? k} (${list.length})</div>` +
      `<div class="tree">${list.map((r) => `<button type="button" class="row" data-sel="${r.sid}"><span class="nm">${esc(r.name)}</span>${pill(r.status)}${r.stillReferenced?.length || r.undeclared ? icon('triangle-alert') : ''}</button>`).join('')}</div>`).join('') ||
      '<div class="hint" style="padding:12px">未检测到资源</div>';
  }
}
function renderFileTree() {
  const focused = document.activeElement;
  const focusKey = focused?.closest('#leftBody') ? { dir: focused.dataset.dir, file: focused.dataset.file, ft: focused.dataset.ft } : null;
  // chips: extensions present in this diff; click toggles hiding
  $('#fchips').innerHTML = typeChipsHtml();

  const shown = F.files.filter(fileVisible);
  const tree = {};
  for (const f of shown) {
    const parts = f.path.split('/'); let node = tree;
    for (const p of parts.slice(0, -1)) node = (node[p + '/'] ??= {});
    node[parts.at(-1)] = f;
  }
  const countFiles = (node) => Object.values(node).reduce((n, v) => n + (v.id ? 1 : countFiles(v)), 0);
  const rows = [];
  // searching forces dirs open so hits are visible
  const isCollapsed = (path) => !fileFilter.q && store.collapsed[path];
  const walk = (node, depth, base) => {
    for (const k of Object.keys(node).sort((a, b) => (b.endsWith('/') - a.endsWith('/')) || a.localeCompare(b))) {
      let v = node[k];
      if (k.endsWith('/')) {
        // collapse single-child dir chains into one row
        let name = k;
        for (let keys = Object.keys(v); keys.length === 1 && keys[0].endsWith('/'); keys = Object.keys(v)) { name += keys[0]; v = v[keys[0]]; }
        const path = base + name;
        const closed = isCollapsed(path);
        rows.push(`<button type="button" class="row dir" data-dir="${esc(path)}" aria-expanded="${!closed}" style="padding-left:${8 + depth * 14}px"><span class="tw">${icon(closed ? 'chevron-right' : 'chevron-down')}</span><span class="nm">${esc(name.replace(/\/$/, ''))}</span><span class="num">${countFiles(v)}</span></button>`);
        if (!closed) walk(v, depth + 1, path);
      } else {
        const cur = state.scope.type === 'file' && state.scope.key === v.id;
        const st = v.status === 'renamed' ? 'moved' : v.status;
        rows.push(`<button type="button" class="row ${cur ? 'on' : ''}" data-file="${v.id}" aria-pressed="${cur}" style="padding-left:${8 + depth * 14 + 14}px" title="${esc(v.path)}${v.oldPath ? '\n原路径：' + esc(v.oldPath) : ''}">
          <span class="pill st-${st}">${{ added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C' }[v.status] ?? '?'}</span>
          <span class="nm">${esc(k)}</span><span class="num">+${v.additions} −${v.deletions}</span></button>`);
      }
    }
  };
  walk(tree, 0, '');
  const hidden = F.files.length - shown.length;
  $('#ftree').innerHTML = (rows.join('') || '<div class="hint" style="padding:10px 12px">没有匹配的文件</div>')
    + (hidden ? `<div class="hint fhidden" role="status">已隐藏 ${hidden} 个文件</div>` : '');
  if (focusKey) {
    [...$('#leftBody').querySelectorAll('button')].find((el) => Object.entries(focusKey).some(([key, value]) => value !== undefined && el.dataset[key] === value))?.focus({ preventScroll: true });
  }
}
// chips = the extensions present in this diff only
const diffExts = (() => {
  const m = new Map();
  for (const f of F.files) { const k = extOf(f.path); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
})();
function typeChipsHtml() {
  return diffExts.map(([k, n]) => {
    const off = fileFilter.hide.has(k);
    return `<button class="fchip ${off ? 'off' : ''}" data-ft="${esc(k)}" aria-pressed="${!off}" title="${off ? '点击显示' : '点击隐藏'}">${esc(k)}<i>${n}</i></button>`;
  }).join('');
}
function syncTypeFilterUi() {
  $('#gchips').innerHTML = typeChipsHtml();
  const hidden = diffExts.filter(([k]) => fileFilter.hide.has(k)).map(([k]) => k);
  // keep the button short; the full list goes into the tooltip
  $('#ftypeLabel').textContent = hidden.length ? `文件类型 · 已隐藏 ${hidden.length}` : '文件类型';
  $('#ftypeSum').title = hidden.length ? `已隐藏：${hidden.join(' ')}` : '按文件后缀筛选';
  $('#ftypeSum').classList.toggle('active', hidden.length > 0);
}
function toggleFileType(k) {
  const focusedGroup = document.activeElement?.closest('#gchips, #fchips')?.id;
  fileFilter.hide.has(k) ? fileFilter.hide.delete(k) : fileFilter.hide.add(k);
  storage.setItem('patchvista:hideFileTypes', JSON.stringify([...fileFilter.hide]));
  syncTypeFilterUi();
  if ($('#ftree')) renderFileTree();
  if (focusedGroup) [...document.getElementById(focusedGroup).querySelectorAll('button')].find((button) => button.dataset.ft === k)?.focus({ preventScroll: true });
  redraw();
}
$('#gchips').addEventListener('click', (ev) => { const ft = ev.target.closest('[data-ft]'); if (ft) toggleFileType(ft.dataset.ft); });
function countBy(list, keyFn) {
  const m = new Map();
  for (const x of list) { const k = keyFn(x); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}
$('#leftBody').addEventListener('input', (ev) => {
  if (ev.target.id !== 'fq') return;
  fileFilter.q = ev.target.value.trim().toLowerCase();
  renderFileTree();
});
$('#leftBody').addEventListener('click', (ev) => {
  const ft = ev.target.closest('[data-ft]');
  if (ft) { toggleFileType(ft.dataset.ft); return; }
  const dir = ev.target.closest('[data-dir]');
  if (dir) {
    const k = dir.dataset.dir;
    if (store.collapsed[k]) delete store.collapsed[k]; else store.collapsed[k] = 1;
    save(); renderFileTree();
    return;
  }
  if (ev.target.closest('#fexp')) { store.collapsed = {}; save(); renderFileTree(); }
  if (ev.target.closest('#fcol')) {
    for (const f of F.files) { const parts = f.path.split('/'); for (let i = 1; i < parts.length; i++) store.collapsed[parts.slice(0, i).join('/') + '/'] = 1; }
    save(); renderFileTree();
  }
});
$('#leftTabs').onclick = (ev) => { const b = ev.target.closest('button'); if (b) { leftTab = b.dataset.tab; renderLeft(); } };
$('#leftBody').onclick = (ev) => {
  const cs = ev.target.closest('[data-cs]');
  if (cs) { go({ type: 'cs', key: cs.dataset.cs }, 'entity'); showChangeSet(cs.dataset.cs); return; }
  const f = ev.target.closest('[data-file]');
  if (f) { go({ type: 'file', key: f.dataset.file }, 'entity'); showFile(f.dataset.file); return; }
  const r = ev.target.closest('[data-risk]');
  if (r) {
    const risk = risks[+r.dataset.risk];
    const ents = (risk.entities ?? []).filter((s) => nodes.has(s));
    if (ents.length) go({ type: 'set', key: ents, label: risk.title }, 'entity');
    showRisk(risk);
    return;
  }
  const s = ev.target.closest('[data-sel]');
  if (s) select(s.dataset.sel, true);
};

// ---------------------------------------------------------------- scope → visible graph
function scopeSeeds(scope) {
  switch (scope.type) {
    case 'cs': {
      const cs = csById.get(scope.key);
      const fromFiles = (cs.files ?? []).flatMap((fid) => files.get(fid)?.entities ?? []).map((id) => idToSid.get(id)).filter(Boolean);
      return { seeds: [...new Set([...cs.entities, ...fromFiles])], extraRes: cs.resources ?? [], strict: true };
    }
    case 'module': return { seeds: F.entities.filter((e) => e.module === scope.key).map((e) => e.sid) };
    case 'file': {
      const f = files.get(scope.key);
      return { seeds: f.entities.map((id) => idToSid.get(id)).filter(Boolean), strict: true, fileOnly: f };
    }
    case 'node': return { seeds: [scope.key], strict: true, depth: Math.max(2, state.opt.depth) };
    case 'set': return { seeds: scope.key, strict: true };
    case 'search': return { seeds: scope.key, strict: true };
    default: return { seeds: F.entities.map((e) => e.sid) };
  }
}
function allowed(n, strictSeed) {
  if (!n) return false;
  if (n.nt !== 'resource' && typeHidden(n.file)) return false;
  if (strictSeed) return true;
  if (n.nt === 'resource') return state.opt.res;
  if (!state.opt.tests && isTestNode(n)) return false;
  if (!state.opt.moves && isTrivial(n)) return false;
  if (!state.opt.types && SHAPE_KINDS.has(n.kind)) return false;
  if (n.nt === 'context' && !state.opt.context) return false;
  return true;
}
function visibleEntityGraph() {
  const sc = scopeSeeds(state.scope);
  const seedSet = new Set(sc.seeds.filter((s) => {
    const n = nodes.get(s);
    // the file-type filter is absolute, even for explicitly scoped seeds
    if (!n || (n.nt !== 'resource' && typeHidden(n.file))) return false;
    return sc.strict || allowed(n);
  }));
  // in strict scopes still honour the "tests"/"moves" toggles unless that's all there is
  if (sc.strict && state.scope.type !== 'node') {
    const filtered = [...seedSet].filter((s) => allowed(nodes.get(s)));
    if (filtered.length) { seedSet.clear(); filtered.forEach((s) => seedSet.add(s)); }
  }
  const vis = new Set(seedSet);
  const depth = sc.depth ?? (state.scope.type === 'all' ? 0 : state.opt.depth);
  let frontier = [...seedSet];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const s of frontier) {
      for (const e of [...(outE.get(s) ?? []), ...(inE.get(s) ?? [])]) {
        const o = e.s === s ? e.t : e.s;
        if (vis.has(o)) continue;
        const n = nodes.get(o);
        if (!allowed(n)) continue;
        if (n.nt === 'resource') continue; // resources added below
        vis.add(o); next.push(o);
      }
    }
    frontier = next;
  }
  if (state.scope.type === 'all') {
    // whole-diff view: changed entities + their direct context neighbours if enabled
    for (const s of [...vis]) for (const e of [...(outE.get(s) ?? []), ...(inE.get(s) ?? [])]) {
      const o = e.s === s ? e.t : e.s; const n = nodes.get(o);
      if (n?.nt === 'context' && allowed(n)) vis.add(o);
    }
  }
  if (state.opt.res) {
    for (const s of [...vis]) for (const e of outE.get(s) ?? []) if (e.et === 'res' && (e.status !== 'unchanged' || seedSet.has(s))) vis.add(e.t);
    for (const r of sc.extraRes ?? []) vis.add(r);
  }
  return { vis, seedSet };
}

function measure(lines, font = `12px ${UI_FONT}`) {
  const ctx = measure.ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = font;
  return Math.max(...lines.map((l) => ctx.measureText(l).width));
}

function entityCard(n, inClass) {
  const raw = n.kind === 'module' ? '模块级代码' : inClass && n.parent ? n.name : n.qname;
  const name = raw.length > 48 ? raw.slice(0, 46) + '…' : raw;
  const isCtx = n.nt === 'context';
  const meta = [];
  if (isCtx) meta.push({ t: `${KIND_LABEL[n.kind] ?? n.kind}  ·  未改动`, c: color('faint') });
  else {
    meta.push(st(n.status), dot, { t: n.kind === 'module' ? (n.importOnly ? '仅 import' : 'import / 顶层语句') : KIND_LABEL[n.kind] ?? n.kind });
    if (n.moved && n.status !== 'moved') meta.push(dot, st('moved', '已移动'));
    if (n.status !== 'moved' && (n.additions || n.deletions)) meta.push(dot, ...churn(n.additions, n.deletions));
    if (n.signatureChanged) meta.push(dot, { t: '签名变更', c: color('orange'), b: true });
    if (store.reviewed[n.sid] === 'ok') meta.push(dot, { t: '已审', c: color('add') });
    if (store.reviewed[n.sid] === 'q') meta.push(dot, { t: '有疑问', c: color('orange') });
  }
  return { name, meta, ...card({ name, meta, kind: n.kind, bar: isCtx ? null : color(STATUS_INK[n.status] ?? 'faint'), faded: isCtx, pill: n.kind === 'const' }) };
}

function resNode(n) {
  const name = n.name.length > 40 ? n.name.slice(0, 38) + '…' : n.name;
  const meta = [st(n.status), dot, { t: KIND_LABEL[n.kind] ?? n.kind }];
  if (n.stillReferenced?.length || n.undeclared) meta.push(dot, { t: n.undeclared ? '未声明' : '仍被引用', c: color('del'), b: true });
  const c = card({ name, meta, kind: n.kind, pill: true, faded: n.status === 'unchanged' });
  return { group: 'nodes', data: {
    id: n.sid, label: c.label, img: c.img, w: c.w, h: c.h, mx: c.mx, r: c.h / 2,
    border: color(n.status === 'removed' ? 'del' : 'line'), bs: n.status === 'removed' ? 'dashed' : 'solid', tc: color('text'),
  }, classes: `card res r-${n.kind}` };
}

function buildEntityElements() {
  const { vis, seedSet } = visibleEntityGraph();
  const els = [];
  const parents = new Map(); // id → {label,...}
  const visEnt = [...vis].map((s) => nodes.get(s)).filter((n) => n.nt !== 'resource');
  const classEntity = new Map();
  for (const n of visEnt) if (n.kind === 'class') classEntity.set(`${n.file}#${n.name}`, n);
  const hasChild = new Set(visEnt.filter((n) => n.parent).map((n) => `${n.file}#${n.parent}`));

  for (const n of visEnt) {
    const fileKey = `file:${n.file}`;
    if (!parents.has(fileKey)) {
      const f = fileByPath.get(n.file);
      const base = n.file.split('/').pop();
      const dir = n.file.split('/').slice(-3, -1).join('/');
      parents.set(fileKey, { id: fileKey, label: `${base}    ${dir ? dir + '/' : ''}`, kind: 'file', status: f ? (f.status === 'renamed' ? 'moved' : f.status) : 'context', path: n.file, fid: f?.id });
    }
    let parent = fileKey;
    if (n.parent) {
      const ck = `${n.file}#${n.parent}`;
      const ce = classEntity.get(ck);
      const cid = ce ? ce.sid : `cls:${ck}`;
      if (!ce && !parents.has(cid)) parents.set(cid, { id: cid, label: `类 · ${n.parent}`, kind: 'class-virtual', status: 'context', parent: fileKey });
      parent = cid;
    }
    const isCompound = n.kind === 'class' && hasChild.has(`${n.file}#${n.name}`);
    const isCtx = n.nt === 'context';
    const c = entityCard(n, Boolean(n.parent));
    const data = {
      id: n.sid, parent, seed: seedSet.has(n.sid) ? 1 : 0,
      reviewed: store.reviewed[n.sid] === 'ok' ? 1 : 0, compound: isCompound ? 1 : 0,
      bs: n.status === 'deleted' ? 'dashed' : isCtx ? 'dashed' : 'solid',
      border: color(n.status === 'deleted' ? 'del' : 'line'),
      tc: color(isCtx ? 'mute' : n.status === 'deleted' ? 'del' : 'text'),
    };
    if (isCompound) {
      const meta = c.meta.map((m) => m.t).join('');
      Object.assign(data, { label: `类 · ${c.name}     ${meta}`, border: color(STATUS_INK[n.status] ?? 'line') });
    } else {
      Object.assign(data, { label: c.label, img: c.img, w: c.w, h: c.h, mx: c.mx });
      if (n.kind === 'const') data.r = c.h / 2;
    }
    els.push({ group: 'nodes', data, classes: `ent ${n.nt} k-${n.kind} ${isCompound ? 'cmp classcmp' : 'card'}` });
  }
  for (const p of parents.values()) {
    const label = p.kind === 'file' ? `${p.label}${p.status !== 'context' && p.status !== 'modified' ? `  ·  ${STATUS_LABEL[p.status] ?? p.status}` : ''}` : p.label;
    els.push({ group: 'nodes', data: { id: p.id, parent: p.parent, label, path: p.path, fid: p.fid }, classes: `cmp ${p.kind}${p.status === 'context' ? ' ctxfile' : ''}` });
  }
  for (const s of vis) {
    const n = nodes.get(s);
    if (n.nt !== 'resource') continue;
    els.push(resNode(n));
  }
  let i = 0;
  for (const e of edges) {
    if (!vis.has(e.s) || !vis.has(e.t)) continue;
    // an edge into a compound (class with visible methods) is fine in cytoscape
    if (e.et === 'ref') {
      const typeOnly = e.kinds.every((k) => k === 'type' || k === 'implements' || k === 'extends');
      els.push({ group: 'edges', data: { id: `e${i++}`, source: e.s, target: e.t, color: color(e.status === 'added' ? 'add' : 'edge'), width: e.status === 'added' ? 1.8 : 1.2, ls: typeOnly ? 'dashed' : 'solid', label: e.kinds.includes('implements') ? 'implements' : e.kinds.includes('extends') ? 'extends' : '', ref: edges.indexOf(e) }, classes: 'ref' });
    } else {
      els.push({ group: 'edges', data: { id: `e${i++}`, source: e.s, target: e.t, color: color(e.status === 'removed' ? 'del' : OP_COLOR[e.op] ?? 'faint'), width: e.status === 'added' ? 1.8 : 1.2, ls: e.status === 'removed' ? 'dashed' : 'solid', label: `${e.op}${e.status === 'added' ? ' +' : e.status === 'removed' ? ' −' : ''}`, ref: edges.indexOf(e) }, classes: 'resedge' });
    }
  }
  return els;
}

function buildModuleElements() {
  const mods = new Map();
  const modOfNode = (n) => n.module ?? '(root)';
  const ensure = (m, changed) => {
    if (!mods.has(m)) mods.set(m, { id: `mod:${m}`, name: m, files: new Set(), add: 0, del: 0, st: {}, changed: false, n: 0 });
    if (changed) mods.get(m).changed = true;
    return mods.get(m);
  };
  for (const f of F.files) {
    if (!state.opt.tests && f.kind === 'test') continue;
    if (typeHidden(f.path)) continue;
    const m = ensure(f.module, true);
    m.files.add(f.id); m.add += f.additions; m.del += f.deletions;
  }
  for (const e of F.entities) {
    if (!allowed(nodes.get(e.sid))) continue;
    const m = ensure(e.module, true);
    m.st[e.status] = (m.st[e.status] ?? 0) + 1; m.n++;
  }
  const agg = new Map();
  const resAgg = new Map();
  for (const e of edges) {
    const a = nodes.get(e.s); const b = nodes.get(e.t);
    if (!allowed(a) || !allowed(b)) continue;
    if (e.et === 'res') {
      const ma = modOfNode(a); ensure(ma, a.nt === 'entity');
      const k = `mod:${ma}→${b.sid}`;
      if (!resAgg.has(k)) resAgg.set(k, { s: `mod:${ma}`, t: b.sid, ops: new Set(), status: new Set(), n: 0 });
      const r = resAgg.get(k); r.ops.add(e.op); r.status.add(e.status); r.n++;
      continue;
    }
    const ma = modOfNode(a); const mb = modOfNode(b);
    if (ma === mb) continue;
    ensure(ma, a.nt === 'entity'); ensure(mb, b.nt === 'entity');
    const k = `${ma}→${mb}`;
    if (!agg.has(k)) agg.set(k, { s: `mod:${ma}`, t: `mod:${mb}`, n: 0, added: 0 });
    const g = agg.get(k); g.n++; if (e.status === 'added') g.added++;
  }
  const els = [];
  for (const m of mods.values()) {
    if (!m.changed && !state.opt.context) continue;
    const dominant = m.changed ? (m.st.added > (m.st.modified ?? 0) + (m.st.deleted ?? 0) ? 'added' : m.st.deleted > (m.st.modified ?? 0) ? 'deleted' : 'modified') : 'context';
    const meta = m.changed
      ? [{ t: `${m.files.size} 文件` }, dot, ...churn(m.add, m.del), ...Object.entries(m.st).flatMap(([k, v]) => [dot, st(k, `${STATUS_LABEL[k]} ${v}`)])]
      : [{ t: '未改动模块', c: color('faint') }];
    const c = card({ name: m.name, meta, kind: 'module', bar: m.changed ? color(STATUS_INK[dominant]) : null, faded: !m.changed });
    els.push({ group: 'nodes', data: { id: m.id, label: c.label, img: c.img, w: c.w, h: c.h, mx: c.mx, border: color('line'), bs: m.changed ? 'solid' : 'dashed', tc: color(m.changed ? 'text' : 'mute'), mod: m.name }, classes: `card mod ${m.changed ? '' : 'context'}` });
  }
  const present = new Set(els.map((e) => e.data.id));
  if (state.opt.res) {
    for (const r of F.resources) {
      if (![...resAgg.values()].some((x) => x.t === r.sid) && !r.defs.some((d) => !typeHidden(d.file))) continue;
      els.push(resNode(r));
      present.add(r.sid);
    }
  }
  let i = 0;
  for (const g of agg.values()) {
    if (!present.has(g.s) || !present.has(g.t)) continue;
    els.push({ group: 'edges', data: { id: `m${i++}`, source: g.s, target: g.t, label: `${g.n}${g.added ? ` (+${g.added})` : ''}`, color: color(g.added ? 'add' : 'edge'), width: Math.min(1 + Math.log2(g.n + 1), 4.5), ls: 'solid' }, classes: 'ref' });
  }
  for (const r of resAgg.values()) {
    if (!present.has(r.s) || !present.has(r.t)) continue;
    const sign = r.status.has('added') ? ' +' : r.status.has('removed') && r.status.size === 1 ? ' −' : '';
    const op = [...r.ops].join('/');
    els.push({ group: 'edges', data: { id: `m${i++}`, source: r.s, target: r.t, label: op + sign, color: color(sign === ' −' ? 'del' : OP_COLOR[[...r.ops][0]] ?? 'faint'), width: 1.3, ls: sign === ' −' ? 'dashed' : 'solid' }, classes: 'resedge' });
  }
  return els;
}

// ---------------------------------------------------------------- cytoscape
const graphStyles = () => [
    { selector: 'node', style: {
      shape: 'round-rectangle', 'background-color': color('panel'), 'border-color': 'data(border)', 'border-width': 1, 'border-style': 'data(bs)',
      label: 'data(label)', color: 'data(tc)', 'font-size': 12.5, 'font-weight': 600, 'text-wrap': 'none', 'text-valign': 'center', 'text-halign': 'center',
      'font-family': UI_FONT, 'corner-radius': 9, 'text-max-width': 1000,
    } },
    { selector: 'node[w]', style: { width: 'data(w)', height: 'data(h)' } },
    { selector: 'node.card', style: {
      'background-image': 'data(img)', 'background-width': '100%', 'background-height': '100%', 'background-position-x': 0, 'background-position-y': 0,
      'background-clip': 'node', 'background-image-smoothing': 'yes',
      'text-margin-x': 'data(mx)', 'text-margin-y': -7.5,
    } },
    { selector: 'node.card[r]', style: { 'corner-radius': 'data(r)' } },
    { selector: 'node.ent.context, node.mod.context', style: { 'background-color': color('bg') } },
    { selector: 'node.cmp', style: {
      'text-valign': 'top', 'text-halign': 'center', 'font-size': 11, 'font-weight': 500, color: color('mute'), padding: 12, 'text-margin-y': -5,
      'compound-sizing-wrt-labels': 'include', 'min-width': 80, 'border-width': 0, 'background-color': color('group'), 'background-opacity': 0.75, 'corner-radius': 14,
    } },
    { selector: 'node.file', style: { 'font-family': getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() } },
    { selector: 'node.ctxfile', style: { 'background-color': color('surface'), 'background-opacity': 0.5 } },
    { selector: 'node.classcmp', style: {
      'background-color': color('panel'), 'background-opacity': 1, 'border-width': 1, 'border-color': color('ren'), 'border-style': 'solid', color: color('purple'), 'font-weight': 600,
      'font-size': 12, padding: 10, 'text-margin-y': -4, 'corner-radius': 12,
    } },
    { selector: 'node.class-virtual', style: { 'background-color': color('panel'), 'background-opacity': 0.6, 'border-width': 1, 'border-style': 'dashed', 'border-color': color('line'), color: color('faint'), 'text-margin-y': -4 } },
    { selector: 'node[reviewed = 1]', style: { opacity: 0.55 } },
    { selector: 'edge', style: {
      width: 'data(width)', 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.75,
      'curve-style': 'bezier', 'line-style': 'data(ls)', 'line-opacity': 0.9, label: 'data(label)', 'font-size': 10, 'font-family': UI_FONT, color: color('mute'),
      'text-background-color': color('panel'), 'text-background-opacity': 0.9, 'text-background-padding': 2, 'text-background-shape': 'round-rectangle', 'text-rotation': 'autorotate',
    } },
    { selector: 'edge[label = ""]', style: { 'text-background-opacity': 0 } },
    { selector: '.faded', style: { opacity: 0.15, events: 'no' } },
    { selector: 'node.hl', style: { 'border-width': 1.5, 'border-color': color('accent'), 'underlay-color': color('accent'), 'underlay-opacity': 0.14, 'underlay-padding': 5 } },
    { selector: 'edge.hl', style: { width: 2.6, 'z-index': 99 } },
    { selector: 'node.match', style: { 'underlay-color': color('mod'), 'underlay-opacity': 0.35, 'underlay-padding': 6 } },
];
const cy = cytoscape({ container: $('#cy'), minZoom: 0.05, maxZoom: 3, style: graphStyles() });
function syncThemeButtons() {
  document.querySelectorAll('[data-theme-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeMode === window.patchvistaTheme.get())));
}
$('#themeModes').addEventListener('click', (event) => {
  const button = event.target.closest('[data-theme-mode]');
  if (button) window.patchvistaTheme.set(button.dataset.themeMode);
});
window.addEventListener('patchvista:theme', () => {
  palette = readPalette();
  syncThemeButtons();
  // Update colors and SVGs in place: keep the current layout, selection and zoom.
  cy.batch(() => {
    for (const element of state.view === 'module' ? buildModuleElements() : buildEntityElements()) cy.$id(element.data.id).data(element.data);
    cy.style(graphStyles());
  });
  renderLegend();
});
syncThemeButtons();

const elk = new ELK();
let layoutToken = 0;
async function layout() {
  const token = ++layoutToken;
  const nodesById = new Map();
  cy.nodes().forEach((n) => nodesById.set(n.id(), { id: n.id(), children: [], layoutOptions: {} }));
  const root = { id: 'root', children: [], edges: [], layoutOptions: {
    'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.layered.spacing.nodeNodeBetweenLayers': state.view === 'module' ? '90' : '60', 'elk.spacing.nodeNode': '18',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.spacing.componentComponent': '40', 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.separateConnectedComponents': 'true',
  } };
  cy.nodes().forEach((n) => {
    const en = nodesById.get(n.id());
    if (n.isParent()) {
      en.layoutOptions = { 'elk.padding': `[top=${n.hasClass('classcmp') || n.hasClass('class-virtual') ? 26 : 30},left=10,bottom=10,right=10]`, 'elk.spacing.nodeNode': '12' };
    } else {
      en.width = n.data('w') || 120; en.height = n.data('h') || 40;
    }
    const p = n.parent();
    (p.length ? nodesById.get(p.id()).children : root.children).push(en);
  });
  // ELK cannot draw an edge whose endpoint contains the other endpoint
  cy.edges().forEach((e) => {
    const s = e.source(); const t = e.target();
    if (s.ancestors().contains(t) || t.ancestors().contains(s)) return;
    root.edges.push({ id: e.id(), sources: [s.id()], targets: [t.id()] });
  });
  $('#busy').hidden = false;
  try {
    const res = await elk.layout(root);
    if (token !== layoutToken) return;
    const pos = {};
    const walk = (node, ox, oy) => {
      for (const c of node.children ?? []) {
        const x = ox + c.x; const y = oy + c.y;
        if (!c.children?.length) pos[c.id] = { x: x + c.width / 2, y: y + c.height / 2 };
        walk(c, x, y);
      }
    };
    walk(res, 0, 0);
    cy.batch(() => cy.nodes().forEach((n) => { if (!n.isParent() && pos[n.id()]) n.position(pos[n.id()]); }));
    cy.fit(undefined, 30);
  } catch (err) {
    console.error(err);
    cy.layout({ name: 'breadthfirst', directed: true, spacingFactor: 1.1 }).run();
  } finally {
    if (token === layoutToken) $('#busy').hidden = true;
  }
}

function redraw() {
  const els = state.view === 'module' ? buildModuleElements() : buildEntityElements();
  cy.elements().remove();
  cy.add(els);
  $('#empty').hidden = els.length > 0;
  $('#empty').textContent = '当前范围没有可显示的节点（检查「显示」选项）';
  document.querySelectorAll('#viewSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === state.view);
    b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  });
  renderCrumbs();
  renderLegend();
  layout().then(() => { if (state.selected && cy.$id(state.selected).length) highlight(state.selected); });
}

function renderLegend() {
  const statuses = ['added', 'modified', 'deleted', 'moved', 'renamed', 'context'];
  const present = new Set(cy.nodes('.ent').map((n) => n.id()).map((s) => nodes.get(s)?.kind));
  const items = state.view === 'entity'
    ? Object.keys(KIND_STYLE).filter((k) => present.has(k)).map((k) => `<span>${kindBadge(k)}${KIND_LABEL[k]}</span>`)
    : [];
  if (items.length) items.push('<span class="sep"></span>');
  items.push(...statuses.map((s) => `<span><i style="background:var(--${STATUS_INK[s]})"></i>${STATUS_LABEL[s]}</span>`));
  items.push('<span class="sep"></span><span>── 调用</span><span>- - 类型引用</span><span style="color:var(--add)">── 本次新增</span>');
  if (state.opt.res) items.push(...['read', 'write', 'publish', 'consume'].map((o) => `<span style="color:var(--${OP_COLOR[o]})">── ${o}</span>`));
  $('#legend').innerHTML = items.join('');
}

function scopeLabel(sc) {
  switch (sc.type) {
    case 'cs': return `改动集：${csById.get(sc.key)?.title}`;
    case 'module': return `模块：${sc.key}`;
    case 'file': return `文件：${files.get(sc.key)?.path.split('/').pop()}`;
    case 'node': return `聚焦：${nodeName(nodes.get(sc.key))}`;
    case 'set': return sc.label ?? '选中集合';
    case 'search': return `搜索：${sc.label}`;
    default: return '全部改动';
  }
}
function renderCrumbs() {
  const back = state.history.length ? `<button type="button" data-back>${icon('arrow-left')}返回</button><span>·</span>` : '';
  const all = state.scope.type !== 'all' ? `<button type="button" data-all>全部</button><span>/</span>` : '';
  $('#crumbs').innerHTML = `${back}${all}<span class="cur">${esc(scopeLabel(state.scope))}</span>`;
}
$('#crumbs').onclick = (ev) => {
  if (ev.target.closest('[data-back]')) { const h = state.history.pop(); state.scope = h.scope; state.view = h.view; redraw(); renderLeft(); }
  if (ev.target.closest('[data-all]')) go({ type: 'all' });
};

function go(scope, view) {
  state.history.push({ scope: state.scope, view: state.view });
  if (state.history.length > 50) state.history.shift();
  state.scope = scope;
  if (view) state.view = view;
  redraw();
  renderLeft();
}

function highlight(sid) {
  cy.elements().removeClass('faded hl');
  const n = cy.$id(sid);
  if (!n.length) return;
  const nb = n.closedNeighborhood().union(n.descendants()).union(n.descendants().connectedEdges()).union(n.descendants().neighborhood());
  const keep = nb.union(nb.ancestors());
  cy.elements().not(keep).addClass('faded');
  n.addClass('hl');
  n.connectedEdges().addClass('hl');
}

cy.on('tap', 'node', (ev) => {
  const n = ev.target;
  const id = n.id();
  if (nodes.has(id)) { select(id); return; }
  if (id.startsWith('mod:')) { showModule(n.data('mod')); highlight(id); return; }
  if (n.data('fid')) { showFile(n.data('fid')); highlight(id); return; }
  if (n.data('path')) { showContextFile(n.data('path')); highlight(id); }
});
cy.on('dbltap', 'node', (ev) => {
  const n = ev.target; const id = n.id();
  if (id.startsWith('mod:')) go({ type: 'module', key: n.data('mod') }, 'entity');
  else if (nodes.has(id)) go({ type: 'node', key: id }, 'entity');
  else if (n.data('fid')) go({ type: 'file', key: n.data('fid') }, 'entity');
});
cy.on('tap', 'edge', (ev) => { const r = ev.target.data('ref'); if (r != null) showEdge(edges[r]); });
cy.on('tap', (ev) => { if (ev.target === cy) { state.selected = null; cy.elements().removeClass('faded hl'); showOverview(); } });

// ---------------------------------------------------------------- right panel
const detail = $('#detail');
function select(sid, center) {
  state.selected = sid;
  const n = nodes.get(sid) || files.get(sid);
  if (!n) return;
  if (files.has(sid)) { showFile(sid); return; }
  if (state.view === 'entity' && !cy.$id(sid).length && n.nt !== 'resource') {
    go({ type: 'node', key: sid }, 'entity');
  }
  if (n.nt === 'resource') showResource(n); else showEntity(n);
  highlight(sid);
  if (center) { const el = cy.$id(sid); if (el.length) cy.animate({ center: { eles: el }, zoom: Math.max(cy.zoom(), 0.8) }, { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 }); }
}

function refList(list, render) { return list.length ? `<ul class="refs">${list.map(render).join('')}</ul>` : '<div class="hint">无</div>'; }
const refRow = (attrs, content) => `<li><button type="button" class="ref-row" ${attrs}>${content}</button></li>`;
function nodeRow(sid, extra = '', lineText = '') {
  const n = nodes.get(sid);
  if (!n) return '';
  const st = n.nt === 'context' ? 'context' : n.status;
  return refRow(`data-sel="${sid}"`, `${kindBadge(n.kind)}<span class="nm">${esc(nodeName(n))}</span>${pill(st)}${n.isTest ? '<span class="pill st-context">测试</span>' : ''}${extra}${lineText ? `<span class="ln">${esc(lineText)}</span>` : ''}`);
}
function reviewButtons(sid) {
  const v = store.reviewed[sid];
  return `<div class="btns"><button class="btn ${v === 'ok' ? 'on' : ''}" data-review="ok" aria-pressed="${v === 'ok'}">${icon('check')}已审阅 <span class="kbd">r</span></button><button class="btn q ${v === 'q' ? 'on' : ''}" data-review="q" aria-pressed="${v === 'q'}">${icon('circle-help')}有疑问</button>
    <button class="btn" data-focus="${sid}">${icon('network')}聚焦关系图</button></div>`;
}

function showEntity(n) {
  const isCtx = n.nt === 'context';
  const inc = (inE.get(n.sid) ?? []).filter((e) => e.et === 'ref');
  const out = (outE.get(n.sid) ?? []).filter((e) => e.et === 'ref');
  const res = (outE.get(n.sid) ?? []).filter((e) => e.et === 'res');
  const note = A.entityNotes?.[n.sid];
  const cs = changeSets.filter((c) => c.entities.includes(n.sid));
  const callersChanged = inc.filter((e) => nodes.get(e.s).nt === 'entity' && !nodes.get(e.s).isTest);
  const callersUnchanged = inc.filter((e) => nodes.get(e.s).nt === 'context' && !nodes.get(e.s).isTest);
  const tests = inc.filter((e) => nodes.get(e.s).isTest);
  const refLine = (e) => e.refs?.[0] ? `${e.refs[0].file.split('/').pop()}:${e.refs[0].line}  ${e.refs[0].text ?? ''}` : '';
  const kindsTag = (e) => { const k = e.kinds.filter((x) => x !== 'call'); return k.length ? `<span class="hint">${esc(k.join(','))}</span>` : ''; };
  const confTag = (e) => e.confidence && e.confidence !== 'high' ? `<span class="pill lv-low" title="按名字匹配，可能误报">${e.confidence === 'medium' ? '中置信' : '低置信'}</span>` : '';
  const newTag = (e) => e.status === 'added' ? '<span class="pill st-added">新调用</span>' : '';
  const sigWarn = n.signatureChanged && callersUnchanged.length && !SHAPE_KINDS.has(n.kind);

  let html = `<h2>${kindBadge(n.kind)}<span class="kindtag">${esc(KIND_LABEL[n.kind] ?? n.kind)}</span>${esc(nodeName(n))}</h2>
    <div class="meta">${pill(isCtx ? 'context' : n.status)}${n.moved && n.status !== 'moved' ? pill('moved', '已移动') : ''}${n.signatureChanged ? '<span class="pill lv-medium">签名变更</span>' : ''}
      ${n.tested === false ? '<span class="pill lv-low">无测试引用</span>' : ''}${!isCtx && (n.additions || n.deletions) ? `<span class="mono"><b style="color:var(--add)">+${n.additions}</b> <b style="color:var(--del)">−${n.deletions}</b></span>` : ''}</div>
    <div class="meta">${pathLink(n.file, n.line ?? n.old?.line)}</div>
    ${n.oldFile ? `<div class="meta">原位置 <span class="mono">${esc(n.oldFile)}${n.old?.line ? ':' + n.old.line : ''}</span></div>` : ''}
    ${n.oldName ? `<div class="meta">原名称 <code>${esc(n.oldName)}</code></div>` : ''}
    ${cs.length ? `<div class="meta">所属改动集 ${cs.map((c) => `<button type="button" class="chip" data-cs="${esc(c.id)}">${esc(c.title)}</button>`).join(' ')}</div>` : ''}
    ${note ? `<div class="note ai">${md(note).replace(/^<div class="md"><p>|<\/p><\/div>$/g, '')}</div>` : ''}
    ${isCtx ? '' : reviewButtons(n.sid)}`;
  if (n.decorators?.length) html += `<div class="meta">${n.decorators.map((d) => `<code>@${esc(d.name)}${d.args.length ? `(${esc(d.args.join(', ').slice(0, 80))})` : ''}</code>`).join(' ')}</div>`;
  if (n.signatureChanged) html += `<h3>签名变化</h3><div class="sig"><div class="o">${esc(n.old.signature)}</div><div class="n">${esc(n.signature)}</div></div>`;
  if (sigWarn) html += `<div class="warn">${icon('triangle-alert')} 签名已变，但下面有 ${callersUnchanged.length} 个调用方在本次 diff 中<b>没有被修改</b>，请确认它们仍然兼容。</div>`;

  html += `<h3>被谁使用（${inc.length}）</h3>`;
  if (!inc.length && !isCtx && !n.isTest) html += `<div class="hint">${n.status === 'deleted' ? '已删除' : n.kind === 'test' ? '' : '没有找到引用方（入口函数、框架回调、或仅通过依赖注入/反射使用）'}</div>`;
  if (callersChanged.length) html += `<div class="hint">本次也改动的调用方</div>` + refList(callersChanged, (e) => nodeRow(e.s, newTag(e) + kindsTag(e) + confTag(e), refLine(e)));
  if (callersUnchanged.length) html += `<div class="hint">未改动的调用方</div>` + refList(callersUnchanged, (e) => nodeRow(e.s, kindsTag(e) + confTag(e), refLine(e)));
  if (tests.length) html += `<div class="hint">测试</div>` + refList(tests, (e) => nodeRow(e.s, '', refLine(e)));
  if (n.importedBy?.length) html += `<div class="hint">被 ${n.importedBy.length} 个文件 import</div>`;
  if (n.formerCallers?.length) {
    html += `<h3>删除前的调用方（${n.formerCallers.length}）</h3>` + refList(n.formerCallers, (c) => refRow(`data-open="${esc(c.file)}" data-line="${c.line}"`, `${icon('braces')}<span class="nm">${esc(c.id.split('#')[1])}</span>${pill(c.callerStatus === 'unchanged' ? 'deleted' : c.callerStatus === 'file-changed' ? 'modified' : c.callerStatus, c.callerStatus === 'unchanged' ? '未修改!' : STATUS_LABEL[c.callerStatus] ?? '文件有改动')}<span class="ln">${esc(c.file)}:${c.line}  ${esc(c.text)}</span>`));
  }
  if (out.length) {
    html += `<h3>依赖 / 调用了（${out.length}）</h3>` + refList(out, (e) => nodeRow(e.t, newTag(e) + kindsTag(e), refLine(e)));
  }
  if (res.length) {
    html += `<h3>资源访问（${res.length}）</h3>` + refList(res, (e) => {
      const r = nodes.get(e.t);
      return refRow(`data-sel="${r.sid}"`, `${icon(KIND_ICON[r.kind])}<span class="nm">${esc(r.name)}</span><span class="pill st-context" style="color:var(--${OP_COLOR[e.op] ?? 'mute'})">${esc(e.op)}</span>${pill(e.status)}<span class="ln">${esc(e.refs[0]?.text ?? '')}</span>`);
    });
  }
  if (n.logs?.length) {
    html += `<h3>日志（${n.logs.length}）</h3>` + refList(n.logs, (l) => refRow(`data-open="${esc(n.status === 'deleted' ? n.oldFile ?? n.file : n.file)}" data-line="${l.line}"`, `${icon('file')}<span class="pill st-context">${esc(l.level)}</span>${pill(l.status)}<span class="nm mono">${esc(l.msg)}</span>`));
  }
  if (!isCtx) {
    if (n.hunks?.length) html += `<h3>代码改动</h3><div class="diff" tabindex="0" role="region" aria-label="代码差异">${hunksHtml(n.hunks, n.lang)}</div>`;
    else if (n.status === 'moved') html += `<h3>代码改动</h3><div class="hint">内容未变，仅从 <code>${esc(n.oldFile)}</code> 移动到当前位置</div>`;
    const f = fileByPath.get(n.file) || fileByPath.get(n.oldFile);
    if (f) html += `<div class="btns"><button class="btn" data-file="${f.id}">查看整个文件的 diff</button></div>`;
  } else {
    html += `<div class="hint" style="margin-top:12px">该函数本次未改动，因与改动代码存在调用关系而显示。</div>`;
  }
  detail.innerHTML = html;
  detail.parentElement.scrollTop = 0;
}

function showResource(r) {
  const users = r.usages ?? [];
  let html = `<h2><span class="kindtag">${icon(KIND_ICON[r.kind])} ${esc(KIND_LABEL[r.kind] ?? r.kind)}</span>${esc(r.name)}</h2><div class="meta">${pill(r.status)}</div>`;
  if (r.stillReferenced?.length) html += `<div class="warn">${icon('triangle-alert')} 该配置项已从配置文件中删除，但代码中仍有 ${r.stillReferenced.length} 处引用：${refList(r.stillReferenced, (h) => refRow(`data-open="${esc(h.file)}" data-line="${h.line}"`, `<span class="ln">${esc(h.file)}:${h.line}  ${esc(h.text)}</span>`))}</div>`;
  if (r.undeclared) html += `<div class="warn">${icon('triangle-alert')} 新读取的配置项未在任何 <code>.env*</code> 示例文件中声明。</div>`;
  if (r.defs?.length) html += `<h3>定义 / 结构变化（${r.defs.length}）</h3>` + refList(r.defs, (d) => refRow(`data-file="${d.fileId}"`, `${icon('file')}<span class="nm mono">${esc(d.op)}</span>${pill(d.status)}<span class="ln">${esc(d.file)}${d.line ? ':' + d.line : ''}</span><span class="ln" style="white-space:pre-wrap">${esc(d.text)}</span>`));
  const groups = { added: [], removed: [], unchanged: [] };
  for (const u of users) (groups[u.status] ?? groups.unchanged).push(u);
  const row = (u) => {
    const sid = idToSid.get(u.entity);
    return refRow(`data-sel="${sid}"`, `${icon('braces')}<span class="nm">${esc(nodes.get(sid)?.qname ?? u.entity)}</span><span class="pill st-context" style="color:var(--${OP_COLOR[u.op] ?? 'mute'})">${esc(u.op)}${u.detail ? ' · ' + esc(u.detail) : ''}</span><span class="ln">${esc(u.file?.split('/').pop())}:${u.line}  ${esc(u.text)}</span>`);
  };
  html += `<h3>访问方（${users.length}）</h3>`;
  if (groups.added.length) html += `<div class="hint">本次新增的访问</div>` + refList(groups.added, row);
  if (groups.removed.length) html += `<div class="hint">本次移除的访问</div>` + refList(groups.removed, row);
  if (groups.unchanged.length) html += `<div class="hint">改动代码中原有的访问</div>` + refList(groups.unchanged, row);
  html += `<div class="hint" style="margin-top:14px">资源由规则识别（按代码模式匹配），可能有遗漏或误报。</div>`;
  detail.innerHTML = html;
  detail.parentElement.scrollTop = 0;
}

function showFile(fid) {
  const f = files.get(fid);
  if (!f) return;
  const ents = f.entities.map((id) => idToSid.get(id)).filter(Boolean);
  let html = `<h2><span class="kindtag">${icon('file')}文件</span>${esc(f.path.split('/').pop())}</h2>
    <div class="meta">${pill(f.status === 'renamed' ? 'moved' : f.status, { added: '新增', modified: '修改', deleted: '删除', renamed: `重命名 ${f.similarity ?? ''}%` }[f.status])}<span class="pill st-context">${esc(f.kind)}</span>
    <span class="mono"><b style="color:var(--add)">+${f.additions}</b> <b style="color:var(--del)">−${f.deletions}</b></span></div>
    <div class="meta">${pathLink(f.path, 1)}</div>${f.oldPath ? `<div class="meta">原路径 <span class="mono">${esc(f.oldPath)}</span></div>` : ''}`;
  if (ents.length) html += `<h3>改动实体（${ents.length}）</h3>` + refList(ents, (s) => nodeRow(s, (() => { const n = nodes.get(s); return n.signatureChanged ? '<span class="pill lv-medium">签名</span>' : ''; })()));
  const res = F.resources.filter((r) => r.defs.some((d) => d.fileId === fid));
  if (res.length) html += `<h3>涉及资源</h3>` + refList(res, (r) => refRow(`data-sel="${r.sid}"`, `${icon(KIND_ICON[r.kind])}<span class="nm">${esc(r.name)}</span>${pill(r.status)}`));
  html += `<h3>Diff</h3>`;
  if (f.binary) html += '<div class="hint">二进制文件</div>';
  else if (!f.patch) html += `<div class="hint">${f.kind === 'lock' ? '锁文件，已省略' : f.status === 'renamed' ? '内容未变' : '无文本改动'}</div>`;
  else html += `<div class="diff" tabindex="0" role="region" aria-label="文件差异">${hunksHtml(parsePatch(f.patch), f.lang)}</div>${f.truncated ? '<div class="hint">diff 过长已截断</div>' : ''}`;
  detail.innerHTML = html;
  detail.parentElement.scrollTop = 0;
}

function showContextFile(path) {
  detail.innerHTML = `<h2><span class="kindtag">${icon('file')}文件</span>${esc(path.split('/').pop())}</h2><div class="meta">${pill('context')}</div><div class="meta">${pathLink(path, 1)}</div><div class="hint">该文件本次未改动。</div>`;
}

function showModule(m) {
  const fs = F.files.filter((f) => f.module === m);
  const ents = F.entities.filter((e) => e.module === m && !e.isTest);
  detail.innerHTML = `<h2><span class="kindtag">${icon('layers')}模块</span>${esc(m)}</h2>
    <div class="btns"><button class="btn" data-go-module="${esc(m)}">展开到实体视图 ${icon('arrow-right')}</button></div>
    <h3>文件（${fs.length}）</h3>${refList(fs, (f) => refRow(`data-file="${f.id}"`, `${icon('file')}<span class="nm">${esc(f.path.split('/').slice(-2).join('/'))}</span>${pill(f.status === 'renamed' ? 'moved' : f.status)}<span class="hint">+${f.additions} −${f.deletions}</span>`))}
    <h3>改动实体（${ents.length}）</h3>${refList(ents.slice(0, 200), (e) => nodeRow(e.sid))}`;
  detail.parentElement.scrollTop = 0;
}

function showEdge(e) {
  const a = nodes.get(e.s); const b = nodes.get(e.t);
  let html = `<h2>${esc(nodeName(a))} ${icon('arrow-right')} ${esc(nodeName(b))}</h2><div class="meta">${pill(e.status === 'added' ? 'added' : e.status === 'removed' ? 'removed' : 'context', e.status === 'added' ? '本次新增' : e.status === 'removed' ? '本次移除' : '已有')}
    <span class="pill st-context">${esc(e.et === 'res' ? e.op : e.kinds.join(', '))}</span></div>
    <ul class="refs">${nodeRow(e.s)}${nodeRow(e.t)}</ul><h3>出现位置</h3>` +
    refList(e.refs ?? [], (r) => refRow(`data-open="${esc(r.file)}" data-line="${r.line}"`, `<span class="ln">${esc(r.file)}:${r.line}  ${esc(r.text ?? '')}</span>`));
  detail.innerHTML = html;
}

function showChangeSet(id) {
  const cs = csById.get(id);
  if (!cs) return;
  const order = cs.reviewOrder?.length ? [...cs.reviewOrder, ...cs.entities.filter((s) => !cs.reviewOrder.includes(s))] : cs.entities;
  let html = `<h2>${esc(cs.title)}</h2><div class="meta">${cs.risk ? `<span class="pill lv-${esc(cs.risk)}">风险 ${esc(cs.risk)}</span>` : ''}${cs.auto ? '<span class="pill st-context">自动分组</span>' : ''}<span>${cs.entities.length} 个实体</span></div>`;
  if (cs.summary) html += `<div class="note ${cs.auto ? '' : 'ai'}">${md(cs.summary).replace(/^<div class="md"><p>|<\/p><\/div>$/g, '')}</div>`;
  if (cs.why) html += `<h3>为什么这样改</h3>${md(cs.why)}`;
  if (cs.reviewHint) html += `<h3>审阅重点</h3>${md(cs.reviewHint)}`;
  html += `<h3>建议阅读顺序 <span class="hint" style="text-transform:none">（<span class="kbd">j</span>/<span class="kbd">k</span> 逐个查看）</span></h3>` +
    refList(order, (s) => nodeRow(s, store.reviewed[s] === 'ok' ? icon('check') : store.reviewed[s] === 'q' ? icon('circle-help') : '', A.entityNotes?.[s] ?? ''));
  if (cs.files?.length) html += `<h3>相关文件</h3>` + refList(cs.files, (fid) => { const f = files.get(fid); return f ? refRow(`data-file="${fid}"`, `${icon('file')}<span class="nm">${esc(f.path)}</span>${pill(f.status === 'renamed' ? 'moved' : f.status)}`) : ''; });
  if (cs.resources?.length) html += `<h3>相关资源</h3>` + refList(cs.resources, (r) => nodeRow(r));
  detail.innerHTML = html;
  detail.parentElement.scrollTop = 0;
  state.csCursor = { id, order, i: -1 };
}

function showRisk(r) {
  detail.innerHTML = `<h2>${esc(r.title)}</h2><div class="meta"><span class="pill lv-${r.level}">${r.level}</span><span class="src">来源：${r.src}${r.rule ? ' · ' + esc(r.rule) : ''}</span></div>
    ${r.detail ? `<div class="sig">${esc(r.detail)}</div>` : ''}
    ${r.entities?.length ? `<h3>相关节点</h3>` + refList(r.entities.filter((s) => nodes.has(s)), (s) => nodeRow(s)) : ''}
    ${r.refs?.length ? `<h3>位置</h3>` + refList(r.refs, (x) => refRow(`data-open="${esc(x.file)}" data-line="${x.line ?? ''}"`, `<span class="ln">${esc(x.file)}${x.line ? ':' + x.line : ''}  ${esc(x.text ?? '')}</span>`)) : ''}`;
}

function showOverview() {
  const s = F.stats;
  const es = s.entitiesByStatus;
  let html = `<h2>${esc(A.title || '改动总览')}</h2><div class="meta"><span class="mono">${esc(F.meta.range.label)}</span></div>`;
  if (A.summary) html += `<div class="note ai">AI 摘要</div>${md(A.summary)}`;
  else html += `<div class="note">还没有 AI 分析。让 Claude 读取 <code>digest.md</code> 并生成 <code>analysis.json</code> 后重新 render，即可得到改动意图、改动集分组和审阅顺序。</div>`;
  html += `<div class="grid"><div><b>${s.files}</b><span>文件</span></div><div><b style="color:var(--add)">+${s.additions}</b><span>新增行</span></div><div><b style="color:var(--del)">−${s.deletions}</b><span>删除行</span></div><div><b>${F.resources.length}</b><span>资源</span></div>
    <div><b>${es.added ?? 0}</b><span>新增实体</span></div><div><b>${es.modified ?? 0}</b><span>修改实体</span></div><div><b>${es.deleted ?? 0}</b><span>删除实体</span></div><div><b>${(es.moved ?? 0) + (es.renamed ?? 0)}</b><span>移动/重命名</span></div></div>`;
  const top = risks.filter((r) => r.level !== 'low').slice(0, 8);
  if (top.length) html += `<h3>重点风险</h3>` + top.map((r) => `<button type="button" class="risk" data-risk-ov="${risks.indexOf(r)}"><span class="pill lv-${r.level}">${r.level}</span> ${esc(r.title)} <span class="src">${r.src}</span></button>`).join('');
  if (A.changeSets?.length) html += `<h3>审阅路径</h3>` + changeSets.map((c, i) => `<button type="button" class="risk" data-cs="${esc(c.id)}"><b>${i + 1}.</b> ${esc(c.title)} <span class="hint">${c.entities.length} 实体</span></button>`).join('');
  if (F.meta.commits?.length) html += `<h3>提交（${F.meta.commits.length}）</h3><div class="commits">${F.meta.commits.map((c) => `<div><code>${esc(c.sha)}</code>${esc(c.subject)}</div>`).join('')}</div>`;
  html += `<h3>操作</h3><div class="hint">单击节点查看详情 · 双击节点聚焦其关系 · 双击模块展开 · <span class="kbd">/</span> 搜索 · <span class="kbd">j</span>/<span class="kbd">k</span> 在改动集内切换 · <span class="kbd">r</span> 标记已审阅 · <span class="kbd">Esc</span> 取消选择</div>
    <div class="hint" style="margin-top:6px">生成于 ${esc(F.meta.generatedAt)} · 耗时 ${s.elapsedSec?.toFixed?.(1)}s${F.meta.ts ? ` · TS 引用分析 ${F.meta.ts.files} 个文件` : ''}</div>`;
  detail.innerHTML = html;
}

detail.onclick = (ev) => {
  const t = ev.target;
  const rv = t.closest('[data-review]');
  if (rv && state.selected) { toggleReview(state.selected, rv.dataset.review); return; }
  const fo = t.closest('[data-focus]');
  if (fo) { go({ type: 'node', key: fo.dataset.focus }, 'entity'); return; }
  const gm = t.closest('[data-go-module]');
  if (gm) { go({ type: 'module', key: gm.dataset.goModule }, 'entity'); return; }
  const op = t.closest('[data-open]');
  if (op && !t.closest('[data-sel]')) { const href = openHref(op.dataset.open, op.dataset.line); if (href) location.href = href; return; }
  const c = t.closest('[data-cs]');
  if (c) { go({ type: 'cs', key: c.dataset.cs }, 'entity'); showChangeSet(c.dataset.cs); return; }
  const ro = t.closest('[data-risk-ov]');
  if (ro) { const r = risks[+ro.dataset.riskOv]; const ents = (r.entities ?? []).filter((s) => nodes.has(s)); if (ents.length) go({ type: 'set', key: ents, label: r.title }, 'entity'); showRisk(r); return; }
  const s = t.closest('[data-sel]');
  if (s) { select(s.dataset.sel, true); return; }
  const f = t.closest('[data-file]');
  if (f) showFile(f.dataset.file);
};

function toggleReview(sid, v) {
  const focusedReview = document.activeElement?.dataset.review;
  store.reviewed[sid] = store.reviewed[sid] === v ? undefined : v;
  if (!store.reviewed[sid]) delete store.reviewed[sid];
  save();
  updateProgress();
  const n = nodes.get(sid);
  const el = cy.$id(sid);
  if (el.length && n && n.nt === 'entity' && !el.isParent()) {
    const c = entityCard(n, Boolean(n.parent));
    el.data({ label: c.label, img: c.img, w: c.w, mx: c.mx, reviewed: store.reviewed[sid] === 'ok' ? 1 : 0 });
  }
  if (n) showEntity(n);
  if (focusedReview) [...detail.querySelectorAll('[data-review]')].find((button) => button.dataset.review === focusedReview)?.focus({ preventScroll: true });
  if (leftTab === 'sets') renderLeft();
}

// ---------------------------------------------------------------- toolbar & keys
for (const menu of document.querySelectorAll('.opts')) {
  menu.addEventListener('toggle', () => {
    if (!menu.open) return;
    document.querySelectorAll('.opts[open]').forEach((other) => { if (other !== menu) other.open = false; });
    const box = menu.querySelector('.optsbox');
    box.style.transform = '';
    box.style.top = '';
    box.style.bottom = '';
    const rect = box.getBoundingClientRect();
    const shift = rect.left < 8 ? 8 - rect.left : rect.right > innerWidth - 8 ? innerWidth - 8 - rect.right : 0;
    box.style.transform = `translateX(${shift}px)`;
    // A wrapped toolbar can put a menu against either viewport edge.
    if (rect.bottom > innerHeight - 8 && rect.top > rect.height + 8) {
      box.style.top = 'auto';
      box.style.bottom = 'calc(100% + 4px)';
    }
  });
}
document.addEventListener('click', (event) => {
  // Filter clicks replace their button; the original event path still contains its menu.
  document.querySelectorAll('.opts[open]').forEach((menu) => { if (!event.composedPath().includes(menu)) menu.open = false; });
});
window.addEventListener('resize', () => document.querySelectorAll('.opts[open]').forEach((menu) => { menu.open = false; }));
$('#viewSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b && b.dataset.view !== state.view) { state.view = b.dataset.view; redraw(); } };
$('#fit').onclick = () => cy.fit(undefined, 30);
const bindOpt = (id, key, conv = (el) => el.checked) => { const el = $(id); el.onchange = () => { state.opt[key] = conv(el); redraw(); }; };
bindOpt('#optContext', 'context'); bindOpt('#optRes', 'res'); bindOpt('#optTests', 'tests'); bindOpt('#optMoves', 'moves'); bindOpt('#optTypes', 'types');
bindOpt('#optDepth', 'depth', (el) => +el.value);

const search = $('#search');
let searchTimer;
search.oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = search.value.trim().toLowerCase();
    cy.nodes().removeClass('match');
    if (!q) return;
    const hits = [...nodes.values()].filter((n) => (nodeName(n) ?? '').toLowerCase().includes(q) || (n.file ?? '').toLowerCase().includes(q)).map((n) => n.sid);
    cy.nodes().filter((n) => hits.includes(n.id())).addClass('match');
  }, 150);
};
search.onkeydown = (ev) => {
  if (ev.key === 'Enter') {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const hits = [...nodes.values()].filter((n) => (nodeName(n) ?? '').toLowerCase().includes(q) || (n.file ?? '').toLowerCase().includes(q)).map((n) => n.sid).slice(0, 150);
    if (hits.length === 1) select(hits[0], true);
    else if (hits.length) go({ type: 'search', key: hits, label: search.value.trim() }, 'entity');
    search.blur();
  } else if (ev.key === 'Escape') { search.value = ''; search.oninput(); search.blur(); }
};
document.addEventListener('keydown', (ev) => {
  const menu = document.querySelector('.opts[open]');
  if (ev.key === 'Escape' && menu) { ev.preventDefault(); menu.open = false; menu.querySelector('summary').focus(); return; }
  if (ev.target.matches('input, textarea, select')) return;
  if (ev.key === '/') { ev.preventDefault(); search.focus(); }
  else if (ev.key === 'Escape') { state.selected = null; cy.elements().removeClass('faded hl'); showOverview(); }
  else if (ev.key === 'r' && state.selected && nodes.get(state.selected)?.nt === 'entity') toggleReview(state.selected, 'ok');
  else if ((ev.key === 'j' || ev.key === 'k') && state.csCursor) {
    const c = state.csCursor;
    c.i = Math.max(0, Math.min(c.order.length - 1, c.i + (ev.key === 'j' ? 1 : -1)));
    select(c.order[c.i], true);
  }
});

// Keep a usable graph area; arrow keys resize and Home restores defaults.
(() => {
  const bind = (sp, panel, other, key, dir, min, maxFrac) => {
    const maxWidth = () => Math.max(min, Math.min(window.innerWidth * maxFrac, window.innerWidth - other.offsetWidth - 260));
    const sync = () => {
      sp.setAttribute('aria-valuemin', min);
      sp.setAttribute('aria-valuemax', Math.round(maxWidth()));
      sp.setAttribute('aria-valuenow', panel.offsetWidth);
      cy.resize();
    };
    const resize = (width) => { panel.style.width = Math.max(min, Math.min(maxWidth(), width)) + 'px'; sync(); };
    const reset = () => { panel.style.width = ''; storage.removeItem(key); sync(); };
    const saved = Number(storage.getItem(key));
    if (Number.isFinite(saved) && saved > 0) resize(saved);
    else sync();
    sp.onmousedown = (ev) => {
      ev.preventDefault();
      const x0 = ev.clientX; const w0 = panel.offsetWidth;
      document.body.classList.add('resizing');
      const move = (e) => resize(w0 + dir * (e.clientX - x0));
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', () => {
        document.removeEventListener('mousemove', move);
        document.body.classList.remove('resizing');
        storage.setItem(key, panel.offsetWidth);
        sync();
      }, { once: true });
    };
    sp.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') reset();
      else { resize(panel.offsetWidth + dir * (event.key === 'ArrowRight' ? 20 : -20)); storage.setItem(key, panel.offsetWidth); }
    };
    sp.ondblclick = reset;
    window.addEventListener('resize', () => {
      if (window.innerWidth > 800 && panel.style.width) resize(panel.offsetWidth);
      else sync();
    });
  };
  bind($('#lsplitter'), $('#left'), $('#right'), 'patchvista:leftWidth', 1, 200, 0.45);
  bind($('#splitter'), $('#right'), $('#left'), 'patchvista:rightWidth', -1, 320, 0.7);
})();

// ---------------------------------------------------------------- boot
updateProgress();
syncTypeFilterUi();
renderLeft();
showOverview();
redraw();
})();
