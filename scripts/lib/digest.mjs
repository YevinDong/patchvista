// Compact, AI-readable summary of facts.json. Every line carries short ids (e*/c*/r*/f*)
// so the analysis step can reference things without copying long paths.

const ST = { added: 'A', modified: 'M', deleted: 'D', moved: 'MV', renamed: 'RN', context: 'ctx' };

export function writeDigest(facts) {
  const { meta, stats, files, entities, contexts, edges, resources, risks } = facts;
  const ctx = new Map(contexts.map((c) => [c.id, c]));
  const ent = new Map(entities.map((e) => [e.id, e]));
  const sidOf = (id) => ent.get(id)?.sid ?? ctx.get(id)?.sid ?? id;
  const nameOf = (id) => { const n = ent.get(id) ?? ctx.get(id); return n ? n.qname : id; };
  const inc = new Map();
  const out = new Map();
  for (const ed of edges) {
    (inc.get(ed.to) ?? inc.set(ed.to, []).get(ed.to)).push(ed);
    (out.get(ed.from) ?? out.set(ed.from, []).get(ed.from)).push(ed);
  }
  const resBy = new Map();
  for (const r of resources) for (const u of r.usages) {
    (resBy.get(u.entity) ?? resBy.set(u.entity, []).get(u.entity)).push(`${r.sid}:${r.kind}:${r.name}(${u.op}${u.status === 'added' ? '+' : u.status === 'removed' ? '-' : ''})`);
  }

  const L = [];
  L.push(`# diff digest: ${meta.repoName}  ${meta.range.label}`);
  L.push(`files ${stats.files}  +${stats.additions} -${stats.deletions}  entities ${entities.length}  edges ${edges.length}  resources ${resources.length}`);
  L.push(`files by kind: ${JSON.stringify(stats.filesByKind)}   entities by status: ${JSON.stringify(stats.entitiesByStatus)}`);
  if (meta.commits?.length) {
    L.push('', '## commits (newest first)');
    for (const c of meta.commits.slice(0, 40)) L.push(`- ${c.sha} ${c.subject}`);
  }

  L.push('', '## heuristic risks (rule-based, verify before trusting)');
  for (const r of risks) L.push(`- [${r.level}] ${r.title}  {${r.entities.slice(0, 8).join(',')}}${r.detail ? `  — ${r.detail.split('\n')[0].slice(0, 140)}` : ''}`);

  L.push('', '## files & changed entities, by module');
  L.push('legend: status A/M/D/MV(moved)/RN(renamed); module (module) = top-level code outside any declaration; sig± = signature changed; in = incoming refs (callers), * = caller not changed in this diff; out = new outgoing calls');
  const byMod = new Map();
  for (const f of files) (byMod.get(f.module) ?? byMod.set(f.module, []).get(f.module)).push(f);
  for (const [mod, fs] of [...byMod].sort((a, b) => a[0].localeCompare(b[0]))) {
    L.push('', `### ${mod}`);
    for (const f of fs) {
      const moved = f.oldPath ? ` ← ${f.oldPath}${f.similarity != null ? ` (${f.similarity}%)` : ''}` : '';
      L.push(`${f.id} [${f.status}] ${f.path} +${f.additions} -${f.deletions} (${f.kind})${moved}`);
      const es = f.entities.map((id) => ent.get(id)).filter(Boolean);
      // a pure move with no body changes is noise here; collapse it
      const pureMoves = es.filter((e) => e.status === 'moved' && !e.bodyChanged);
      for (const e of es) {
        if (pureMoves.includes(e) && pureMoves.length > 2) continue;
        const parts = [`  ${e.sid} ${ST[e.status] ?? e.status} ${e.kind} ${e.qname}`];
        if (e.oldName) parts.push(`(was ${e.oldName})`);
        if (e.moved && e.oldFile && e.oldFile !== f.oldPath) parts.push(`(from ${e.oldFile})`);
        if (e.bodyChanged && e.status !== 'added' && e.status !== 'deleted') parts.push(`+${e.additions}/-${e.deletions}`);
        if (e.status === 'added') parts.push(`+${e.additions}`);
        if (e.signatureChanged) parts.push('sig±');
        if (e.importOnly) parts.push('imports-only');
        const i = (inc.get(e.id) ?? []).filter((ed) => !(ent.get(ed.from)?.isTest || ctx.get(ed.from)?.isTest));
        const t = (inc.get(e.id) ?? []).length - i.length;
        if (i.length) parts.push(`in:[${i.slice(0, 6).map((ed) => sidOf(ed.from) + (ctx.has(ed.from) ? '*' : '')).join(',')}${i.length > 6 ? `…${i.length}` : ''}]`);
        if (t) parts.push(`tests:${t}`);
        const o = (out.get(e.id) ?? []).filter((ed) => ed.status === 'added');
        if (o.length) parts.push(`out:[${o.slice(0, 6).map((ed) => sidOf(ed.to)).join(',')}${o.length > 6 ? `…${o.length}` : ''}]`);
        if (resBy.has(e.id)) parts.push(`res:[${resBy.get(e.id).filter((x) => /[+-]\)$/.test(x) || e.status === 'added').slice(0, 5).join(',')}]`);
        if (e.formerCallers?.length) parts.push(`formerCallers:${e.formerCallers.length}`);
        L.push(parts.join(' '));
      }
      if (pureMoves.length > 2) L.push(`  (${pureMoves.length} entities moved unchanged: ${pureMoves.slice(0, 8).map((e) => e.sid).join(',')}${pureMoves.length > 8 ? '…' : ''})`);
    }
  }

  L.push('', '## context nodes (unchanged code referenced by / referencing changed code)');
  for (const c of contexts.filter((c) => !c.isTest).slice(0, 300)) L.push(`${c.sid} ${c.kind} ${c.qname} @ ${c.file}:${c.line}`);
  const tc = contexts.filter((c) => c.isTest).length;
  if (tc) L.push(`(+${tc} test context nodes omitted)`);

  L.push('', '## resources');
  for (const r of resources) {
    const ops = [...new Set(r.usages.map((u) => `${u.op}${u.status === 'added' ? '+' : u.status === 'removed' ? '-' : ''}`))].join(',');
    const users = [...new Set(r.usages.map((u) => sidOf(u.entity)))].slice(0, 8).join(',');
    const defs = r.defs.map((d) => `${d.op}:${d.status}@${d.file}`).slice(0, 3).join('; ');
    L.push(`${r.sid} ${r.kind} ${r.name} [${r.status}] ops:${ops || '-'} by:[${users}]${defs ? ` defs: ${defs}` : ''}${r.stillReferenced?.length ? ' STILL-REFERENCED' : ''}${r.undeclared ? ' UNDECLARED' : ''}`);
  }
  return L.join('\n') + '\n';
}
