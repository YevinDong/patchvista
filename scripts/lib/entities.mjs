import { structuredPatch, diffLines } from 'diff';
import { extractTs } from './extract-ts.mjs';
import { extractGo, extractPy } from './extract-sitter.mjs';

export function extract(lang, file, text, isTest) {
  if (text == null) return [];
  try {
    if (lang === 'ts' || lang === 'js') return extractTs(file, text, { isTest });
    if (lang === 'go') return extractGo(file, text);
    if (lang === 'py') return extractPy(file, text, { isTest });
  } catch (e) {
    console.warn(`[patchvista] parse failed for ${file}: ${e.message}`);
  }
  return [];
}

const normBody = (e) => (e.kind === 'class' ? e.header : e.text).replace(/[ \t]+$/gm, '').replace(/\n\s*\n/g, '\n').trim();
const stripName = (e) => normBody(e).split(e.name).join('§');

export function similarity(a, b) {
  if (a === b) return 1;
  let same = 0;
  let total = 0;
  for (const part of diffLines(a, b)) {
    total += part.count;
    if (!part.added && !part.removed) same += part.count * 2;
  }
  const denom = a.split('\n').length + b.split('\n').length;
  return denom ? Math.min(1, same / denom) : 0;
}

function entityPatch(oldE, newE) {
  const a = oldE ? oldE.text + '\n' : '';
  const b = newE ? newE.text + '\n' : '';
  const p = structuredPatch('a', 'b', a, b, '', '', { context: 3 });
  let additions = 0;
  let deletions = 0;
  const oOff = (oldE?.line ?? 1) - 1;
  const nOff = (newE?.line ?? 1) - 1;
  const hunks = p.hunks.map((h) => {
    for (const l of h.lines) {
      if (l[0] === '+') additions++;
      else if (l[0] === '-') deletions++;
    }
    return { oldStart: h.oldStart + oOff, oldLines: h.oldLines, newStart: h.newStart + nOff, newLines: h.newLines, lines: h.lines };
  });
  return { hunks, additions, deletions };
}

const slim = (e) => e && ({ line: e.line, endLine: e.endLine, namePos: e.namePos, signature: e.signature });

/**
 * Compare old/new entity lists of one file pair.
 * Returns list of change records (unchanged entities are dropped, but returned separately for lookups).
 */
export function diffFileEntities(file, oldEnts, newEnts) {
  const byQ = (list) => {
    const m = new Map();
    for (const e of list) {
      let k = `${e.kind === 'test' ? 'test:' : ''}${e.qname}`;
      // overloads / duplicate names: disambiguate by order
      let i = 1;
      while (m.has(k)) k = `${e.qname}#${++i}`;
      m.set(k, e);
    }
    return m;
  };
  const om = byQ(oldEnts);
  const nm = byQ(newEnts);
  const changes = [];
  const unchanged = [];

  for (const [k, n] of nm) {
    const o = om.get(k);
    if (!o) {
      changes.push({ status: 'added', newE: n, oldE: null, file: file.path, oldFile: null });
      continue;
    }
    const bodyChanged = normBody(o) !== normBody(n);
    const moved = file.oldPath && file.oldPath !== file.path;
    if (!bodyChanged && !moved) {
      unchanged.push(n);
      continue;
    }
    changes.push({
      status: bodyChanged ? 'modified' : 'moved',
      bodyChanged,
      newE: n,
      oldE: o,
      file: file.path,
      oldFile: file.oldPath,
    });
  }
  for (const [k, o] of om) {
    if (!nm.has(k)) changes.push({ status: 'deleted', newE: null, oldE: o, file: null, oldFile: file.oldPath ?? file.path });
  }

  // in-file renames: same kind, near-identical body modulo the name
  const added = changes.filter((c) => c.status === 'added');
  const deleted = changes.filter((c) => c.status === 'deleted');
  for (const a of added) {
    let best = null;
    let bestScore = 0.85;
    for (const d of deleted) {
      if (d.matched || d.oldE.kind !== a.newE.kind || d.oldE.parent !== a.newE.parent) continue;
      const s = similarity(stripName(d.oldE), stripName(a.newE));
      if (s > bestScore) { best = d; bestScore = s; }
    }
    if (best) {
      best.matched = true;
      Object.assign(a, { status: 'renamed', oldE: best.oldE, oldFile: best.oldFile, bodyChanged: bestScore < 1, similarity: bestScore });
    }
  }
  return { changes: changes.filter((c) => !c.matched), unchanged };
}

