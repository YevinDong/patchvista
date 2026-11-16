# 使用 PatchVista

[← 返回 README](../README.md)

使用 AI 助手时，通常只需说明审阅范围。下面的命令用于手动生成报告、排查问题或复用已有分析；示例使用 Bash / Zsh。

## 手动生成第一份报告

### 1. 安装运行依赖

进入**已安装技能的根目录**，即同时包含 `SKILL.md` 和 `scripts/` 的目录，再执行：

```bash
SCRIPTS="$(pwd)/scripts"
npm ci --prefix "$SCRIPTS" --ignore-scripts
```

需要 Node.js 22.20+、npm 和 Git。依赖按 `scripts/package-lock.json` 安装到技能自身的 `scripts/node_modules/`，不执行依赖生命周期脚本。首次运行或锁文件更新后需要执行这一步；`skills add` 不会代为安装运行依赖。

### 2. 采集改动

将 `REPO` 换成待审 Git 仓库的绝对路径，确认本地存在 `main`：

```bash
REPO="/absolute/path/to/repository"
OUT="$HOME/.patchvista/example-review"
node "$SCRIPTS/patchvista.mjs" collect --repo "$REPO" --base main --out "$OUT"
```

此命令比较当前 `HEAD` 相对 `main` 的改动，并输出：

- `facts.json`：代码实体、diff、引用及资源关系。
- `digest.md`：供 AI 阅读的紧凑摘要。

默认使用共同祖先比较，即 `main...HEAD`。默认存储根目录为 `~/.patchvista/`；你也可以通过 `--out` 指定其他位置。

### 3. 生成 HTML

直接生成一份事实报告：

```bash
node "$SCRIPTS/patchvista.mjs" render --out "$OUT" --open
```

浏览器将打开 `$OUT/report.html`。没有桌面环境时，将该 HTML 文件复制到本机再打开，无需复制其余 JSON 文件或启动服务器。

**要加入 AI 摘要、意图分组和审阅顺序**，让助手阅读 `digest.md`，按[分析格式](../references/analysis-schema.md)在同一输出目录写入 `analysis.json`，再执行上面的 `render` 命令。没有 `analysis.json` 时，报告使用自动分组和规则风险提示。

## 选择比较范围

以下参数加在 `collect --repo "$REPO"` 后；建议给不同审阅任务指定不同的 `--out`。

| 你要审阅什么 | 参数 | 比较语义 |
| --- | --- | --- |
| 当前分支相对主分支 | `--base main` | `main...HEAD`，从共同祖先开始。 |
| dev 相对 main | `--base main --head dev` | `main...dev`，适合 PR 视角。 |
| 两个分支的端点差异 | `--base main --head dev --two-dot` | `main..dev`，直接比较两个端点。 |
| 一个提交 | `--commit abc1234` | 该提交相对其第一父提交；替换为实际哈希。 |
| 尚未提交的改动 | 不传 `--base` / `--commit` | 相对 HEAD，包含暂存、未暂存及未被忽略的未跟踪文件。 |

需要快速预览时可加 `--no-refs`，跳过引用分析；此时调用关系与影响范围信息会减少。

## 查看某个实体或文件

使用 `digest.md` 中的 ID：

```bash
node "$SCRIPTS/patchvista.mjs" show --out "$OUT" e1 f1
```

`e1` 表示改动实体，`f1` 表示文件；按实际摘要中的 ID 替换。输出对应的 diff，方便核实分析中的结论。

## 阅读与操作

| 操作 | 方法 |
| --- | --- |
| 按文件浏览 | 左侧「文件」支持路径搜索、目录折叠和后缀过滤。 |
| 按意图浏览 | 左侧「审阅路径」进入改动集；`j` / `k` 切换实体，`r` 标记已审。 |
| 看影响范围 | 中间切换模块 / 实体视图；单击查看详情，双击聚焦上下游。 |
| 调整图中内容 | 「显示」菜单控制未改动调用方、资源、测试与纯移动等。 |
| 打开源码 | 选择 VS Code、Cursor 或 JetBrains 后点击文件路径；本机需有对应项目和编辑器。 |
| 切换外观 | 右上角选择「白色 / 黑色 / 系统」，首次跟随系统。 |
| 键盘操作 | Tab 聚焦按钮，Enter / 空格执行；分隔线用左右方向键调宽，Home 恢复默认。 |

主题、编辑器选择和审阅进度保存在浏览器 `localStorage`；存储被禁用时，主题仍可在本次会话切换。主题切换会保留关系图的缩放、位置和选择；窄屏采用上下排列。

大型报告建议从文件或改动集聚焦阅读。报告当前不支持用 URL 分享具体选中实体；分享 HTML 时，对方从自己的浏览器状态开始阅读。

## 更新已有报告

**只更新报告外观**：当数据格式兼容时，对原输出目录重新执行 `render`，即可复用 `facts.json` 和 `analysis.json`。

**改动内容或比较范围变化**：重新执行 `collect`，让助手重新分析，再 `render`。

> 在同一输出目录重新 `collect` 会重写事实，并将当前 `analysis.json` 移到 `analysis.json.prev`。它不是多版本备份；保留完整旧报告时，应使用不同输出目录。

## 常见问题

**依赖安装失败**  
检查 `node --version`、npm registry 网络和技能安装目录的写权限。修复后重新运行 `npm ci --prefix "$SCRIPTS" --ignore-scripts`。

**Git 提示找不到分支或提交**  
在待审仓库运行 `git branch -a` / `git log --oneline -5`，确认引用名正确且对应对象已在本地。

**报告没有 AI 摘要或审阅路径不符合预期**  
确认输出目录中存在 `analysis.json`。渲染时若提示 `unknown ids` 或 `not in any change set`，让助手根据本次 `digest.md` 修正引用和分组，再重新渲染。

**`--open` 没有打开浏览器**  
直接打开命令输出的 `report.html` 路径。无桌面环境可以复制文件到本机浏览器。
