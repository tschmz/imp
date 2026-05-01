---
name: skill-creator
description: Use this skill to create a skill for yourself.
---

# Skill Creator

Use this skill to add new skills for yourself.

{{#if agent.home}}
Create these skills under `{{agent.home}}/.skills/<skill-name>`.
{{else}}
Your home path is not available in this turn. Ask the user for the target directory before creating a skill.
{{/if}}

## Hard Rules

- Create skills under `{{agent.home}}/.skills/<skill-name>`.
- Put the main instructions in `SKILL.md`.
- Keep skill names lowercase with hyphens: `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- Write the `description` as a direct statement of what the skill helps you do. Avoid phrasing it as "when the user asks".
- Keep the body procedural and short. Put only instructions needed at use time.
- Add `references/` only for optional longer guidance that should be read on demand.
- Add `scripts/` only when the workflow needs repeatable executable helpers.
- Avoid `README.md`, changelogs, install notes, and placeholder files inside the skill.

## Location And Discovery

Use this skill directory:

```text
{{agent.home}}/.skills/<skill-name>
```

Directory shape:

```text
{{agent.home}}/
  .skills/
    hello-world/
      SKILL.md
      scripts/
        say-hello.sh
      references/
        hello-world.md
```

The runtime scans one directory level below `.skills`. Each child directory with a `SKILL.md` file is one skill.

A newly created or changed skill is available on your next turn. The current turn's skill list was already resolved before the skill was written.

## Validation

- Check that the skill is a direct child of `{{agent.home}}/.skills`.
- Check that `name` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and stays under 64 characters.
- Check that the YAML frontmatter contains at least `name` and `description`; additional metadata may be present but should not be required for basic skill loading.
- Check that `SKILL.md` starts with valid YAML frontmatter. Prefer a concrete example over placeholders:

```markdown
---
name: hello-world
description: Use this skill to generate a hello-world greeting for yourself.
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

- Skills are re-discovered on each user turn; edits under auto-discovered catalogs do not require a daemon restart.
- `load_skill` returns the selected `SKILL.md` body and lists bundled `scripts/` and `references/` files.
- `load_skill` does not read bundled resource contents automatically. Write skills so `SKILL.md` tells the agent what to run or read without needing to inspect script contents first; bundled scripts should usually be executable helpers, not files the agent must read to understand the workflow.
