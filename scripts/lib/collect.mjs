import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { changedFiles, filePatch, readSide, listFiles, checkoutTree, resolveRange, repoRoot, tryGit } from './git.mjs';
import { langOf, fileKind, moduleOf } from './classify.mjs';
import { extract, diffFileEntities, detectMoves, toEntity, moduleEntity } from './entities.mjs';
import { initSitter } from './extract-sitter.mjs';
import { createService, incomingRefs, outgoingCalls } from './refs-ts.mjs';
import { incomingRefsSitter } from './refs-sitter.mjs';
import { detectCodeResources, detectFileResources } from './detect.mjs';

const MAX_PATCH_LINES = 4000;
const log = (...a) => console.error('[patchvista]', ...a);

function addedLineSet(e) {
  const set = new Set();
  for (const h of e.hunks ?? []) {
    let n = h.newStart;
    for (const l of h.lines) {
      if (l[0] === '+') set.add(n);
      if (l[0] !== '-') n++;
    }
  }
  return set;
}

function gitGrepWords(dir, words, globs = []) {
  if (!words.length) return [];
  const args = ['-C', dir, 'grep', '-n', '-w', '-F', '-I', '--untracked'];
  for (const w of words) args.push('-e', w);
  if (globs.length) args.push('--', ...globs);
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)
      .map((l) => { const m = l.match(/^([^:]+):(\d+):(.*)$/); return m && { file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 160) }; })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function collect(opts) {
  const t0 = Date.now();
  const repo = repoRoot(opts.repo ?? process.cwd());
  const range = resolveRange(repo, opts);
  log(`repo ${repo}  range ${range.label}`);
  await initSitter();

  // ---------- files & entities ----------
  const rawFiles = changedFiles(repo, range);
  const files = [];
  let changes = [];
  const moduleEnts = [];
  const fileTexts = new Map();
  for (const f of rawFiles) {
    const kind = fileKind(f.path);
    const lang = langOf(f.path);
    const fullPatch = f.binary || kind === 'lock' ? '' : filePatch(repo, range, f);
    let patch = fullPatch;
    let truncated = false;
    const pl = patch.split('\n');
    if (pl.length > MAX_PATCH_LINES) { patch = pl.slice(0, MAX_PATCH_LINES).join('\n'); truncated = true; }
    const file = {
      id: `f${files.length + 1}`,
      path: f.path, oldPath: f.oldPath !== f.path ? f.oldPath : null,
      status: { A: 'added', D: 'deleted', M: 'modified', R: 'renamed', C: 'copied', T: 'modified' }[f.status] ?? 'modified',
      similarity: f.similarity ?? null,
      kind, lang, module: moduleOf(f.path),
      additions: f.additions, deletions: f.deletions, binary: f.binary,
      patch, truncated, entities: [],
    };
    files.push(file);

    const needText = lang || kind === 'config' || kind === 'sql' || kind === 'schema' || kind === 'deps';
    if (!needText || f.binary) continue;
    const oldText = f.status === 'A' ? null : readSide(repo, range.old.sha, f.oldPath);
    const newText = f.status === 'D' ? null : readSide(repo, range.new.sha, f.path);
    fileTexts.set(f.path, { oldText, newText });
    if (!lang) continue;
    const isTest = kind === 'test';
    const oldEnts = extract(lang, f.oldPath ?? f.path, oldText, isTest);
    const newEnts = extract(lang, f.path, newText, isTest);
    const res = diffFileEntities({ path: f.status === 'D' ? null : f.path, oldPath: f.oldPath }, oldEnts, newEnts);
    for (const c of res.changes) { c.lang = lang; c.fileKind = kind; }
    changes.push(...res.changes);
    const mod = moduleEntity(file, fullPatch, oldEnts, newEnts, oldText, newText);
    if (mod) moduleEnts.push({ ...mod, lang, isTest });
  }
  changes = detectMoves(changes);
  const entities = [...changes.map((c) => toEntity(c, c.lang, c.fileKind)), ...moduleEnts];
  // dedupe ids (overloads)
  const ids = new Set();
  for (const e of entities) {
    let id = e.id;
    let i = 1;
    while (ids.has(id)) id = `${e.id}~${++i}`;
    e.id = id;
    ids.add(id);
  }
  const byId = new Map(entities.map((e) => [e.id, e]));
  const fileByPath = new Map(files.map((f) => [f.path, f]));
  const fileByOld = new Map(files.filter((f) => f.oldPath).map((f) => [f.oldPath, f]));
  for (const e of entities) (fileByPath.get(e.file) ?? fileByOld.get(e.file) ?? fileByPath.get(e.oldFile))?.entities.push(e.id);
  log(`${files.length} files, ${entities.length} changed entities`);

  // ---------- references ----------
  const contexts = new Map();
  const edges = new Map();
  const addEdge = (from, to, kind, ref, extra = {}) => {
    const key = `${from}→${to}`;
    if (!edges.has(key)) edges.set(key, { from, to, kinds: new Set(), refs: [], status: 'existing', confidence: extra.confidence ?? 'high' });
    const ed = edges.get(key);
    ed.kinds.add(kind);
    if (ed.refs.length < 20) ed.refs.push({ file: ref.file, line: ref.line, text: ref.text ?? '' });
    if (extra.status === 'added') ed.status = 'added';
    if (extra.confidence === 'high') ed.confidence = 'high';
  };
  const ensureNode = (enc) => {
    if (byId.has(enc.id)) return enc.id;
    if (!contexts.has(enc.id)) {
      contexts.set(enc.id, {
        id: enc.id, kind: enc.kind, name: enc.name, qname: enc.qname, parent: enc.parent, file: enc.file, line: enc.line,
        status: 'context', isTest: fileKind(enc.file) === 'test' || enc.kind === 'test', lang: langOf(enc.file),
      });
    }
    return enc.id;
  };
  const addedLinesCache = new Map();
  const isAddedLine = (entityId, line) => {
    const e = byId.get(entityId);
    if (!e) return false;
    if (e.status === 'added') return true;
    if (!addedLinesCache.has(entityId)) addedLinesCache.set(entityId, addedLineSet(e));
    return addedLinesCache.get(entityId).has(line);
  };
  const importedBy = new Map();
  const handleIncoming = ({ target, ref, confidence }) => {
    if (ref.kind === 'import') {
      if (!importedBy.has(target)) importedBy.set(target, new Set());
      importedBy.get(target).add(ref.file);
      return;
    }
    const from = ensureNode(ref.enclosing);
    addEdge(from, target, ref.kind, ref, { status: isAddedLine(from, ref.line) ? 'added' : 'existing', confidence: confidence ?? 'high' });
  };

  const tsTargets = entities.filter((e) => (e.lang === 'ts' || e.lang === 'js') && e.status !== 'deleted' && e.kind !== 'test' && e.namePos != null);
  const sitterTargets = entities.filter((e) => (e.lang === 'go' || e.lang === 'py') && e.status !== 'deleted' && e.kind !== 'module');
  const deletedTargets = entities.filter((e) => e.status === 'deleted' && !e.isTest && e.old?.namePos != null);
  let tsInfo = null;
  if (opts.refs !== false && (tsTargets.length || sitterTargets.length)) {
    const head = checkoutTree(repo, range.new.sha);
    try {
      if (tsTargets.length) {
        const t1 = Date.now();
        const svc = createService(head.dir, listFiles(repo, range.new.sha), tsTargets.map((e) => e.file));
        tsInfo = { tsconfig: svc.tsconfig, files: svc.fileCount };
        log(`TS language service: ${svc.fileCount} files (tsconfig: ${svc.tsconfig ?? 'none'})`);
        incomingRefs(svc, tsTargets).forEach(handleIncoming);
        for (const o of outgoingCalls(svc, entities.filter((e) => e.lang === 'ts' || e.lang === 'js'))) {
          const to = ensureNode(o.target);
          addEdge(o.source, to, o.kind, { file: byId.get(o.source).file, line: o.line, text: '' }, { status: 'added' });
        }
        log(`TS refs done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
      }
      if (sitterTargets.length) incomingRefsSitter(head.dir, sitterTargets).forEach(handleIncoming);
    } finally {
      head.cleanup();
    }
  }
  // callers of deleted entities, from the old tree
  const formerCallers = new Map();
  if (opts.refs !== false && deletedTargets.some((e) => e.lang === 'ts' || e.lang === 'js')) {
    const base = checkoutTree(repo, range.old.sha);
    try {
      const svc = createService(base.dir, listFiles(repo, range.old.sha), deletedTargets.map((e) => e.file));
      const shim = deletedTargets.filter((e) => e.lang === 'ts' || e.lang === 'js').map((e) => ({ ...e, namePos: e.old.namePos }));
      for (const { target, ref } of incomingRefs(svc, shim)) {
        if (ref.kind === 'import') continue;
        if (!formerCallers.has(target)) formerCallers.set(target, new Map());
        formerCallers.get(target).set(ref.enclosing.id, { id: ref.enclosing.id, file: ref.file, line: ref.line, text: ref.text });
      }
    } finally {
      base.cleanup();
    }
  }

  // ---------- resources ----------
  const resources = detectCodeResources(entities);
  const fileRes = [];
  for (const f of files) {
    if (!['config', 'sql', 'schema', 'deps'].includes(f.kind)) continue;
    const t = fileTexts.get(f.path) ?? {};
    for (const r of detectFileResources(f, f.patch, t.oldText, t.newText)) fileRes.push({ ...r, fileId: f.id });
  }
  for (const r of fileRes) {
    if (!resources.has(r.id)) resources.set(r.id, { id: r.id, kind: r.kind, name: r.name, usages: [], defs: [] });
    resources.get(r.id).defs.push({ file: r.file, fileId: r.fileId, line: r.line, op: r.op, status: r.status, text: r.text });
  }

  // ---------- assemble ----------
  const ctxList = [...contexts.values()];
  const edgeList = [...edges.values()].map((e) => ({ ...e, kinds: [...e.kinds] }));
  for (const e of entities) {
    e.importedBy = [...(importedBy.get(e.id) ?? [])];
    const fc = formerCallers.get(e.id);
    if (fc) {
      e.formerCallers = [...fc.values()].map((c) => {
        const callerFile = fileByOld.get(c.file) ?? fileByPath.get(c.file);
        const changed = entities.find((x) => x.id === c.id || (x.old && `${x.oldFile ?? x.file}#${x.oldName ?? x.qname}` === c.id));
        return { ...c, callerStatus: changed ? changed.status : callerFile ? 'file-changed' : 'unchanged' };
      });
    }
  }
  const resList = [...resources.values()].map((r) => {
    const statuses = [...r.usages, ...r.defs].map((u) => u.status);
    const status = statuses.every((s) => s === 'added') ? 'added'
      : statuses.every((s) => s === 'removed') ? 'removed'
      : statuses.some((s) => s !== 'unchanged') ? 'modified' : 'unchanged';
    return { ...r, status };
  });

  // config keys removed from env/config files but still referenced in code (head)
  const removedKeys = resList.filter((r) => r.kind === 'config' && r.defs.some((d) => d.status === 'removed') && !r.defs.some((d) => d.status === 'added' || d.status === 'modified'));
  if (removedKeys.length) {
    const grepDir = range.new.sha ? null : repo;
    const hits = grepDir ? gitGrepWords(grepDir, removedKeys.map((r) => r.name)) : treeGrep(repo, range.new.sha, removedKeys.map((r) => r.name));
    for (const r of removedKeys) r.stillReferenced = hits.filter((h) => h.text.includes(r.name) && !/\.(md|example)$|^\.env/.test(h.file) && !/(^|\/)\.env/.test(h.file)).slice(0, 20);
  }
  // config keys newly read in code but not declared in any env example
  const envFiles = listFiles(repo, range.new.sha).filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.local$/.test(f));
  if (envFiles.length) {
    const declared = new Set();
    for (const f of envFiles) for (const m of (readSide(repo, range.new.sha, f) ?? '').matchAll(/^\s*#?\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/gm)) declared.add(m[1]);
    for (const r of resList) {
      if (r.kind === 'config' && /^[A-Z_][A-Z0-9_]*$/.test(r.name) && r.usages.some((u) => u.status === 'added') && !declared.has(r.name)) r.undeclared = true;
    }
  }

  // ---------- short ids ----------
  entities.forEach((e, i) => { e.sid = `e${i + 1}`; });
  ctxList.forEach((c, i) => { c.sid = `c${i + 1}`; });
  resList.forEach((r, i) => { r.sid = `r${i + 1}`; });

  const risks = heuristicRisks({ entities, ctxList, edgeList, resList, files, byId });

  for (const e of entities) { delete e._text; delete e._oldText; delete e._lineBase; }

  const stats = {
    files: files.length,
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    filesByKind: countBy(files, 'kind'),
    filesByStatus: countBy(files, 'status'),
    entitiesByStatus: countBy(entities, 'status'),
    entitiesByKind: countBy(entities, 'kind'),
    contextNodes: ctxList.length,
    edges: edgeList.length,
    resources: resList.length,
    elapsedSec: (Date.now() - t0) / 1000,
  };
  const repoName = path.basename(repo);
  return {
    version: 1,
    meta: {
      repo, repoName, range, generatedAt: new Date().toISOString(), ts: tsInfo,
      headSubject: range.new.sha ? tryGit(repo, ['log', '-1', '--format=%s', range.new.sha])?.trim() : null,
      commits: range.new.sha ? (tryGit(repo, ['log', '--format=%h%x09%an%x09%s', `${range.old.sha}..${range.new.sha}`]) ?? '').split('\n').filter(Boolean).slice(0, 200)
        .map((l) => { const [sha, author, subject] = l.split('\t'); return { sha, author, subject }; }) : [],
    },
    stats, files, entities, contexts: ctxList, edges: edgeList, resources: resList, risks,
  };
}

function treeGrep(repo, sha, words) {
  const args = ['-C', repo, 'grep', '-n', '-w', '-F', '-I'];
  for (const w of words) args.push('-e', w);
  args.push(sha);
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)
      .map((l) => { const m = l.match(/^[^:]+:([^:]+):(\d+):(.*)$/); return m && { file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 160) }; })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const countBy = (list, k) => list.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {});