/** Pair deleted+added entities across files → moved (optionally modified). */
export function detectMoves(changes) {
  const deleted = changes.filter((c) => c.status === 'deleted' && c.oldE.kind !== 'test');
  const byName = new Map();
  for (const d of deleted) {
    const k = `${d.oldE.kind}:${d.oldE.qname}`;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(d);
  }
  for (const a of changes) {
    if (a.status !== 'added' || a.newE.kind === 'test') continue;
    const cands = byName.get(`${a.newE.kind}:${a.newE.qname}`)?.filter((d) => !d.matched);
    if (!cands?.length) continue;
    let best = cands[0];
    let bestScore = -1;
    for (const d of cands) {
      const s = similarity(normBody(d.oldE), normBody(a.newE));
      if (s > bestScore) { best = d; bestScore = s; }
    }
    // a same-named but totally different thing is not a move
    if (bestScore < 0.3 && a.newE.kind !== 'class') continue;
    best.matched = true;
    Object.assign(a, {
      status: bestScore === 1 ? 'moved' : 'modified',
      moved: true,
      bodyChanged: bestScore < 1,
      oldE: best.oldE,
      oldFile: best.oldFile,
      similarity: bestScore,
    });
  }
  return changes.filter((c) => !c.matched);
}

/** Turn a change record into the serializable entity. */
export function toEntity(c, lang, fileKind) {
  const e = c.newE ?? c.oldE;
  const file = c.file ?? c.oldFile;
  const { hunks, additions, deletions } = c.status === 'moved' && !c.bodyChanged
    ? { hunks: [], additions: 0, deletions: 0 }
    : entityPatch(c.oldE, c.newE);
  const moved = c.moved || (c.oldFile && c.file && c.oldFile !== c.file);
  return {
    id: `${file}#${e.qname}`,
    kind: e.kind,
    name: e.name,
    qname: e.qname,
    parent: e.parent,
    lang,
    file,
    oldFile: c.oldFile && c.oldFile !== c.file ? c.oldFile : null,
    status: c.status,
    moved: Boolean(moved),
    bodyChanged: c.bodyChanged ?? c.status !== 'moved',
    isTest: fileKind === 'test' || e.kind === 'test',
    exported: e.exported,
    decorators: e.decorators,
    line: c.newE?.line ?? null,
    endLine: c.newE?.endLine ?? null,
    namePos: c.newE?.namePos ?? null,
    old: slim(c.oldE),
    oldName: c.oldE && c.newE && c.oldE.name !== c.newE.name ? c.oldE.qname : null,
    signature: e.signature,
    signatureChanged: Boolean(c.oldE && c.newE && sigNorm(c.oldE, c.newE.name) !== sigNorm(c.newE, c.newE.name)),
    additions,
    deletions,
    hunks,
    // body text is kept so resource detection can look at it; stripped before writing if huge
    _text: c.newE?.text ?? null,
    _oldText: c.oldE?.text ?? null,
  };
}

// a pure rename shouldn't count as a signature change
const sigNorm = (e, name) => (e.signature ?? '').split(e.name).join(name).replace(/\s+/g, ' ').trim();

