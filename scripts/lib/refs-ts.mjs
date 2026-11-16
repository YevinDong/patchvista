import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { enclosingEntity, refKind } from './extract-ts.mjs';

const TS_RE = /\.([cm]?[jt]sx?)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.turbo|vendor)\//;

function findTsconfig(dir, changedFiles) {
  if (fs.existsSync(path.join(dir, 'tsconfig.json'))) return path.join(dir, 'tsconfig.json');
  // nearest tsconfig above the first changed TS file
  for (const f of changedFiles) {
    let d = path.dirname(path.join(dir, f));
    while (d.startsWith(dir)) {
      const p = path.join(d, 'tsconfig.json');
      if (fs.existsSync(p)) return p;
      d = path.dirname(d);
    }
  }
  return null;
}

export function createService(dir, repoFiles, changedFiles = []) {
  const cfgPath = findTsconfig(dir, changedFiles);
  let options = { allowJs: true, jsx: ts.JsxEmit.Preserve };
  if (cfgPath) {
    const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(raw.config ?? {}, ts.sys, path.dirname(cfgPath));
    options = parsed.options;
  }
  options = { ...options, allowJs: true, noEmit: true, skipLibCheck: true, incremental: false, composite: false, types: [] };

  const fileNames = repoFiles
    .filter((f) => TS_RE.test(f) && !SKIP_DIR.test(f))
    .map((f) => path.join(dir, f));
  const snapshots = new Map();
  const host = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => '1',
    getScriptSnapshot: (f) => {
      if (snapshots.has(f)) return snapshots.get(f);
      const text = ts.sys.readFile(f);
      const snap = text == null ? undefined : ts.ScriptSnapshot.fromString(text);
      snapshots.set(f, snap);
      return snap;
    },
    getCurrentDirectory: () => dir,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
  return { ls, dir, tsconfig: cfgPath ? path.relative(dir, cfgPath) : null, fileCount: fileNames.length };
}

const rel = (svc, f) => path.relative(svc.dir, f).split(path.sep).join('/');
const inRepo = (svc, f) => f.startsWith(svc.dir + path.sep) && !SKIP_DIR.test(rel(svc, f));

function locate(svc, fileName, pos) {
  const sf = svc.ls.getProgram().getSourceFile(fileName);
  if (!sf) return null;
  const enc = enclosingEntity(sf, pos);
  const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
  const file = rel(svc, fileName);
  return {
    file,
    line,
    kind: refKind(sf, pos),
    text: sf.text.split('\n')[line - 1]?.trim().slice(0, 160) ?? '',
    enclosing: enc
      ? { id: `${file}#${enc.qname}`, kind: enc.kind, name: enc.name, qname: enc.qname, parent: enc.parent ?? null, file, line: enc.line }
      : { id: `${file}#(module)`, kind: 'module', name: path.basename(file), qname: '(module)', parent: null, file, line: 1 },
  };
}

/**
 * Incoming references: for each entity, who references it.
 * Returns [{target, ref}] where ref = locate(...) result.
 */
export function incomingRefs(svc, entities, { maxPerEntity = 300 } = {}) {
  const results = [];
  for (const e of entities) {
    const abs = path.join(svc.dir, e.file);
    let refs;
    try {
      refs = svc.ls.findReferences(abs, e.namePos) ?? [];
    } catch {
      continue;
    }
    let n = 0;
    const seen = new Set();
    for (const sym of refs) {
      for (const r of sym.references) {
        if (r.isDefinition || !inRepo(svc, r.fileName)) continue;
        const key = `${r.fileName}:${r.textSpan.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const loc = locate(svc, r.fileName, r.textSpan.start);
        if (!loc || loc.enclosing.id === e.id) continue;
        results.push({ target: e.id, ref: loc });
        if (++n >= maxPerEntity) break;
      }
    }
  }
  return results;
}

function addedLines(e) {
  const set = new Set();
  for (const h of e.hunks) {
    let n = h.newStart;
    for (const l of h.lines) {
      if (l[0] === '+') set.add(n);
      if (l[0] !== '-') n++;
    }
  }
  return set;
}

/**
 * Outgoing calls introduced by changed code: calls on added lines whose
 * definition resolves to something inside the repo.
 */
export function outgoingCalls(svc, entities, { maxPerEntity = 40 } = {}) {
  const results = [];
  const program = svc.ls.getProgram();
  for (const e of entities) {
    if (e.status === 'deleted' || e.kind === 'class' || e.kind === 'interface' || e.kind === 'type') continue;
    const abs = path.join(svc.dir, e.file);
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    // module-level code spans the whole file; only its own (added) lines count
    const lines = e.kind !== 'module' && (e.status === 'added' || (e.status === 'moved' && !e.bodyChanged)) ? null : addedLines(e);
    const start = sf.getPositionOfLineAndCharacter(e.line - 1, 0);
    const end = sf.getPositionOfLineAndCharacter(Math.min(e.endLine, sf.getLineStarts().length) - 1, 0) + 10_000;
    const sites = [];
    const visit = (node) => {
      if (node.getEnd() < start || node.getStart(sf) > end) return;
      if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isDecorator(node)) {
        let callee = ts.isDecorator(node) ? node.expression : node.expression;
        if (ts.isCallExpression(callee)) callee = callee.expression;
        const nameNode = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
        if (ts.isIdentifier(nameNode) || ts.isPrivateIdentifier(nameNode)) {
          const line = sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line + 1;
          if (line >= e.line && line <= e.endLine && (!lines || lines.has(line))) {
            sites.push({ pos: nameNode.getStart(sf), line, kind: ts.isNewExpression(node) ? 'new' : ts.isDecorator(node) ? 'decorator' : 'call' });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    const seen = new Set();
    for (const s of sites.slice(0, maxPerEntity * 3)) {
      let defs;
      try {
        defs = svc.ls.getDefinitionAtPosition(abs, s.pos) ?? [];
      } catch {
        continue;
      }
      const d = defs.find((x) => inRepo(svc, x.fileName));
      if (!d) continue;
      const loc = locate(svc, d.fileName, d.textSpan.start);
      if (!loc || loc.enclosing.id === e.id || seen.has(loc.enclosing.id)) continue;
      seen.add(loc.enclosing.id);
      results.push({ source: e.id, line: s.line, kind: s.kind, target: loc.enclosing });
      if (seen.size >= maxPerEntity) break;
    }
  }
  return results;
}
