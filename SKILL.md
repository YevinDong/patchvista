---
name: patchvista
license: ISC
compatibility: Requires Node.js 22.20+ with npm, Git, and npm registry access for initial dependency installation.
description: Turn a git diff, branch comparison or single commit into an interactive single-file HTML review report. Changed entities (functions, classes, interfaces, config, SQL, Redis, MQ…) become cards with call relationships and blast radius, and the AI adds change intent, grouped change sets, a suggested reading order and risks. Use when the user wants to review a large (especially AI-generated) set of changes, compare two branches, asks "what did this branch change / what does it affect / who calls this", or wants a visual diff. Supports TS/JS (precise references) and Go/Python (name-based matching). 中文触发词：审阅改动、这个分支改了什么、影响哪些地方、谁调用了它、diff 可视化。
---

# PatchVista

Output: `<out>/report.html` — an offline single file that opens directly in a browser. Three steps: **collect (deterministic facts) → analyze (you write analysis.json) → render**.

## Language

Decide the **user language** from the language the user writes in (Chinese or English). Then:

- Write everything in `analysis.json` that a human reads — `title`, `summary`, change-set titles and summaries, `reviewHint`, `risks`, `entityNotes` — in the user language. Do not mix languages (code identifiers and file paths excepted). The report's EN / 中文 toggle only translates the UI and rule-generated risks, **never your text**, so get it right the first time.
- Pass `--lang` to `render` to match (see step 3).
- Reply to the user in the user language too.
- `digest.md` and the CLI output are always English, whatever the user language is.

## Setup

Requires Node.js 22.20+ (24 LTS recommended, includes npm) and Git. The first install needs access to the npm registry; the HTML report itself works offline.

Treat the directory containing the **currently loaded `SKILL.md`** as the skill root and set the absolute path of its `scripts/` to a variable `SCRIPTS` (used below as `$SCRIPTS`). Do not infer it from the working directory, and do not hard-code any agent's install path.

On first use, when `scripts/package-lock.json` changes, or when dependencies are missing:

```bash
npm ci --prefix "$SCRIPTS" --ignore-scripts
```

`skills add` only installs the skill files; the command above installs runtime dependencies from the lockfile without running their lifecycle scripts. Dependencies live in the skill's `scripts/node_modules/` and must not be committed. If installation fails, fix the Node.js version, network or directory write permissions first, then run the scripts.

Review artifacts contain source code, diffs and local paths. They are saved under `~/.patchvista/` by default; check them for sensitive content before sharing.

## 1. Pick the comparison range and collect

Choose the range from what the user said (when unsure, run `git branch -a` / `git log --oneline -5` first):

| User intent | Arguments |
|---|---|
| Current branch vs. dev/main (PR view, default three-dot merge-base) | `--base dev` (`--head` defaults to HEAD) |
| Compare two branches directly | `--base A --head B`; add `--two-dot` for a strict two-dot comparison |
| A single commit | `--commit <sha>` |
| Uncommitted working-tree changes | pass neither base nor commit |

```bash
node "$SCRIPTS/patchvista.mjs" collect --repo <repo> --base <ref> [--head <ref>]
```

Prints JSON: `{out, facts, digest, digestLines, stats}`. The default output directory is `~/.patchvista/<repo>/<range>`. A TS repo with up to 100 files usually takes 10–40 seconds (a temporary worktree is created for head and the TypeScript LanguageService runs). `--no-refs` skips reference analysis and is only meant for quick previews.

## 2. Read the digest, write analysis.json

Read `<out>/digest.md` in full first. It is a compact form of facts.json:

- `e12 M method X.y +3/-1 sig± in:[c3*,e5] tests:2 out:[...] res:[r4:db:user(write+)]`
  - `e*` changed entity, `c*` unchanged context entity, `r*` resource, `f*` file
  - `in` = who references it; `*` means that caller was **not modified** in this change. `out` = calls added in this change. `sig±` = signature changed
  - `MV` pure move, `RN` rename, `formerCallers` = callers a deleted entity used to have
  - `module (module)` = top-level code in a file that belongs to no declaration (imports, `app.use(...)` / route registration, scheduled-job registration, script-style code…). `imports-only` means only imports changed and the entity can stay ungrouped
- Heuristic risks are rule-generated — **verify them yourself**

For details, use `show` to print an entity's or file's diff (do not guess code behavior):

```bash
node "$SCRIPTS/patchvista.mjs" show --out <out> e117 e223 f5
```

You can also read the repository source or `git log` directly. For any important conclusion (a risk, a behavior change), `show` it at least once to confirm.

Then write `<out>/analysis.json`; the format is in [references/analysis-schema.md](references/analysis-schema.md). Key points:

- **changeSets are the core.** Group by *intent*, not by directory (one change set = one change that can be understood on its own, e.g. "billing can join the caller's transaction"). Array order is the suggested review order: infrastructure / depended-upon code first, consumers after; pure moves and boilerplate last, marked `risk: low`
- Every non-test, non-pure-move, non-`imports-only` `e*` should land in some change set (render warns about omissions; omitted ones fall into "Other changes"). With many entities, use a small node script to bulk-assign sids from facts.json by file-path rules, then hand-write titles, summaries and hints — more reliable than copying hundreds of ids by hand
- Make `reviewHint` and `risks` concrete: name the function, the scenario, and why it might break. Reference entities as `[[e12]]` (rendered as clickable chips); every `file:line` in `refs` must actually exist
- `entityNotes` gives a one-line "what this change did" for key entities; it does not need to cover every entity
- Do not restate the diff. Write what reading the diff will not tell you: intent, cross-file cause and effect, behavior changes, omissions

## 3. Render

```bash
node "$SCRIPTS/patchvista.mjs" render --out <out> --open --lang <en|zh>
```

**Always pass `--lang` for the user language**: Chinese → `--lang zh`, English → `--lang en`. For any other language, pick the closest UI language (only en and zh exist today) and still write `analysis.json` in the user language. Without `--lang` the report falls back to the browser's saved choice, then the browser language, which may not match the language of `analysis.json`.

If stderr shows an `unknown ids` or `not in any change set` warning, fix analysis.json and re-render. Finally, tell the user the report path (in the user language) and summarize in a few sentences: what changed, where to start reading, and the 2–3 highest risks.

## Using the report (relay to the user if useful)

- The top bar has an **EN / 中文** toggle for the UI language; pick "Light / Dark / System" at the top right (default follows the system). Manual choices are saved in localStorage. Theme, icons and fonts are embedded, so it works offline
- The left panel shows the **Files** tree by default, with path search, folder collapsing and extension filters; switch to **Review Paths** to go through change sets one by one, then press `j` / `k` to step through entities and `r` to mark one reviewed (progress is saved in the browser's localStorage)
- Center graph: Module view ↔ Entity view. Click a node for details, double-click to focus its upstream and downstream; the **Display** menu toggles unchanged callers, resources, tests and pure moves
- Right panel: signature changes, callers (split into modified / unmodified / tests), resource reads and writes, logs, code diff; file paths open directly in VS Code / Cursor / JetBrains
- Tab to focus a button, then Enter / Space to activate it; panel splitters support the Left/Right arrow keys to resize and Home to reset; narrow screens stack vertically

## Limitations

- TS/JS references come from the TypeScript LanguageService (accurate); Go/Python are matched by name (with a confidence marker) and can produce false positives and misses
- Resources (DB / Redis / MQ / config / routes…) are recognized by regex rules; dependency injection, reflection and dynamic strings cannot be detected
- When the user wants something PatchVista cannot provide (e.g. runtime behavior), say so plainly
