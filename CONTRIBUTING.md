# 参与 PatchVista 开发

普通使用者从 [README](README.md) 开始；本页面向修改源码、验证技能安装和准备分发的贡献者。

## 本地开发与测试

需要 Node.js 22.20+（推荐 24 LTS）、npm 和 Git。在源码根目录执行：

```bash
npm ci --prefix scripts --ignore-scripts
npm test --prefix scripts
```

测试覆盖离线渲染、CLI 入口、主题切换与存储、文字对比度、图标完整性及菜单回归。报告交互的历史验证记录见 [UI / UX 审查](docs/ui-review.md)。

| 路径 | 职责 |
| --- | --- |
| `SKILL.md` | Agent 的采集、分析与渲染工作流。 |
| `scripts/patchvista.mjs` | CLI 入口：`collect`、`show`、`render`。 |
| `scripts/lib/` | Git 比较、实体提取、引用分析与 HTML 渲染。 |
| `scripts/template/` | 报告 HTML、CSS、前端脚本、图标与字体。 |
| `references/analysis-schema.md` | Agent 生成的分析格式。 |
| `docs/assets/` | README 品牌图与公开示例截图。 |

更新模板后可对已有输出目录重新运行 `render`，不必重复采集。改变数据格式时，需验证采集产物与渲染器一致。

## 准备干净源码副本

本地路径安装可能复制 Git 忽略的内容，**不要直接把含有 `.local/` 或 `node_modules/` 的开发目录交给安装工具**。`.local/` 可能包含私有仓库、源码摘要和报告。

以下命令从源码根目录执行，创建白名单副本。它不会覆盖已有目标目录，也不会复制临时数据或已安装依赖：

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

然后在目标项目目录执行：

```bash
npx skills add "$HOME/patchvista-install-source" --skill patchvista
```

验证指定 Agent 的非交互复制安装，可在隔离的目标项目目录运行：

```bash
npx skills add "$HOME/patchvista-install-source" \
  --skill patchvista --agent claude-code --copy --yes
```

按[手动运行指南](docs/usage.md#手动生成第一份报告)验证依赖安装、采集和渲染。不要将生成的测试仓库或报告提交到源码仓库。

## 分发方式

技能文件通过源码分发；npm 负责安装运行依赖，项目不需要发布到 npm。当前尚未提供公开仓库安装地址。

建立 Git 仓库后，提交技能、文档、许可证、源码、模板以及 `scripts/package.json` / `scripts/package-lock.json`。保留 `.gitignore` 对 `node_modules/`、`.local/` 和 `.DS_Store` 的排除；提交前检查 `git status --short` 与 `git diff --cached --stat`。已经跟踪的文件不会因新增忽略规则自动移除。

公开仓库就绪后，再将 README 的本地安装步骤补充为真实的 Git 源安装命令。

## 许可证与发布检查

项目代码与技能文档使用 [ISC](LICENSE)。第三方依赖适用各自许可证；报告内嵌 Cytoscape 和 ELK，分发 HTML 时也需要遵守相应许可要求。

图标为 [Lucide](https://lucide.dev/) 1.73.0 的 SVG 子集，使用 ISC 许可；部分源自 Feather 的图标适用 MIT。[完整许可](scripts/template/lucide-LICENSE.txt)随源码与报告保留，无需 CDN。

字体 `scripts/template/fonts/patchvista-mono.woff2` 使用 CSS 别名 `PatchVista Mono`，用于界面、代码和关系图标签；中文等缺失字形由系统字体补足。渲染时会将字体嵌入 HTML。

发布前还应检查示例、截图、`facts.json`、`digest.md`、`analysis.json` 和 HTML 是否包含私有源码、配置或本机路径。README 截图使用自建示例，不使用真实业务仓库的数据。
