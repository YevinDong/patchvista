import path from 'node:path';

const LANG_BY_EXT = {
  '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts',
  '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.go': 'go',
  '.py': 'py',
};

export function langOf(p) {
  if (p.endsWith('.d.ts')) return null;
  return LANG_BY_EXT[path.extname(p)] ?? null;
}

const TEST_RE = /(^|\/)(__tests__|tests?|testing|spec)\/|\.(test|spec|e2e-spec|integration)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)test_[^/]*\.py$|_test\.py$/;
const DEP_FILES = new Set(['package.json', 'go.mod', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg']);
const LOCK_RE = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock)$/;

/**
 * kind: code | test | config | sql | schema | deps | lock | doc | ci | other
 */
export function fileKind(p) {
  const base = path.basename(p);
  const ext = path.extname(p).toLowerCase();
  if (LOCK_RE.test(p)) return 'lock';
  if (DEP_FILES.has(base)) return 'deps';
  if (/(^|\/)\.github\/|\.gitlab-ci|Jenkinsfile|Dockerfile|docker-compose|\.dockerignore$/.test(p)) return 'ci';
  if (ext === '.sql' || /(^|\/)migrations?\//.test(p) && langOf(p) == null) return 'sql';
  if (ext === '.prisma' || ext === '.proto' || ext === '.graphql' || ext === '.gql' || /\.(avsc|thrift)$/.test(ext)) return 'schema';
  if (langOf(p)) return TEST_RE.test(p) ? 'test' : 'code';
  if (/^\.env/.test(base) || ['.yaml', '.yml', '.toml', '.ini', '.conf', '.properties'].includes(ext) ||
      (ext === '.json' && !/tsconfig|\.eslintrc/.test(base)) || /config/i.test(base)) return 'config';
  if (['.md', '.mdx', '.rst', '.txt', '.adoc'].includes(ext)) return 'doc';
  return 'other';
}

/** Group key for "module" level: top 3–4 meaningful directories. */
export function moduleOf(p) {
  const parts = p.split('/');
  parts.pop();
  if (parts.length === 0) return '(root)';
  // strip common source roots, then keep up to 3 segments
  const roots = new Set(['src', 'lib', 'app', 'apps', 'packages', 'internal', 'pkg', 'cmd', 'modules']);
  let i = 0;
  const keep = [];
  while (i < parts.length && roots.has(parts[i]) && keep.length < 2) keep.push(parts[i++]);
  const rest = parts.slice(i, i + 2);
  return [...keep, ...rest].join('/') || parts[0];
}
