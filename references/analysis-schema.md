# analysis.json

All ids are short ids from digest.md: `e*` entity, `c*` context entity, `r*` resource, `f*` file. Markdown fields support `**bold**`, `` `code` ``, lists, and `[[e12]]` chips.

```jsonc
{
  "title": "一句话标题（显示在页头）",
  "summary": "markdown：这批改动整体在做什么、为什么、最需要人看的 3-5 处、建议顺序",

  // 数组顺序 = 建议审阅顺序
  "changeSets": [
    {
      "id": "billing",                       // 任意唯一字符串
      "title": "④ 计费支持加入调用方事务",
      "summary": "markdown：这一组改了什么、意图",
      "reviewHint": "markdown 列表：审阅时具体该检查什么",
      "risk": "high | medium | low",
      "entities": ["e3", "e6", "e7"],        // 该改动集包含的实体（必填）
      "reviewOrder": ["e3", "e6", "e7"],     // 可选：实体的阅读顺序，未列出的排在后面
      "files": ["f5"],                       // 可选：没有实体的文件（SQL 迁移、.env、文档…）
      "resources": ["r19"]                   // 可选：相关资源
    }
  ],

  // AI 发现的风险，与规则风险一起显示
  "risks": [
    {
      "level": "high | medium | low",
      "title": "简短标题",
      "detail": "具体场景与原因",
      "entities": ["e223"],
      "refs": [{ "file": "src/a.ts", "line": 161 }]   // 必须真实存在
    }
  ],

  // 关键实体的一句话说明（显示在实体详情顶部，以及改动集的阅读列表里）
  "entityNotes": { "e223": "交付终态：…" },

  "skim": []   // 可选：可以略读的实体
}
```
