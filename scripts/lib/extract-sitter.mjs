// Go / Python entity extraction and call-site scanning via tree-sitter.
import Parser from 'web-tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GRAMMAR = { go: 'go', py: 'python' };
let ready = null;
const parsers = {};

export async function initSitter() {
  if (!ready) ready = Parser.init();
  await ready;
  for (const [lang, g] of Object.entries(GRAMMAR)) {
    if (parsers[lang]) continue;
    const language = await Parser.Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${g}.wasm`));
    const p = new Parser();
    p.setLanguage(language);
    parsers[lang] = p;
  }
}

export function parseSitter(lang, text) {
  return parsers[lang].parse(text);
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

function entity(text, node, kind, nameNode, name, extra = {}) {
  const start = node.startIndex;
  const end = node.endIndex;
  const bodyNode = node.childForFieldName('body');
  const sigEnd = bodyNode ? bodyNode.startIndex : end;
  return {
    kind,
    name,
    qname: extra.parent ? `${extra.parent}.${name}` : name,
    parent: extra.parent ?? null,
    start,
    end,
    line: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    nameLine: (nameNode ?? node).startPosition.row + 1,
    namePos: (nameNode ?? node).startIndex,
    signature: norm(text.slice((nameNode ?? node).startIndex, sigEnd)).replace(/[:{]\s*$/, '').trim(),
    header: extra.header ?? null,
    text: text.slice(start, end),
    exported: extra.exported ?? true,
    decorators: extra.decorators ?? [],
  };
}

function goReceiverType(node) {
  const recv = node.childForFieldName('receiver');
  if (!recv) return null;
  const m = recv.text.match(/\*?\s*([A-Za-z_]\w*)(\[[^\]]*\])?\s*\)$/);
  return m ? m[1] : null;
}

export function extractGo(file, text) {
  const tree = parseSitter('go', text);
  const out = [];
  const isExp = (n) => /^[A-Z]/.test(n);
  for (const node of tree.rootNode.namedChildren) {
    if (node.type === 'function_declaration') {
      const nn = node.childForFieldName('name');
      const isTest = /^(Test|Benchmark|Fuzz|Example)/.test(nn.text) && file.endsWith('_test.go');
      out.push(entity(text, node, isTest ? 'test' : 'function', nn, nn.text, { exported: isExp(nn.text) }));
    } else if (node.type === 'method_declaration') {
      const nn = node.childForFieldName('name');
      const recv = goReceiverType(node);
      out.push(entity(text, node, 'method', nn, nn.text, { parent: recv, exported: isExp(nn.text) }));
    } else if (node.type === 'type_declaration') {
      for (const spec of node.namedChildren.filter((c) => c.type === 'type_spec' || c.type === 'type_alias')) {
        const nn = spec.childForFieldName('name');
        const t = spec.childForFieldName('type');
        const kind = t?.type === 'interface_type' ? 'interface' : t?.type === 'struct_type' ? 'class' : 'type';
        const target = node.namedChildren.length === 1 ? node : spec;
        out.push({ ...entity(text, target, kind, nn, nn.text, { exported: isExp(nn.text) }), signature: norm(spec.text) });
      }
    } else if (node.type === 'const_declaration' || node.type === 'var_declaration') {
      for (const spec of node.namedChildren.filter((c) => /_spec$/.test(c.type))) {
        const nn = spec.childForFieldName('name') ?? spec.namedChildren[0];
        if (!nn) continue;
        const target = node.namedChildren.length === 1 ? node : spec;
        out.push({ ...entity(text, target, 'const', nn, nn.text, { exported: isExp(nn.text) }), signature: norm(spec.text).slice(0, 200) });
      }
    }
  }
  return out;
}

export function extractPy(file, text, { isTest = false } = {}) {
  const tree = parseSitter('py', text);
  const out = [];
  const decos = (n) => n.type === 'decorated_definition'
    ? n.namedChildren.filter((c) => c.type === 'decorator').map((d) => {
      const t = d.text.replace(/^@/, '');
      const m = t.match(/^([\w.]+)\s*(?:\((.*)\))?/s);
      return { name: m?.[1] ?? t, args: m?.[2] ? [m[2].trim().slice(0, 120)] : [] };
    })
    : [];
  const defOf = (n) => (n.type === 'decorated_definition' ? n.childForFieldName('definition') : n);

  const visitClass = (outer, node) => {
    const nn = node.childForFieldName('name');
    const body = node.childForFieldName('body');
    const methods = [];
    const header = [norm(text.slice(outer.startIndex, body.startIndex))];
    for (const m of body.namedChildren) {
      const d = defOf(m);
      if (d?.type === 'function_definition') methods.push(m);
      else header.push(norm(m.text));
    }
    out.push({ ...entity(text, outer, 'class', nn, nn.text, { decorators: decos(outer), exported: !nn.text.startsWith('_') }),
      header: header.join('\n'), signature: norm(text.slice(nn.startIndex, body.startIndex)).replace(/:$/, '') });
    for (const m of methods) {
      const d = defOf(m);
      const mn = d.childForFieldName('name');
      const kind = isTest && /^test/.test(mn.text) ? 'test' : 'method';
      out.push({ ...entity(text, m, kind, mn, mn.text, { parent: nn.text, decorators: decos(m), exported: !mn.text.startsWith('_') }),
        signature: norm(text.slice(mn.startIndex, d.childForFieldName('body').startIndex)).replace(/:$/, '') });
    }
  };

  for (const node of tree.rootNode.namedChildren) {
    const d = defOf(node);
    if (!d) continue;
    if (d.type === 'function_definition') {
      const nn = d.childForFieldName('name');
      const kind = isTest && /^test/.test(nn.text) ? 'test' : 'function';
      out.push({ ...entity(text, node, kind, nn, nn.text, { decorators: decos(node), exported: !nn.text.startsWith('_') }),
        signature: norm(text.slice(nn.startIndex, d.childForFieldName('body').startIndex)).replace(/:$/, '') });
    } else if (d.type === 'class_definition') {
      visitClass(node, d);
    } else if (node.type === 'expression_statement' && node.namedChildren[0]?.type === 'assignment') {
      const left = node.namedChildren[0].childForFieldName('left');
      if (left?.type === 'identifier') {
        out.push({ ...entity(text, node, 'const', left, left.text, { exported: !left.text.startsWith('_') }), signature: norm(node.text).slice(0, 200) });
      }
    }
  }
  return out;
}

/**
 * Scan a file for call sites / identifier uses of any name in `names`.
 * Returns [{name, line, kind: 'call'|'ref', enclosing: {qname, kind, line}}]
 */
export function scanUses(lang, file, text, names) {
  const tree = parseSitter(lang, text);
  const ents = lang === 'go' ? extractGo(file, text) : extractPy(file, text, { isTest: true });
  const hits = [];
  const enclosing = (pos) => {
    let best = null;
    for (const e of ents) if (pos >= e.start && pos < e.end && (!best || e.start >= best.start)) best = e;
    return best ? { qname: best.qname, kind: best.kind, line: best.line, name: best.name, parent: best.parent } : null;
  };
  const idTypes = new Set(['identifier', 'field_identifier', 'type_identifier', 'attribute']);
  const walk = (node) => {
    if (idTypes.has(node.type) && node.childCount === 0 && names.has(node.text)) {
      const p = node.parent;
      // skip the definition name itself
      const isDef = p && p.childForFieldName?.('name')?.id === node.id &&
        /(function|method|class)_(declaration|definition)|type_spec/.test(p.type);
      if (!isDef) {
        let call = p;
        while (call && /selector_expression|attribute/.test(call.type)) call = call.parent;
        const isCall = call && /call(_expression)?$/.test(call.type) && call.childForFieldName('function')?.endIndex === node.endIndex;
        const isImport = (() => { for (let a = p; a; a = a.parent) if (/import/.test(a.type)) return true; return false; })();
        hits.push({
          name: node.text,
          line: node.startPosition.row + 1,
          kind: isImport ? 'import' : isCall ? 'call' : 'ref',
          // qualifier like pkg.Foo / obj.foo
          qualifier: p && /selector_expression|attribute/.test(p.type) ? (p.childForFieldName('operand') ?? p.childForFieldName('object'))?.text ?? null : null,
          enclosing: enclosing(node.startIndex),
        });
      }
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  };
  walk(tree.rootNode);
  return hits;
}
