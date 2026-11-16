// Rule-based detection of external resources touched by code + config/sql/schema/deps files.
// Resource kinds: db | redis | mq | config | route | job | http | dep    (logs are attached to entities)

const lit = (s) => s?.replace(/^[`'"]|[`'"]$/g, '').replace(/\$\{[^}]*\}/g, '*').replace(/%[sdv]/g, '*');
export const dbKey = (name) => name.toLowerCase().replace(/[_\-."`]/g, '').replace(/(ies)$/, 'y').replace(/s$/, '');

const READ_OPS = /^(find|count|aggregate|groupBy|get|select|query|first|all|exists|ttl|hget|mget|smembers|zrange|lrange|scan)/i;

/** Each rule: (line) → [{kind, name, op}] */
const CODE_RULES = [
  // Prisma / generic ORM delegates: prisma.user.findMany(  tx.order.update(
  (l) => [...l.matchAll(/\b(?:this\.)?(?:\w*(?:[Pp]risma|[Cc]lient|[Tt]x|[Tt]rx|[Dd]b|[Dd]atabase)\w*)(?:\([^()]*\))?\.([a-z]\w*)\.(find\w*|create\w*|update\w*|upsert|delete\w*|count|aggregate|groupBy)\s*\(/g)]
    .map((m) => ({ kind: 'db', name: m[1], op: READ_OPS.test(m[2]) ? 'read' : 'write', detail: m[2] })),
  (l) => /\$(queryRaw|executeRaw)\w*/.test(l) ? [{ kind: 'db', name: '(raw sql)', op: /execute/.test(l) ? 'write' : 'read', detail: 'raw' }] : [],
  // SQL in strings
  (l) => [...l.matchAll(/\b(FROM|JOIN|INTO|UPDATE)\s+[`"]?([a-zA-Z_][\w.]*)[`"]?/g)]
    .filter((m) => /['"`]/.test(l) && /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(l) && m[1] === m[1].toUpperCase())
    .map((m) => ({ kind: 'db', name: m[2], op: m[1] === 'FROM' || m[1] === 'JOIN' ? 'read' : 'write', detail: 'sql' })),
  // TypeORM / gorm / sqlalchemy
  (l) => [...l.matchAll(/(?:getRepository|InjectRepository|InjectModel)\(\s*(\w+)/g)].map((m) => ({ kind: 'db', name: m[1], op: 'use' })),
  (l) => [...l.matchAll(/\.(?:Table|Model)\(\s*(?:&?(\w+)\{\}|"(\w+)")/g)].map((m) => ({ kind: 'db', name: m[1] ?? m[2], op: 'use' })),
  (l) => [...l.matchAll(/session\.query\(\s*(\w+)/g)].map((m) => ({ kind: 'db', name: m[1], op: 'read' })),

  // Redis
  (l) => [...l.matchAll(/\b(\w*(?:redis|cache|rdb)\w*)\.(get|set|setex|setnx|del|hget|hset|hdel|hgetall|hincrby|expire|incr|incrby|decr|lpush|rpush|lpop|rpop|sadd|srem|smembers|zadd|zrem|zrange|publish|subscribe|eval|mget|mset|exists|ttl|pexpire)\s*\(\s*(?:ctx\s*,\s*)?([`'"][^`'"]*[`'"]|[\w.]+)?/gi)]
    .map((m) => ({ kind: 'redis', name: m[3] ? lit(m[3]) : '(dynamic key)', op: READ_OPS.test(m[2]) ? 'read' : m[2] === 'publish' ? 'publish' : m[2] === 'subscribe' ? 'consume' : 'write', detail: m[2] })),
  (l) => /new\s+Redlock|\.lock\(\s*[`'"]/.test(l) ? [{ kind: 'redis', name: lit(l.match(/lock\(\s*\[?\s*([`'"][^`'"]*[`'"])/)?.[1]) ?? '(lock)', op: 'lock' }] : [],

  // MQ / queues / events
  (l) => [...l.matchAll(/@(Processor|InjectQueue|InjectFlowProducer)\(\s*([`'"][^`'"]+[`'"]|[\w.]+)/g)]
    .map((m) => ({ kind: 'mq', name: lit(m[2]), op: m[1] === 'Processor' ? 'consume' : 'publish', detail: m[1] })),
  (l) => [...l.matchAll(/new\s+(Queue|Worker|QueueEvents)\(\s*([`'"][^`'"]+[`'"]|[\w.]+)/g)]
    .map((m) => ({ kind: 'mq', name: lit(m[2]), op: m[1] === 'Queue' ? 'publish' : 'consume', detail: m[1] })),
  (l) => [...l.matchAll(/\b(\w*[qQ]ueue\w*)\.(add|addBulk)\(\s*([`'"][^`'"]+[`'"])?/g)]
    .map((m) => ({ kind: 'mq', name: m[1].replace(/^this\./, ''), op: 'publish', detail: m[3] ? `job ${lit(m[3])}` : m[2] })),
  (l) => [...l.matchAll(/@(EventPattern|MessagePattern|OnEvent|RabbitSubscribe|SqsMessageHandler|KafkaListener)\(\s*(?:\{[^}]*?(?:routingKey|queue|topic)\s*:\s*)?([`'"][^`'"]+[`'"]|[\w.]+)/g)]
    .map((m) => ({ kind: 'mq', name: lit(m[2]), op: 'consume', detail: m[1] })),
  (l) => [...l.matchAll(/\.(emit|emitAsync|sendToQueue|publish|send)\(\s*([`'"][^`'"]+[`'"])/g)]
    .filter((m) => !/redis|cache|res\.|response/i.test(l))
    .map((m) => ({ kind: 'mq', name: lit(m[2]), op: 'publish', detail: m[1] })),
  (l) => [...l.matchAll(/\btopic[s]?\s*[:=]\s*\[?\s*([`'"][^`'"]+[`'"])/gi)].map((m) => ({ kind: 'mq', name: lit(m[1]), op: /subscribe|consum/i.test(l) ? 'consume' : 'publish', detail: 'topic' })),
  (l) => [...l.matchAll(/\b(?:taskDefName|taskType|taskDefinitionName)\s*[:=]\s*([`'"][^`'"]+[`'"])/g)].map((m) => ({ kind: 'mq', name: lit(m[1]), op: 'use', detail: 'task' })),
  (l) => [...l.matchAll(/@(?:\w+\.)?task\b|\.(?:delay|apply_async)\(/g)].length ? [{ kind: 'mq', name: '(celery task)', op: /delay|apply_async/.test(l) ? 'publish' : 'consume' }] : [],

  // Config / env
  (l) => [...l.matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\])/g)].map((m) => ({ kind: 'config', name: m[1] ?? m[2], op: 'read' })),
  (l) => [...l.matchAll(/\b\w*[cC]onfig\w*\.(?:get|getOrThrow)(?:<[^>]*>)?\(\s*['"`]([\w.\-]+)['"`]/g)].map((m) => ({ kind: 'config', name: m[1], op: 'read' })),
  (l) => [...l.matchAll(/os\.(?:Getenv|LookupEnv|getenv)\(\s*["']([\w.]+)["']|os\.environ(?:\.get)?[\[(]\s*["']([\w.]+)["']/g)].map((m) => ({ kind: 'config', name: m[1] ?? m[2], op: 'read' })),
  (l) => [...l.matchAll(/viper\.Get\w*\(\s*"([\w.]+)"/g)].map((m) => ({ kind: 'config', name: m[1], op: 'read' })),

  // Outbound HTTP
  (l) => [...l.matchAll(/\b(?:fetch|axios(?:\.\w+)?|got|ky|http\.(?:Get|Post|NewRequest\w*)|requests\.\w+|httpx\.\w+|httpService\.\w+|this\.http\w*\.\w+)\(\s*(?:ctx\s*,\s*)?(?:"[A-Z]+"\s*,\s*)?([`'"][^`'"]+[`'"]|[\w.]+)?/g)]
    .filter((m) => !/^\s*(\/\/|#)/.test(l))
    .map((m) => ({ kind: 'http', name: m[1] ? lit(m[1]).replace(/\?.*$/, '') : '(dynamic url)', op: 'call' })),

  // Jobs / schedulers
  (l) => [...l.matchAll(/@(Cron|Interval|Timeout)\(\s*([^)]*)\)/g)].map((m) => ({ kind: 'job', name: `${m[1]} ${lit(m[2].split(',')[0].trim())}`, op: 'schedule' })),
  (l) => [...l.matchAll(/(?:cron\.schedule|\.AddFunc|schedule\.every)\(\s*([`'"][^`'"]+[`'"])?/g)].map((m) => ({ kind: 'job', name: m[1] ? lit(m[1]) : '(schedule)', op: 'schedule' })),
];

const LOG_RE = /\b(?:this\.)?(logger|log|console|slog|zap\w*|logging)\.(log|info|warn|warning|error|debug|verbose|fatal|trace|Printf|Println|Info|Warn|Error|Debug|Infof|Errorf|Warnf|exception)\s*\(\s*([`'"](?:[^`'"\\]|\\.)*[`'"])?/;

const ROUTE_METHOD = /^(Get|Post|Put|Patch|Delete|Options|Head|All)$/;

function routesOf(entity, classPrefix) {
  const out = [];
  for (const d of entity.decorators ?? []) {
    const m = d.name.match(/(?:^|\.)(get|post|put|patch|delete|route|api_route)$/i);
    if (ROUTE_METHOD.test(d.name)) {
      const p = [classPrefix, lit(d.args[0] ?? '')].filter(Boolean).join('/').replace(/\/+/g, '/');
      out.push({ kind: 'route', name: `${d.name.toUpperCase()} /${p.replace(/^\//, '')}`, op: 'handle' });
    } else if (m && entity.lang === 'py') {
      const verb = m[1].toLowerCase() === 'route' ? 'ANY' : m[1].toUpperCase();
      out.push({ kind: 'route', name: `${verb} ${lit(d.args[0]?.split(',')[0] ?? '')}`, op: 'handle' });
    } else if (/^(Process|OnWorkerEvent)$/.test(d.name)) {
      out.push({ kind: 'mq', name: lit(d.args[0] ?? '(job)'), op: 'consume', detail: d.name });
    }
  }
  return out;
}

function scanText(text, extra = []) {
  const found = new Map();
  if (!text) return found;
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|#)/.test(l)) return;
    for (const rule of CODE_RULES) {
      for (const u of rule(l)) {
        if (!u.name) continue;
        const key = `${u.kind}|${u.kind === 'db' ? dbKey(u.name) : u.name}|${u.op}`;
        if (!found.has(key)) found.set(key, { ...u, offset: i, text: l.trim().slice(0, 160) });
      }
    }
  });
  for (const u of extra) found.set(`${u.kind}|${u.name}|${u.op}`, { ...u, offset: 0, text: '' });
  return found;
}

function logsOf(text) {
  const out = new Map();
  if (!text) return out;
  text.split('\n').forEach((l, i) => {
    const m = l.match(LOG_RE);
    if (!m || /^\s*(\/\/|\*|#)/.test(l)) return;
    const level = m[2].toLowerCase().replace(/f$|ln$/, '').replace('printf', 'info').replace('print', 'info');
    const msg = m[3] ? lit(m[3]) : l.trim().slice(0, 100);
    out.set(`${level}|${msg}`, { level, msg, offset: i, text: l.trim().slice(0, 160) });
  });
  return out;
}

/**
 * Attach resource usages + logs to entities; return resource registry.
 */
export function detectCodeResources(entities) {
  const resources = new Map();
  const classPrefix = new Map();
  for (const e of entities) {
    if (e.kind === 'class') {
      const c = (e.decorators ?? []).find((d) => d.name === 'Controller');
      if (c) classPrefix.set(`${e.file}#${e.name}`, lit(c.args[0] ?? '') || '');
    }
  }
  const reg = (u, e, status) => {
    const id = `${u.kind}:${u.kind === 'db' ? dbKey(u.name) : u.name}`;
    if (!resources.has(id)) resources.set(id, { id, kind: u.kind, name: u.name, usages: [], defs: [] });
    const r = resources.get(id);
    const line = (status === 'removed' ? e._lineBase ?? e.old?.line ?? 0 : e._lineBase ?? e.line ?? 0) + u.offset;
    r.usages.push({ entity: e.id, op: u.op, detail: u.detail ?? null, status, file: status === 'removed' ? (e.oldFile ?? e.file) : e.file, line, text: u.text });
  };

  for (const e of entities) {
    if (e.isTest) continue;
    const prefix = e.parent ? classPrefix.get(`${e.file}#${e.parent}`) : undefined;
    const newRoutes = e.status === 'deleted' ? [] : routesOf(e, prefix);
    const oldRoutes = e.status === 'added' ? [] : routesOf({ ...e, decorators: e._oldDecorators ?? e.decorators }, prefix);
    const nu = scanText(e._text, newRoutes);
    const ou = scanText(e._oldText, e.status === 'deleted' ? oldRoutes : []);
    for (const [k, u] of nu) reg(u, e, ou.has(k) ? 'unchanged' : 'added');
    for (const [k, u] of ou) if (!nu.has(k)) reg(u, e, 'removed');

    const nl = logsOf(e._text);
    const ol = logsOf(e._oldText);
    const logs = [];
    for (const [k, l] of nl) logs.push({ ...l, line: (e._lineBase ?? e.line ?? 0) + l.offset, status: ol.has(k) ? 'unchanged' : 'added' });
    for (const [k, l] of ol) if (!nl.has(k)) logs.push({ ...l, line: (e._lineBase ?? e.old?.line ?? 0) + l.offset, status: 'removed' });
    e.logs = logs.filter((l) => l.status !== 'unchanged' || e.status === 'added');
  }
  return resources;
}

/** Hunk walker: yields {sign, text, oldLine, newLine} for each +/- line */
export function* patchLines(patch) {
  let o = 0;
  let n = 0;
  for (const line of patch.split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { o = Number(h[1]); n = Number(h[2]); continue; }
    if (line.startsWith('+')) { yield { sign: '+', text: line.slice(1), newLine: n }; n++; }
    else if (line.startsWith('-')) { yield { sign: '-', text: line.slice(1), oldLine: o }; o++; }
    else if (line.startsWith(' ')) { o++; n++; }
  }
}

/**
 * Non-code files: env/yaml config keys, SQL DDL, Prisma schema models, dependency manifests.
 * Returns list of {resourceId, kind, name, status, file, line, op, text}
 */
export function detectFileResources(file, patch, oldText, newText) {
  const out = [];
  const add = (kind, name, status, line, op, text) => out.push({ id: `${kind}:${kind === 'db' ? dbKey(name) : name}`, kind, name, status, file: file.path, line, op, text: text?.trim().slice(0, 160) });
  const lines = [...patchLines(patch)];

  if (file.kind === 'config') {
    const isEnv = /(^|\/)\.env/.test(file.path);
    const keyRe = isEnv ? /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/ : /^\s*["']?([A-Za-z_][\w.\-]*)["']?\s*[:=]/;
    const plus = new Map();
    const minus = new Map();
    for (const l of lines) {
      if (/^\s*#/.test(l.text) && !isEnv) continue;
      const m = l.text.replace(/^\s*#\s*/, isEnv ? '' : '#').match(keyRe);
      if (!m || (isEnv && /^\s*#/.test(l.text))) continue;
      (l.sign === '+' ? plus : minus).set(m[1], l);
    }
    for (const [k, l] of plus) add('config', k, minus.has(k) ? 'modified' : 'added', l.newLine, 'define', l.text);
    for (const [k, l] of minus) if (!plus.has(k)) add('config', k, 'removed', l.oldLine, 'define', l.text);
  }

  if (file.kind === 'sql') {
    for (const l of lines) {
      const t = l.text;
      let m;
      if ((m = t.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([\w.]+)[`"]?/i))) add('db', m[1], 'added', l.newLine, 'ddl:create', t);
      else if ((m = t.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?([\w.]+)[`"]?/i))) add('db', m[1], 'removed', l.newLine, 'ddl:drop', t);
      else if ((m = t.match(/ALTER\s+TABLE\s+(?:ONLY\s+)?[`"]?([\w.]+)[`"]?\s*(.*)/i))) add('db', m[1], 'modified', l.newLine, `ddl:alter`, t);
      else if ((m = t.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"]?\w+[`"]?\s+ON\s+[`"]?([\w.]+)[`"]?/i))) add('db', m[1], 'modified', l.newLine, 'ddl:index', t);
    }
  }

  if (file.path.endsWith('.prisma')) {
    const modelAt = (text, line) => {
      if (!text) return null;
      const ls = text.split('\n');
      for (let i = line - 1; i >= 0; i--) {
        const m = ls[i]?.match(/^\s*(model|enum|view|type)\s+(\w+)\s*\{/);
        if (m) return m[2];
        if (/^\s*\}/.test(ls[i] ?? '') && i !== line - 1) return null;
      }
      return null;
    };
    const touched = new Map();
    for (const l of lines) {
      const model = l.sign === '+' ? modelAt(newText, l.newLine) : modelAt(oldText, l.oldLine);
      if (!model) continue;
      if (!touched.has(model)) touched.set(model, { line: l.newLine ?? l.oldLine, plus: 0, minus: 0, sample: [] });
      const t = touched.get(model);
      t[l.sign === '+' ? 'plus' : 'minus']++;
      if (t.sample.length < 6) t.sample.push(`${l.sign} ${l.text.trim()}`);
      if (/^\s*model\s/.test(l.text)) t.whole = l.sign;
    }
    for (const [model, t] of touched) {
      add('db', model, t.whole === '+' ? 'added' : t.whole === '-' ? 'removed' : 'modified', t.line, 'schema', t.sample.join('\n'));
    }
  }

  if (file.kind === 'deps') out.push(...depChanges(file, oldText, newText));
  return out;
}

function depChanges(file, oldText, newText) {
  const out = [];
  const add = (name, status, from, to) => out.push({ id: `dep:${name}`, kind: 'dep', name, status, file: file.path, line: 0, op: 'depend', text: [from, to].filter(Boolean).join(' → ') });
  let o = {};
  let n = {};
  if (file.path.endsWith('package.json')) {
    const deps = (t) => {
      try {
        const j = JSON.parse(t ?? '{}');
        return { ...j.peerDependencies, ...j.devDependencies, ...j.dependencies };
      } catch { return {}; }
    };
    o = deps(oldText);
    n = deps(newText);
  } else {
    const parse = (t) => Object.fromEntries((t ?? '').split('\n').map((l) =>
      l.trim().match(/^(?:require\s+)?([\w./\-@]+)\s*(?:==|>=|<=|~=|\s)\s*([\w.\-+]+)/)).filter(Boolean).map((m) => [m[1], m[2]]));
    o = parse(oldText);
    n = parse(newText);
  }
  for (const [k, v] of Object.entries(n)) {
    if (!(k in o)) add(k, 'added', null, v);
    else if (o[k] !== v) add(k, 'modified', o[k], v);
  }
  for (const [k, v] of Object.entries(o)) if (!(k in n)) add(k, 'removed', v, null);
  return out;
}
