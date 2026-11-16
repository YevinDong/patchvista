import ts from 'typescript';

export function parseTs(file, text) {
  const kind = /\.[cm]?tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX
    : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

function decoratorsOf(node, sf) {
  const decs = ts.canHaveDecorators?.(node) ? ts.getDecorators(node) ?? [] : [];
  return decs.map((d) => {
    const e = d.expression;
    const name = ts.isCallExpression(e) ? e.expression.getText(sf) : e.getText(sf);
    const args = ts.isCallExpression(e) ? e.arguments.map((a) => a.getText(sf)) : [];
    return { name, args };
  });
}

function isExported(node) {
  const mods = ts.canHaveModifiers?.(node) ? ts.getModifiers(node) ?? [] : [];
  return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function bodyStart(node) {
  const body = node.body ?? (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer.body : null);
  return body ? body.getStart() : node.getEnd();
}

/** signature = text from name to body start, whitespace-normalized */
function signatureOf(node, sf, nameNode) {
  const from = nameNode ? nameNode.getStart(sf) : node.getStart(sf);
  return sf.text.slice(from, bodyStart(node)).replace(/\s+/g, ' ').replace(/\s*=>\s*$/, '').replace(/[\s{=]+$/, '').trim();
}

const stringArg = (call, sf) => {
  const a = call.arguments?.[0];
  if (!a) return null;
  if (ts.isStringLiteralLike(a)) return a.text;
  return a.getText(sf).slice(0, 60);
};

/**
 * Extract top-level entities from a TS/JS source.
 * Entity: { kind, name, qname, parent, start, end, line, endLine, nameLine, namePos,
 *           signature, header, text, exported, decorators }
 */
export function extractTs(file, text, { isTest = false } = {}) {
  const sf = parseTs(file, text);
  const out = [];

  const push = (node, kind, nameNode, name, extra = {}) => {
    // getStart() includes decorators (TS 5 treats them as modifiers)
    const start = node.getStart(sf);
    const end = node.getEnd();
    out.push({
      kind,
      name,
      qname: extra.parent ? `${extra.parent}.${name}` : name,
      parent: extra.parent ?? null,
      start,
      end,
      line: lineOf(sf, start),
      endLine: lineOf(sf, end),
      nameLine: lineOf(sf, nameNode ? nameNode.getStart(sf) : start),
      namePos: nameNode ? nameNode.getStart(sf) : start,
      signature: extra.signature ?? null,
      header: extra.header ?? null,
      text: sf.text.slice(start, end),
      exported: extra.exported ?? isExported(node),
      decorators: extra.decorators ?? decoratorsOf(node, sf),
    });
  };

  const visitClass = (node) => {
    const name = node.name?.text ?? 'default';
    const members = [];
    let headerEnd = node.members.pos;
    // class "header" = decorators + heritage + non-function properties; methods are separate entities
    const headerParts = [sf.text.slice(node.getStart(sf), headerEnd)];
    for (const m of node.members) {
      const isFnProp = ts.isPropertyDeclaration(m) && m.initializer &&
        (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer));
      if (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m) || isFnProp) {
        members.push(m);
      } else {
        headerParts.push(m.getText(sf));
      }
    }
    push(node, 'class', node.name, name, {
      header: headerParts.join('\n').replace(/\s+/g, ' '),
      signature: sf.text.slice(node.name?.getStart(sf) ?? node.getStart(sf), node.members.pos).replace(/\s+/g, ' ').replace(/\{\s*$/, '').trim(),
    });
    for (const m of members) {
      const isCtor = ts.isConstructorDeclaration(m);
      const mName = isCtor ? 'constructor' : m.name.getText(sf);
      const nameNode = isCtor ? m.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.ConstructorKeyword) : m.name;
      push(m, 'method', nameNode, mName, {
        parent: name,
        signature: signatureOf(m, sf, nameNode),
        exported: isExported(node),
      });
    }
  };

  const visitTestCall = (stmt) => {
    // describe('x', ...) / test('x') / it('x') at top level → test entity
    const call = stmt.expression;
    if (!ts.isCallExpression(call)) return false;
    const callee = call.expression.getText(sf).replace(/\.(only|skip|each.*)$/, '');
    if (!/^(describe|test|it|suite|context)$/.test(callee)) return false;
    const label = stringArg(call, sf) ?? callee;
    push(stmt, 'test', call.expression, label, { signature: `${callee}(${JSON.stringify(label)})`, exported: false });
    return true;
  };

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      push(stmt, 'function', stmt.name, stmt.name?.text ?? 'default', { signature: signatureOf(stmt, sf, stmt.name) });
    } else if (ts.isClassDeclaration(stmt)) {
      visitClass(stmt);
    } else if (ts.isInterfaceDeclaration(stmt)) {
      push(stmt, 'interface', stmt.name, stmt.name.text, { signature: stmt.getText(sf).replace(/\s+/g, ' ') });
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      push(stmt, 'type', stmt.name, stmt.name.text, { signature: stmt.getText(sf).replace(/\s+/g, ' ') });
    } else if (ts.isEnumDeclaration(stmt)) {
      push(stmt, 'enum', stmt.name, stmt.name.text, { signature: stmt.getText(sf).replace(/\s+/g, ' ') });
    } else if (ts.isVariableStatement(stmt)) {
      const exported = isExported(stmt);
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        const node = stmt.declarationList.declarations.length === 1 ? stmt : d;
        push(node, isFn ? 'function' : 'const', d.name, d.name.text, {
          exported,
          signature: isFn ? signatureOf(d, sf, d.name) : (d.type ? `${d.name.text}: ${d.type.getText(sf)}` : d.name.text),
          decorators: [],
        });
      }
    } else if (ts.isModuleDeclaration(stmt) && stmt.name) {
      push(stmt, 'namespace', stmt.name, stmt.name.getText(sf), { signature: `namespace ${stmt.name.getText(sf)}` });
    } else if (ts.isExpressionStatement(stmt) && isTest) {
      visitTestCall(stmt);
    } else if (ts.isExportAssignment(stmt)) {
      push(stmt, 'const', null, 'default', { exported: true, signature: 'export default', decorators: [] });
    }
  }
  return out;
}

