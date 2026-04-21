---
name: imp-skill-creator
description: Use this skill when creating or updating skills for `Imp`.
---

# Imp Skill Creator

Skills provide lightweight, task-focused features for `Imp` agents through short instructions plus optional bundled scripts and references.

## Drafting Workflow

1. Identify the target catalog root from the user's intent:
{{#each imp.skillCatalogs}}
  - {{label}}: `{{path}}`
{{/each}}
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
- Check that `SKILL.md` starts with valid YAML frontmatter. Prefer a concrete example over placeholders:

```markdown
---
name: hello-world
description: Use this skill when the user asks to greet the world.
---

# Hello World

1. Run `scripts/say-hello.sh`.
2. Read `references/hello-world.md`.
3. Tell the user whether the script succeeded and include one fact from the reference.
```

- When useful, show a fuller skill layout with bundled resources:

```text
hello-world/
  SKILL.md
  scripts/
    say-hello.sh
  references/
    hello-world.md
```

- Example bundled script:

```bash
#!/usr/bin/env bash
set -euo pipefail

target="${1:-world}"
printf 'Hello, %s!\n' "$target"
```

- Example bundled reference:

```markdown
# Hello World Reference

`Hello, World!` is the conventional first program in many languages.

## Interesting facts

- Brian Kernighan used `hello` and `world` together in a B tutorial from 1972, which is one of the earliest well-known ancestors of the pattern.
- A direct C `hello, world` example appeared in Brian Kernighan's Bell Labs memo `Programming in C: A Tutorial` in 1974.
- The phrase became widely known through the 1978 first edition of `The C Programming Language` by Brian Kernighan and Dennis Ritchie.
- Early canonical examples used `hello, world` in lowercase and without an exclamation mark.
- `Hello, World!` is often used as a smoke test to confirm that a language runtime, compiler, or development environment is working.
- In graphics programming, `Hello Triangle` often plays a similar role: the first milestone is to render one triangle on screen.
- `helloworldcollection.de` describes itself as a collection with 603 Hello World programs in programming languages plus 78 human languages.
```

## Runtime Notes

- `Imp` re-discovers auto-discovered skills on each user turn; edits under auto-discovered catalogs do not require a daemon restart.
- `load_skill` returns the selected `SKILL.md` body and lists bundled `scripts/` and `references/` files.
- `load_skill` does not read bundled resource contents automatically. Write skills so `SKILL.md` tells the agent what to run or read without needing to inspect script contents first; bundled scripts should usually be executable helpers, not files the agent must read to understand the workflow.
- If the same skill exists in multiple catalogs, the later entry wins.
