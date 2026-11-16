---
name: patchvista
license: ISC
compatibility: Requires Node.js 22.20+ with npm, Git, and npm registry access for initial dependency installation.
description: 把 git diff / 分支对比 / 某个 commit 变成可交互的单文件 HTML 审阅报告：改动实体（函数/类/接口/配置/SQL/Redis/MQ…）卡片化，展示调用关系与影响范围，并由 AI 给出改动意图、改动集分组、审阅顺序与风险。当用户要审阅一大批（尤其是 AI 生成的）改动、比较两个分支、问“这个分支改了什么/影响哪些地方/谁调用了它”、或想要 diff 的可视化时使用。支持 TS/JS（精确引用）、Go/Python（按名称匹配）。
---

# PatchVista

产物：`<out>/report.html`（离线单文件，可直接用浏览器打开）。流程分三步：**collect（确定性事实）→ 分析（你来写 analysis.json）→ render**。

## 运行准备

需要 Node.js 22.20+（推荐 24 LTS，含 npm）和 Git。首次安装依赖需要访问 npm registry；HTML 报告可离线打开。

以**当前加载的 `SKILL.md` 所在目录**为技能根目录，将其 `scripts/` 的绝对路径设置为变量 `SCRIPTS`（下文使用 `$SCRIPTS`）。不要根据当前工作目录推断，也不要写死某个 Agent 的安装路径。

首次使用、`scripts/package-lock.json` 更新或依赖缺失时执行：

```bash
npm ci --prefix "$SCRIPTS" --ignore-scripts
```

`skills add` 只安装技能文件；上述命令按锁文件安装运行依赖，不执行依赖的生命周期脚本。依赖保存在技能的 `scripts/node_modules/`，不要提交到 Git。安装失败时先处理 Node.js 版本、网络或目录写权限问题，再运行脚本。

审阅产物包含源码、diff 和本机路径，默认保存在 `~/.patchvista/`；对外分享前检查敏感内容。

## 1. 确定比较范围并 collect

根据用户的话选择范围（拿不准时先 `git branch -a` / `git log --oneline -5` 看一眼）：

| 用户意图 | 参数 |
|---|---|
| 当前分支相对 dev/main 的改动（PR 视角，默认三点 merge-base） | `--base dev`（`--head` 默认 HEAD） |
| 两个分支直接对比 | `--base A --head B`，严格两点比较再加 `--two-dot` |
| 某个 commit | `--commit <sha>` |
| 未提交的工作区改动 | 不传 base/commit |

```bash
node "$SCRIPTS/patchvista.mjs" collect --repo <repo> --base <ref> [--head <ref>]
```

输出 JSON：`{out, facts, digest, digestLines, stats}`。默认输出目录 `~/.patchvista/<repo>/<range>`。100 个文件以内的 TS 仓库通常 10–40 秒（需要对 head 做临时 worktree 并跑 TypeScript LanguageService）。`--no-refs` 可跳过引用分析，只用于快速预览。

## 2. 阅读 digest，写 analysis.json

先完整读 `<out>/digest.md`。它是 facts.json 的紧凑版：

- `e12 M method X.y +3/-1 sig± in:[c3*,e5] tests:2 out:[...] res:[r4:db:user(write+)]`
  - `e*` 改动实体，`c*` 未改动的上下文实体，`r*` 资源，`f*` 文件
  - `in` = 谁引用了它，`*` 表示调用方本次**未修改**；`out` = 本次新增的调用；`sig±` = 签名变了
  - `MV` 纯移动，`RN` 重命名，`formerCallers` = 被删实体原先的调用方
  - `module (module)` = 该文件中不属于任何声明的顶层代码（import、`app.use(...)`/路由注册、定时任务注册、脚本式代码等）；`imports-only` 表示只改了 import，可以不分组
- heuristic risks 是规则生成的，**要自己核实**

需要细节时用 `show` 查看实体或文件的 diff（不要盲猜代码行为）：

```bash
node "$SCRIPTS/patchvista.mjs" show --out <out> e117 e223 f5
```

也可以直接读仓库源码 / `git log`。对于重要结论（风险、行为变化），至少 `show` 一次确认。

然后写 `<out>/analysis.json`，格式见 [references/analysis-schema.md](references/analysis-schema.md)。要点：

- **changeSets 是核心**：按“意图”而非目录分组（一个改动集 = 一个可以独立理解的变化，例如“计费支持外部事务”）。数组顺序就是建议审阅顺序：先基础设施/被依赖方，后使用方；纯移动、样板代码放最后并标 `risk: low`
- 每个非测试、非纯移动、非 `imports-only` 的 `e*` 都应该落在某个改动集里（render 会提示遗漏；遗漏的会进入“其他改动”）。实体很多时，用一个小 node 脚本按文件路径规则从 facts.json 批量分配 sid，再手写标题/摘要/提示，比手抄几百个 id 可靠
- `reviewHint` / `risks` 要具体：指出哪个函数、什么场景、为什么可能出错；用 `[[e12]]` 引用实体（在报告中变成可点击的 chip）；`refs` 里的 `file:line` 必须真实存在
- `entityNotes` 给关键实体写一句话说明它“这次干了什么”，不必覆盖所有实体
- 不要复述 diff 本身，重点写读 diff 看不出来的东西：意图、跨文件的因果关系、行为变化、遗漏

## 3. render

```bash
node "$SCRIPTS/patchvista.mjs" render --out <out> --open
```

stderr 中如有 `unknown ids` 或 `not in any change set` 警告，修正 analysis.json 后重新 render。最后告诉用户报告路径，并用几句话概括：改了什么、建议从哪里看起、最高风险的 2–3 点。

## 报告怎么用（可转告用户）

- 右上角选择「白色 / 黑色 / 系统」，默认跟随系统；手动选择保存在 localStorage。主题、图标和字体均内嵌，离线可用
- 左侧默认显示「文件」树，支持路径搜索、目录折叠及后缀过滤；切换「审阅路径」可按改动集逐个看，点击后按 `j`/`k` 依次浏览实体，`r` 标记已审（进度保存在浏览器 localStorage）
- 中间图：模块视图 ↔ 实体视图；单击看详情，双击聚焦某节点的上下游；「显示」里可切换未改动调用方、资源、测试、纯移动
- 右侧：签名变化、调用方（区分本次改动/未改动/测试）、资源读写、日志、代码 diff；文件路径可直接在 VS Code / Cursor / JetBrains 打开
- Tab 聚焦按钮后用 Enter/空格操作；面板分隔线支持左右方向键调宽、Home 恢复默认，窄屏上下排列

## 局限

- TS/JS 引用来自 TypeScript LanguageService（准确）；Go/Python 是按名称匹配（带置信度标记），可能误报漏报
- 资源（DB/Redis/MQ/配置/路由…）是正则规则识别，依赖注入、反射、动态字符串无法识别
- 用户想要的东西 PatchVista 给不了时（比如运行时行为），直接说明
