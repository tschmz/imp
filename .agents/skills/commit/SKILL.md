---
name: commit
description: Use this skill when creating commits in this repository; enforce the repository commit message format.
---

# Commit Skill

When creating a commit in this repository:

1. Use commit messages in the form `type: summary`.
2. Do not use Conventional Commit scopes.
   - Good: `feat: add status endpoint`
   - Bad: `feat(cli): add status endpoint`
3. Keep the summary concise and imperative.
4. Before committing changes under `src/`, run `npm run check` and `npm test`; do not commit unless both pass.
5. Do not revert, overwrite, or discard unrelated user changes.