const COMMENT_RE = /^\s*(\/\/|#|\/\*|\*|"""|''')/;
// import statements, incl. the inner lines of multi-line TS/Go/Python import blocks
const IMPORT_RE = /^\s*(import\b|export\s+(\*|\{[^}]*\})(\s+as\s+\w+)?\s+from\b|\}\s*from\b|from\s+[\w.]+\s+import\b|package\s+\w+|(\w+\s+)?["`][\w./\-@]+["`]\s*$|\)$|\w+(\s+as\s+\w+)?,\s*$|(const|let|var)\s+[\w{}\s,:]+=\s*require\()/;

const linesOf = (ents) => {
  const s = new Set();
  for (const e of ents) for (let i = e.line; i <= e.endLine; i++) s.add(i);
  return s;
};
// keep line numbers stable: lines owned by a declaration are blanked, not removed
const blankCovered = (text, covered) => text?.split('\n').map((l, i) => (covered.has(i + 1) ? '' : l)).join('\n') ?? null;

/**
 * Top-level code that belongs to no declaration (imports, registrations, side-effect calls,
 * script-style code) → one synthetic `module` entity per file, built from the file patch
 * lines that no extracted entity covers. Returns null when only blank/comment lines changed there.
 */
export function moduleEntity(file, patch, oldEnts, newEnts, oldText, newText) {
  const oc = linesOf(oldEnts);
  const nc = linesOf(newEnts);
  const hunks = [];
  let cur = null;
  let o = 0;
  let n = 0;
  let additions = 0;
  let deletions = 0;
  let significant = false;
  let codeChange = false;
  for (const line of patch.split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { o = Number(h[1]); n = Number(h[2]); cur = null; continue; }
    const sign = line[0];
    if (sign !== ' ' && sign !== '+' && sign !== '-') continue;
    const mine = sign === '+' ? !nc.has(n) : sign === '-' ? !oc.has(o) : !oc.has(o) && !nc.has(n);
    if (mine) {
      if (!cur || cur.nextO !== o || cur.nextN !== n) {
        cur = { oldStart: o, oldLines: 0, newStart: n, newLines: 0, lines: [], nextO: o, nextN: n };
        hunks.push(cur);
      }
      cur.lines.push(line);
      if (sign !== '+') { cur.oldLines++; cur.nextO++; }
      if (sign !== '-') { cur.newLines++; cur.nextN++; }
      if (sign !== ' ') {
        sign === '+' ? additions++ : deletions++;
        const t = line.slice(1);
        if (t.trim() && !COMMENT_RE.test(t)) {
          significant = true;
          if (!IMPORT_RE.test(t)) codeChange = true;
        }
      }
    }
    if (sign !== '+') o++;
    if (sign !== '-') n++;
  }
  if (!significant) return null;

  // drop context-only fragments, trim context to 3 lines on each side
  const out = [];
  for (const h of hunks) {
    const first = h.lines.findIndex((l) => l[0] !== ' ');
    if (first === -1) continue;
    let last = h.lines.length - 1;
    while (h.lines[last][0] === ' ') last--;
    const from = Math.max(0, first - 3);
    const to = Math.min(h.lines.length - 1, last + 3);
    const lines = h.lines.slice(from, to + 1);
    out.push({
      oldStart: h.oldStart + from, newStart: h.newStart + from,
      oldLines: lines.filter((l) => l[0] !== '+').length, newLines: lines.filter((l) => l[0] !== '-').length,
      lines,
    });
  }

  const changedNew = [];
  const changedOld = [];
  for (const h of out) {
    let a = h.oldStart;
    let b = h.newStart;
    for (const l of h.lines) {
      if (l[0] === '+') changedNew.push(b);
      if (l[0] === '-') changedOld.push(a);
      if (l[0] !== '+') a++;
      if (l[0] !== '-') b++;
    }
  }
  const status = file.status === 'added' ? 'added' : file.status === 'deleted' ? 'deleted' : 'modified';
  const path = status === 'deleted' ? file.oldPath ?? file.path : file.path;
  const name = path.split('/').pop();
  const span = (xs) => (xs.length ? { line: Math.min(...xs), endLine: Math.max(...xs) } : { line: null, endLine: null });
  const ns = span(changedNew);
  const os = span(changedOld);
  return {
    id: `${path}#(module)`,
    kind: 'module',
    name,
    qname: '(module)',
    parent: null,
    file: path,
    oldFile: file.oldPath && file.oldPath !== file.path ? file.oldPath : null,
    status,
    moved: false,
    bodyChanged: true,
    exported: false,
    decorators: [],
    line: status === 'deleted' ? null : ns.line ?? os.line,
    endLine: status === 'deleted' ? null : ns.endLine ?? os.endLine,
    namePos: null,
    old: status === 'added' ? null : { line: os.line ?? ns.line, endLine: os.endLine, namePos: null, signature: null },
    oldName: null,
    signature: null,
    signatureChanged: false,
    importOnly: !codeChange,
    additions,
    deletions,
    hunks: out,
    _text: status === 'deleted' ? null : blankCovered(newText, nc),
    _oldText: status === 'added' ? null : blankCovered(oldText, oc),
    _lineBase: 1,
  };
}
