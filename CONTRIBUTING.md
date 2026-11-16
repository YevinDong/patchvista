# Contributing to PatchVista

End users should start from the [README](README.md); this page is for contributors who change the source, verify skill installation, or prepare a distribution.

## Local development and testing

Requires Node.js 22.20+ (24 LTS recommended), npm and Git. From the source root:

```bash
npm ci --prefix scripts --ignore-scripts
npm test --prefix scripts
```

Tests cover offline rendering, the CLI entry point, theme switching and storage, text contrast, icon completeness and menu regressions. For the history of report-interaction reviews, see [UI / UX Review](docs/ui-review.md).

| Path | Responsibility |
| --- | --- |
| `SKILL.md` | The agent's collect, analyze and render workflow. |
| `scripts/patchvista.mjs` | CLI entry point: `collect`, `show`, `render`. |
| `scripts/lib/` | Git comparison, entity extraction, reference analysis and HTML rendering. |
| `scripts/template/` | Report HTML, CSS, front-end script, icons and fonts. |
| `references/analysis-schema.md` | Format of the analysis the agent produces. |
| `docs/assets/` | README brand images and public sample screenshots. |

After changing the template you can re-run `render` on an existing output directory without collecting again. When you change the data format, verify that the collected artifacts and the renderer still agree.

## Preparing a clean source copy

A local-path install may copy Git-ignored content, so **do not hand a development directory that contains `.local/` or `node_modules/` straight to the installer**. `.local/` may hold private repositories, source digests and reports.

The commands below, run from the source root, create an allow-list copy. They do not overwrite an existing target directory, and they do not copy temporary data or installed dependencies:

```bash
EXPORT="$HOME/patchvista-install-source"
( set -e
  set -o pipefail
  mkdir "$EXPORT"
  tar --exclude=node_modules --exclude=.DS_Store -cf - \
    SKILL.md README.md LICENSE CONTRIBUTING.md references scripts docs \
    | tar -xf - -C "$EXPORT"
)
```

Then, from the target project directory:

```bash
npx skills add "$HOME/patchvista-install-source" --skill patchvista
```

To verify a non-interactive copy install for a specific agent, run this in an isolated target project directory:

```bash
npx skills add "$HOME/patchvista-install-source" \
  --skill patchvista --agent claude-code --copy --yes
```

Follow the [manual usage guide](docs/usage.en.md#generating-your-first-report-manually) to verify dependency installation, collection and rendering. Do not commit generated test repositories or reports to the source repository.

## Distribution

Skill files are distributed as source; npm only installs runtime dependencies, and the project does not need to be published to npm. There is no public repository install address yet.

Once the Git repository exists, commit the skill, docs, license, source, templates, and `scripts/package.json` / `scripts/package-lock.json`. Keep the `.gitignore` entries for `node_modules/`, `.local/` and `.DS_Store`; check `git status --short` and `git diff --cached --stat` before committing. Files that are already tracked are not removed by adding new ignore rules.

When the public repository is ready, replace the local-install steps in the README with the real Git-source install command.

## Licensing and distribution audit

Project code and skill docs use the [ISC License](LICENSE). Third-party dependencies are covered by their own licenses; the report embeds Cytoscape and ELK, so distributing the HTML also means honoring their license terms.

Icons are an SVG subset of [Lucide](https://lucide.dev/) 1.73.0 under the ISC License; some icons derived from Feather are under MIT. The [full license text](scripts/template/lucide-LICENSE.txt) ships with the source and the report, no CDN needed.

The font `scripts/template/fonts/patchvista-mono.woff2` uses the CSS alias `PatchVista Mono` for the UI, code and graph labels; glyphs it lacks (such as Chinese) fall back to system fonts. The font is embedded into the HTML at render time.

Before publishing, also check that examples, screenshots, `facts.json`, `digest.md`, `analysis.json` and the HTML contain no private source, configuration or local paths. README screenshots come from a purpose-built sample, not from a real business repository.
