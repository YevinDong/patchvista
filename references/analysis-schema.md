# analysis.json

All ids are short ids from digest.md: `e*` entity, `c*` context entity, `r*` resource, `f*` file. Markdown fields support `**bold**`, `` `code` ``, lists, and `[[e12]]` chips.

**Write every human-readable string in the user's language** (the language the user wrote in); the examples below are in English only for illustration.

```jsonc
{
  "title": "One-line title (shown in the page header)",
  "summary": "markdown: what this batch of changes does overall and why, the 3-5 places that most need a human, suggested order",

  // Array order = suggested review order
  "changeSets": [
    {
      "id": "billing",                       // any unique string
      "title": "④ Billing can join the caller's transaction",
      "summary": "markdown: what this group changes and why",
      "reviewHint": "markdown list: what exactly to check while reviewing",
      "risk": "high | medium | low",
      "entities": ["e3", "e6", "e7"],        // entities in this change set (required)
      "reviewOrder": ["e3", "e6", "e7"],     // optional: reading order of entities; unlisted ones come last
      "files": ["f5"],                       // optional: files without entities (SQL migrations, .env, docs…)
      "resources": ["r19"]                   // optional: related resources
    }
  ],

  // Risks you found; shown together with rule-generated risks
  "risks": [
    {
      "level": "high | medium | low",
      "title": "Short title",
      "detail": "Concrete scenario and cause",
      "entities": ["e223"],
      "refs": [{ "file": "src/a.ts", "line": 161 }]   // must actually exist
    }
  ],

  // One-line note for key entities (shown at the top of entity details and in the change set's reading list)
  "entityNotes": { "e223": "Final delivery state: …" },

  "skim": []   // optional: entities that can be skimmed
}
```