/** Return the innermost extracted-entity-like container for a position in a parsed SourceFile. */
export function enclosingEntity(sf, pos) {
  let best = null;
  let className = null;
  const visit = (node) => {
    if (pos < node.getFullStart() || pos >= node.getEnd()) return;
    let hit = null;
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      className = node.name?.text ?? 'default';
      hit = { kind: 'class', name: className, qname: className, node };
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      hit = { kind: 'function', name: node.name.text, qname: node.name.text, node };
    } else if ((ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && className && node.parent && ts.isClassLike(node.parent)) {
      const n = node.name.getText(sf);
      hit = { kind: 'method', name: n, qname: `${className}.${n}`, parent: className, node };
    } else if (ts.isConstructorDeclaration(node) && className) {
      hit = { kind: 'method', name: 'constructor', qname: `${className}.constructor`, parent: className, node };
    } else if (ts.isPropertyDeclaration(node) && className && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      const n = node.name.getText(sf);
      hit = { kind: 'method', name: n, qname: `${className}.${n}`, parent: className, node };
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.parent?.parent && ts.isVariableStatement(node.parent.parent) && node.parent.parent.parent === sf) {
      const init = node.initializer;
      const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
      hit = { kind: isFn ? 'function' : 'const', name: node.name.text, qname: node.name.text, node };
    } else if (ts.isExpressionStatement(node) && node.parent === sf && ts.isCallExpression(node.expression)) {
      const callee = node.expression.expression.getText(sf).replace(/\.(only|skip|each.*)$/, '');
      if (/^(describe|test|it|suite|context)$/.test(callee)) {
        const label = stringArg(node.expression, sf) ?? callee;
        hit = { kind: 'test', name: label, qname: label, node };
      }
    } else if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.parent === sf) {
      hit = { kind: ts.isInterfaceDeclaration(node) ? 'interface' : ts.isEnumDeclaration(node) ? 'enum' : 'type', name: node.name.text, qname: node.name.text, node };
    }
    if (hit) {
      best = hit;
      // don't descend into nested test blocks; top-level describe is the unit
      if (hit.kind === 'test') return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return best ? { ...best, line: lineOf(sf, best.node.getStart(sf)) } : null;
}

/** Classify how a reference at `pos` is used. */
export function refKind(sf, pos) {
  let node = findToken(sf, pos);
  if (!node) return 'ref';
  // climb property access chains: a.b.c(...)
  let n = node;
  while (n.parent && (ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) n = n.parent;
  const p = n.parent;
  if (!p) return 'ref';
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p) || ts.isImportEqualsDeclaration(p)) return 'import';
  if (ts.isCallExpression(p) && p.expression === n) return ts.isDecorator(p.parent) ? 'decorator' : 'call';
  if (ts.isNewExpression(p) && p.expression === n) return 'new';
  if (ts.isDecorator(p)) return 'decorator';
  if (ts.isTypeReferenceNode(p) || ts.isExpressionWithTypeArguments(p) || ts.isTypeQueryNode(p) || ts.isQualifiedName(p)) {
    if (ts.isExpressionWithTypeArguments(p) && ts.isHeritageClause(p.parent)) {
      return p.parent.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends';
    }
    return 'type';
  }
  if (ts.isHeritageClause(p) || (ts.isExpressionWithTypeArguments(p))) return 'extends';
  if (ts.isArrayLiteralExpression(p)) return 'ref'; // e.g. Nest providers: [Foo]
  return 'ref';
}

function findToken(sf, pos) {
  let found = null;
  const visit = (node) => {
    if (pos < node.getStart(sf) || pos >= node.getEnd()) return;
    found = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
