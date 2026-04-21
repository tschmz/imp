---
name: imp-skill-creator
description: Use this skill when creating or updating skills for `Imp`.
---

# Imp Skill Creator

Create or update `Imp` skills.

## Drafting Workflow

1. Identify the target catalog root from the user's intent:
{{#each imp.skillCatalogs}}
  - {{label}}: `{{path}}`
{{/each}}
   - workspace catalog: `{{imp.dynamicWorkspaceSkillsPath}}`
2. Create `<catalog-root>/<skill-name>/SKILL.md`.
3. Write a concise `description` that includes the action and the user requests that should trigger the skill.
4. Keep the body procedural and short. Put only instructions another agent needs at use time.
5. Add `references/` only for optional longer guidance that should be read on demand.
6. Add `scripts/` only when the workflow needs repeatable executable helpers.
7. Avoid `README.md`, changelogs, install notes, and placeholder files inside the skill.

## Validation

- Check that the skill is a direct child of the catalog root.
- Check that `name` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and stays under 64 characters.
- Check that the YAML frontmatter contains only `name` and `description` unless the codebase proves imp accepts more.
- Check that `SKILL.md` starts with valid YAML frontmatter:

```markdown
---
name: example-skill
description: Do the thing. Use when the user asks for the thing.
---
```

- Check that `description` is not empty and is under 1024 characters.
- If this repo is available, compare assumptions against `src/skills/discovery.ts` before changing the format.

## Runtime Notes

- `Imp` re-discovers auto-discovered skills on each user turn; edits under auto-discovered catalogs do not require a daemon restart.
- `load_skill` returns the selected `SKILL.md` body and lists bundled `scripts/` and `references/` files.
- `load_skill` does not read bundled resource contents automatically; mention in `SKILL.md` when a reference or script should be inspected or run.
- If the same skill exists in multiple catalogs, the later entry wins.