function heuristicRisks({ entities, ctxList, edgeList, resList, files, byId }) {
  const risks = [];
  const ctxById = new Map(ctxList.map((c) => [c.id, c]));
  const incoming = new Map();
  for (const ed of edgeList) {
    if (!incoming.has(ed.to)) incoming.set(ed.to, []);
    incoming.get(ed.to).push(ed);
  }
  // title/detail are Chinese fallbacks (also read by digest/AI); `params` lets the report re-render them in any language.
  const push = (level, rule, title, detail, ents = [], refs = [], params = {}) => risks.push({ level, rule, title, detail, entities: ents, refs, params });

  for (const e of entities) {
    if (e.isTest) continue;
    const inc = incoming.get(e.id) ?? [];
    // a context class whose members changed in this diff isn't really "unchanged"
    const membersChanged = (c) => c.kind === 'class' && entities.some((x) => x.file === c.file && x.parent === c.name && x.status !== 'moved');
    const unchanged = inc.filter((ed) => ctxById.has(ed.from) && !ctxById.get(ed.from).isTest && !membersChanged(ctxById.get(ed.from)));
    const isShape = ['interface', 'type', 'class', 'enum'].includes(e.kind);
    // functions: callers matter; shapes: implementers/extenders matter, plain type refs are informational
    const affected = unchanged.filter((ed) => isShape
      ? ed.kinds.some((k) => k === 'implements' || k === 'extends')
      : ed.kinds.some((k) => k === 'call' || k === 'new' || k === 'ref' || k === 'decorator'));
    if (e.signatureChanged && affected.length) {
      const what = isShape ? '实现/继承方' : '调用方';
      push(isShape ? 'medium' : 'high', 'signature-unchanged-callers', `${e.qname} ${isShape ? '结构' : '签名'}变更，${affected.length} 个${what}未修改`,
        `旧: ${e.old.signature}\n新: ${e.signature}`, [e.sid, ...affected.map((ed) => ctxById.get(ed.from).sid)],
        affected.flatMap((ed) => ed.refs.slice(0, 1)),
        { q: e.qname, shape: isShape, n: affected.length, old: e.old.signature, new: e.signature });
    } else if (e.signatureChanged && isShape && unchanged.length >= 3) {
      push('low', 'shape-type-refs', `${e.qname} 结构变更，被 ${unchanged.length} 处未修改代码作为类型引用`,
        `旧: ${e.old.signature.slice(0, 300)}\n新: ${e.signature.slice(0, 300)}`, [e.sid, ...unchanged.map((ed) => ctxById.get(ed.from).sid)],
        unchanged.flatMap((ed) => ed.refs.slice(0, 1)),
        { q: e.qname, n: unchanged.length, old: e.old.signature.slice(0, 300), new: e.signature.slice(0, 300) });
    }
    if (e.status === 'deleted' && e.formerCallers?.some((c) => c.callerStatus === 'unchanged')) {
      const dang = e.formerCallers.filter((c) => c.callerStatus === 'unchanged');
      push('high', 'deleted-with-callers', `删除了 ${e.qname}，但原调用方未修改`, dang.map((c) => `${c.file}:${c.line}`).join('\n'), [e.sid], dang, { q: e.qname });
    }
    const lines = e.additions + e.deletions;
    if (lines >= 120 && e.kind !== 'class') push('medium', 'large-change', `${e.qname} 改动量大（+${e.additions} −${e.deletions}）`, '建议重点审阅', [e.sid], [{ file: e.file, line: e.line }], { q: e.qname, add: e.additions, del: e.deletions });
    if (['added', 'modified'].includes(e.status) && e.bodyChanged && ['function', 'method'].includes(e.kind) && e.exported !== false && e.name !== 'constructor') {
      const tested = inc.some((ed) => (ctxById.get(ed.from)?.isTest) || byId.get(ed.from)?.isTest);
      e.tested = tested;
    }
  }
  for (const r of resList) {
    if (r.stillReferenced?.length) push('high', 'config-removed-still-used', `配置项 ${r.name} 已从配置文件删除，代码中仍有引用`, r.stillReferenced.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n'), [r.sid], r.stillReferenced, { name: r.name });
    if (r.undeclared) push('medium', 'config-undeclared', `新读取的配置项 ${r.name} 未在 .env 示例中声明`, '部署环境可能缺少该变量', [r.sid], r.usages.filter((u) => u.status === 'added'), { name: r.name });
    if (r.kind === 'db' && r.defs.some((d) => /ddl:(drop|alter)/.test(d.op))) push('high', 'ddl', `数据库结构变更：${r.name}`, r.defs.map((d) => d.text).join('\n'), [r.sid], r.defs, { name: r.name, create: false });
    else if (r.kind === 'db' && r.defs.some((d) => d.op === 'ddl:create')) push('medium', 'ddl', `新建表：${r.name}`, r.defs.map((d) => d.text).join('\n'), [r.sid], r.defs, { name: r.name, create: true });
    if (r.kind === 'dep' && r.status !== 'unchanged') push(r.status === 'added' ? 'medium' : 'low', 'dependency', `依赖${{ added: '新增', removed: '移除', modified: '升级' }[r.status] ?? '变更'}：${r.name}`, r.defs.map((d) => d.text).join('\n'), [r.sid], r.defs, { name: r.name, status: r.status });
  }
  const untested = entities.filter((e) => e.tested === false);
  if (untested.length) push('low', 'untested', `${untested.length} 个新增/修改的函数没有测试直接引用`, untested.slice(0, 30).map((e) => e.qname).join(', '), untested.map((e) => e.sid), [], { n: untested.length });
  for (const f of files) if (f.truncated) push('low', 'truncated', `${f.path} diff 过大已截断`, '', [], [{ file: f.path, line: 1 }], { path: f.path });
  const order = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => order[a.level] - order[b.level]);
}
