import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'pipe'],
  });
}

export function tryGit(repo, args) {
  try {
    return git(repo, args, { quiet: true });
  } catch {
    return null;
  }
}

export function repoRoot(dir) {
  return git(dir, ['rev-parse', '--show-toplevel']).trim();
}

function revParse(repo, rev) {
  return git(repo, ['rev-parse', '--verify', `${rev}^{commit}`]).trim();
}

/**
 * Resolve the comparison into concrete old/new sides.
 * new side `sha === null` means the working tree.
 */
export function resolveRange(repo, opts) {
  if (opts.commit) {
    const sha = revParse(repo, opts.commit);
    const parent = tryGit(repo, ['rev-parse', '--verify', `${sha}^`])?.trim();
    return {
      mode: 'commit',
      label: `${opts.commit} (single commit)`,
      old: { ref: `${opts.commit}^`, sha: parent ?? emptyTree(repo) },
      new: { ref: opts.commit, sha },
    };
  }
  if (opts.base) {
    const head = opts.head ?? 'HEAD';
    const baseSha = revParse(repo, opts.base);
    const headSha = revParse(repo, head);
    const oldSha = opts.twoDot ? baseSha : git(repo, ['merge-base', baseSha, headSha]).trim();
    return {
      mode: opts.twoDot ? 'two-dot' : 'branch',
      label: `${opts.base}${opts.twoDot ? '..' : '...'}${head}`,
      old: { ref: opts.base, sha: oldSha },
      new: { ref: head, sha: headSha },
    };
  }
  // default: uncommitted changes (staged + unstaged + untracked) against HEAD
  return {
    mode: 'worktree',
    label: 'HEAD → working tree (uncommitted)',
    old: { ref: 'HEAD', sha: revParse(repo, 'HEAD') },
    new: { ref: 'WORKTREE', sha: null },
  };
}

function emptyTree(repo) {
  return git(repo, ['hash-object', '-t', 'tree', '/dev/null']).trim();
}

/** Returns [{status, path, oldPath, similarity, additions, deletions, binary}] */
export function changedFiles(repo, range) {
  const target = range.new.sha ? [range.old.sha, range.new.sha] : [range.old.sha];
  const nameStatus = git(repo, ['diff', '--name-status', '-M', '-z', ...target]);
  const numstat = git(repo, ['diff', '--numstat', '-M', '-z', ...target]);

  const parts = nameStatus.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    const status = code[0];
    if (status === 'R' || status === 'C') {
      files.push({ status, similarity: Number(code.slice(1)), oldPath: parts[i++], path: parts[i++] });
    } else {
      const p = parts[i++];
      files.push({ status, path: p, oldPath: status === 'A' ? null : p });
    }
  }

  // numstat -z: "add\tdel\tpath\0" or "add\tdel\t\0old\0new\0"
  const stats = new Map();
  const np = numstat.split('\0');
  for (let i = 0; i < np.length; i++) {
    const rec = np[i];
    if (!rec) continue;
    const [a, d, p] = rec.split('\t');
    let key = p;
    if (p === '') {
      key = np[i + 2];
      i += 2;
    }
    stats.set(key, { additions: a === '-' ? 0 : Number(a), deletions: d === '-' ? 0 : Number(d), binary: a === '-' });
  }

  if (range.mode === 'worktree') {
    const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    for (const p of untracked) {
      const text = safeRead(path.join(repo, p));
      files.push({ status: 'A', path: p, oldPath: null, untracked: true });
      stats.set(p, { additions: text == null ? 0 : text.split('\n').length, deletions: 0, binary: text == null });
    }
  }

  for (const f of files) Object.assign(f, stats.get(f.path) ?? { additions: 0, deletions: 0, binary: false });
  return files;
}

export function filePatch(repo, range, file) {
  if (file.untracked) {
    const text = safeRead(path.join(repo, file.path)) ?? '';
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') + '\n';
  }
  const target = range.new.sha ? [range.old.sha, range.new.sha] : [range.old.sha];
  const paths = file.oldPath && file.oldPath !== file.path ? [file.oldPath, file.path] : [file.path];
  const out = git(repo, ['diff', '-M', '-U3', '--no-color', ...target, '--', ...paths]);
  // drop header lines, keep from first hunk
  const idx = out.indexOf('\n@@');
  return idx === -1 ? '' : out.slice(idx + 1);
}

export function readSide(repo, sha, p) {
  if (!p) return null;
  if (sha === null) return safeRead(path.join(repo, p));
  return tryGit(repo, ['show', `${sha}:${p}`]);
}

function safeRead(p) {
  try {
    const buf = fs.readFileSync(p);
    if (buf.includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

export function listFiles(repo, sha) {
  const out = sha === null
    ? git(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    : git(repo, ['ls-tree', '-r', '--name-only', '-z', sha]);
  return out.split('\0').filter(Boolean);
}

/** Materialize a commit into a temp worktree so language services can read it. */
export function checkoutTree(repo, sha) {
  if (sha === null) return { dir: repo, cleanup: () => {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchvista-'));
  git(repo, ['worktree', 'add', '--detach', '--force', dir, sha], { quiet: true });
  return {
    dir,
    cleanup: () => {
      tryGit(repo, ['worktree', 'remove', '--force', dir]);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
