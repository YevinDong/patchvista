# Using PatchVista

English | [简体中文](usage.md) · [← Back to README](../README.md)

When collaborating with an AI coding assistant, you typically only need to specify the review scope. The commands below show how to manually run extraction, generate reports, troubleshoot issues, or reuse existing analyses. Examples use Bash / Zsh.

---

## Generating Your First Report Manually

### 1. Install Runtime Dependencies

Navigate to the **root directory of the installed skill** (the directory containing both `SKILL.md` and `scripts/`), then run:

```bash
SCRIPTS="$(pwd)/scripts"
npm ci --prefix "$SCRIPTS" --ignore-scripts
```

**Requirements**: Node.js 22.20+ (Node 24 LTS recommended), npm, and Git. Dependencies are installed strictly into `scripts/node_modules/` based on `scripts/package-lock.json`, without executing lifecycle scripts. This step is only needed on first run or when dependencies are updated; `skills add` does not automatically install runtime dependencies.

### 2. Collect Diff Facts

Replace `REPO` with the absolute path to your Git repository, ensuring the `main` branch exists locally:

```bash
REPO="/absolute/path/to/repository"
OUT="$HOME/.patchvista/example-review"
node "$SCRIPTS/patchvista.mjs" collect --repo "$REPO" --base main --out "$OUT"
```

This command compares `HEAD` against `main` (using common ancestor `main...HEAD`) and produces:

- `facts.json`: Extracted code entities, diff hunks, static references, and detected resources.
- `digest.md`: A compact, structured summary designed for AI assistants to read.

Default output is stored under `~/.patchvista/<repo>/<branch-slug>/`. You can customize the location using `--out`.

### 3. Render HTML Report

Generate a standalone HTML report directly from the facts:

```bash
node "$SCRIPTS/patchvista.mjs" render --out "$OUT" --lang en --open
```

Your default browser will open `$OUT/report.html`. In headless or remote environments, simply copy `report.html` to your local machine and open it in any modern browser—no server or auxiliary JSON files required.

**To include AI summaries, intent grouping, and reading orders**:
Ask your AI assistant to read `digest.md`, generate an `analysis.json` file in the same output directory according to the [Analysis Schema](../references/analysis-schema.md), and then re-run the `render` command. If `analysis.json` is omitted, PatchVista automatically groups changes by module and applies rule-based risk heuristics.

---

## Selecting Review Scope

Add these flags after `collect --repo "$REPO"`. It is recommended to assign distinct `--out` directories for different review sessions.

| Target Scope | Command Flag | Comparison Semantics |
| --- | --- | --- |
| Current branch vs. default branch | `--base main` | `main...HEAD` (from common ancestor; standard PR diff) |
| `dev` branch vs. `main` | `--base main --head dev` | `main...dev` (ideal for inspecting pull requests) |
| Two exact branch endpoints | `--base main --head dev --two-dot` | `main..dev` (direct two-dot diff) |
| Single commit | `--commit abc1234` | Compared against its first parent commit |
| Working tree (uncommitted changes) | *(Omit `--base` and `--commit`)* | Compared against `HEAD`, including staged, unstaged, and untracked files |

> **Tip**: Add `--no-refs` to skip AST reference analysis when you only need a quick structural overview.

---

## Inspecting Specific Entities or Files

To inspect any entity or file ID found in `digest.md`:

```bash
node "$SCRIPTS/patchvista.mjs" show --out "$OUT" e1 f1
```

Here `e1` is an entity ID and `f1` is a file ID. This prints the associated patch and metadata, making it easy to cross-verify claims made in an analysis.

---

## Navigating the Interactive Report

| Action | How to Use |
| --- | --- |
| **Browse by File** | The left **Files** tab offers path search, directory collapse/expand, and extension filter chips. |
| **Browse by Intent** | The left **Review Paths** tab organizes changes into semantic sets. Press `j` / `k` to cycle through entities and `r` to mark as reviewed. |
| **Inspect Impact** | The center canvas toggles between **Module** and **Entity** views. Single-click to select; double-click to focus upstream callers and downstream dependencies. |
| **Filter Graph Elements** | The **Display** menu lets you show or hide unchanged callers, resources, tests, pure moves, and depth controls. |
| **Jump to Local Editor** | Select **VS Code**, **Cursor**, or **JetBrains** in the top bar, then click any file link to open it locally. |
| **Switch Language** | Click **EN** or **中文** in the top bar to toggle languages instantly without page reload. Your preference is saved locally. |
| **Appearance & Theme** | Choose **Light**, **Dark**, or **System** mode. |
| **Keyboard Accessibility** | Use `Tab` / `Shift+Tab` to navigate, `Enter` / `Space` to activate buttons. Use `Left` / `Right` arrows on splitters to resize panels, and `Home` to reset widths. |

Your theme mode, editor preference, language choice, and review progress are automatically stored in browser `localStorage`. When sharing the standalone `report.html` with teammates, each person reviews independently with their own local progress.

---

## Updating an Existing Report

- **Update Report Styling / Language**: Re-run `render` on the existing output folder to regenerate `report.html` from cached `facts.json` and `analysis.json`:
  ```bash
  node "$SCRIPTS/patchvista.mjs" render --out "$OUT" --lang en
  ```
- **Code Changes or Branch Updates**: Re-run `collect` to extract fresh facts, prompt the AI assistant to re-analyze, and run `render`.

> **Note**: Running `collect` on an existing output directory overwrites `facts.json` and moves the old `analysis.json` to `analysis.json.prev`. If you wish to preserve a previous review session, use a separate `--out` directory.

---

## Frequently Asked Questions

### Dependency installation failed
Verify `node --version` (>= 22.20 required), check network connectivity to npm registry, and ensure write permissions for the skill directory. Run:
```bash
npm ci --prefix "$SCRIPTS" --ignore-scripts
```

### Git cannot find the specified branch or commit
Run `git branch -a` or `git log --oneline -5` in the target repository to verify that the branch or commit object exists locally.

### Report missing AI summaries or review paths
Ensure `analysis.json` is present in the output folder. If `render` outputs warnings about `unknown ids` or entities `not in any change set`, ask your AI assistant to align its references with `digest.md` and re-render.

### `--open` does not launch the browser
Open the printed `report.html` file path directly in your browser. On headless servers, copy the HTML file to your local computer.
