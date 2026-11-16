# 报告 UI / UX 审查

依据 Vercel 的 [web-design-guidelines skill](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) 及 [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines)。方法包括源码审查、Chrome 实际操作、关系图截图检查和 axe-core 自动检查。

## 已修复

- `scripts/template/theme.js:15` — 默认跟随系统；手动选择持久化；系统模式实时响应系统变化。主题在页面样式绘制前确定，存储不可用时退化为会话内选择。
- `scripts/template/app.css:9` — 使用明暗两套颜色变量，覆盖正文、选中态、状态标记、代码高亮和 diff。修复浅色选中行及次要标签的对比度。
- `scripts/template/report.html:19` — 三态外观按钮显示文字及选中状态；搜索、编辑器选择和图标按钮具有可访问名称。增加主标题及跳到详情的链接。
- `scripts/template/app.js:300` — 文件和目录改为原生按钮；键盘展开/折叠后保留焦点，类型过滤显示按下状态。
- `scripts/template/app.js:876` — 详情引用项使用原生按钮，替换只能鼠标点击的列表项；diff 区可聚焦后用键盘滚动。
- `scripts/template/app.js:1094` — 菜单限制在视口内，支持点击外部关闭与 Escape 返回触发按钮。修复过滤按钮重建后菜单意外关闭及焦点丢失。
- `scripts/template/app.js:1160` — 分隔线支持方向键调整和 Home 重置，限制面板宽度以保留关系图区域；窄屏切换为纵向布局。
- `scripts/template/lucide-icons.json` — 工具栏、导航、实体类别、资源、状态操作及关系图卡片统一为 Lucide SVG 子集；图标无需联网，许可随报告嵌入。

主题切换会更新关系图的卡片、分组和连线颜色，保留节点位置、缩放及当前选择。图的聚焦动画响应系统的减少动态效果设置。

## 验证结果

- `npm test --prefix scripts`：10 项通过，覆盖首次主题、三态持久化、系统变化、异常存储、跨标签页更新、文字对比度、图标完整性、离线渲染及菜单点击回归。
- Chrome 实测：手动选择刷新恢复、系统主题实时切换、显式选择不被系统覆盖、关系图视口保持、目录/过滤/审阅按钮键盘操作及焦点保持、分隔线调宽和重置。
- 视口：1600 × 1000 与 390 × 844；窄屏页面无整体横向溢出，过滤菜单保持在可见范围内。
- axe-core：修改前总览有 5 类违规；修改后的明暗总览、明暗 diff、黑色实体详情及窄屏抽查均未发现自动违规。部分场景仍有需要人工判断的对比度条目，关系图和 SVG 已通过截图检查。
- 报告无 HTTP(S) 资源请求，字体和图标在离线页面中加载。

## 保留的限制

- `scripts/template/app.js:594` — 大型报告的全局关系图仍可能过密，适合作为总览；阅读标签时应从文件或改动集聚焦。本次保留既有布局算法。
- `scripts/template/app.js:1038` — 当前范围、搜索和选中实体未同步到 URL，无法用链接精确分享某个审阅位置。
- 本次浏览器验证覆盖 Chrome；Safari、Firefox 和真实读屏软件尚未验证。自动检查结果不等同于完整的无障碍认证。
