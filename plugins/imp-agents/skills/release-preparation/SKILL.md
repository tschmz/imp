---
name: release-preparation
description: Use this skill when the user wants to prepare, document, version, tag, or validate a software release.
---

# Release Preparation

Use this skill for release preparation in any software repository. Fit the repository's existing release process first; only propose a new process when there is no established one.

## Core Rules

- Do not invent release notes. Ground every user-facing release note in commits, tags, changelog history, pull requests, or the relevant diff.
- Prefer repository-local conventions over generic templates when they exist.
- Cover all relevant commits since the previous release. A commit should either be represented in the release notes or intentionally excluded with a short reason in the final report.
- Do not push, publish, deploy, or create a public release unless the user explicitly asks.
- Do not rewrite release history, retag an existing published version, or delete tags unless the user explicitly asks and the risk is clear.

## Find The Existing Release Pattern

Before editing release files, inspect the repository for prior release conventions:

1. Find release tags:

   ```sh
   git tag --sort=-creatordate
   git describe --tags --abbrev=0
   ```

2. Inspect recent release commits and tags:

   ```sh
   git log --decorate --oneline --max-count=50
   git show --no-patch <tag>
   git show <tag>:package.json
   ```

   Adapt the package/version file to the repository, for example `pyproject.toml`, `Cargo.toml`, `.csproj`, `pom.xml`, or a language-specific lockfile.

3. Check release documentation and changelog style:

   ```sh
   ls
   find . -maxdepth 3 -iname '*changelog*' -o -iname '*release*'
   sed -n '1,160p' CHANGELOG.md
   ```

4. Inspect commits since the previous release:

   ```sh
   git log --reverse --format='%H%x09%s' <last_tag>..HEAD
   git diff --stat <last_tag>..HEAD
   ```

Use the discovered pattern for section names, date format, version prefixes, tag format, release commit message, validation commands, and whether generated files or lockfiles are updated.

## First Release

If there is no prior release pattern, pause before making release-file changes and propose a best-practice format to the user. Keep it concrete and discuss the tradeoffs.

Recommended default:

- Semantic Versioning for version numbers.
- Annotated Git tags named `vX.Y.Z`.
- A `CHANGELOG.md` using a "Keep a Changelog" style shape:
  - `## X.Y.Z - YYYY-MM-DD`
  - `### Added`
  - `### Changed`
  - `### Fixed`
  - `### Removed`
  - `### Security`
- Release notes derived from commits since the previous release point, not from memory.
- A release commit named `chore: release X.Y.Z`, unless the repository uses another convention.

Ask the user to confirm or adjust this format before creating the first release metadata.

## Prepare The Release

1. Determine the release range.
   - Use `<last_tag>..HEAD` when a previous tag exists.
   - For a first release, use the full project history or the user-confirmed baseline.

2. Classify every relevant commit.
   - `feat:` usually maps to `Added`.
   - `fix:` usually maps to `Fixed`.
   - `refactor:`, `perf:`, and behavior-changing internal work usually map to `Changed`.
   - `docs:`, `test:`, `build:`, and `chore:` are usually omitted unless they affect user, operator, packaging, or release behavior.
   - If the repository already uses different categories, follow them.

3. Choose the next version.
   - If the user gives a target version, use it.
   - Otherwise infer a version from the established repository policy.
   - If no policy exists, recommend a SemVer bump and explain the reason.

4. Update release files.
   - Update changelog or release notes in the existing style.
   - Update version files and lockfiles consistently.
   - Keep unrelated cleanup out of the release commit.

5. Validate using repository conventions.
   - Prefer documented commands from `README`, `CONTRIBUTING`, `AGENTS.md`, CI config, package scripts, or previous release notes.
   - If no commands are documented, propose a reasonable minimal validation set and state the assumption.

6. Before committing or tagging, audit coverage.
   - Compare the commit list against the release notes.
   - Confirm version files agree.
   - Confirm the tag name matches the version.

7. Create release metadata only when requested or when it is clearly part of the task.
   - Release commit example: `git commit -am "chore: release X.Y.Z"`
   - Annotated tag example: `git tag -a vX.Y.Z -m "vX.Y.Z"`

8. Verify the result:

   ```sh
   git show --no-patch <tag>
   git show <tag>:<version-file>
   git status --short
   ```

## Final Report

Report:

- release range and target version
- files changed
- validation commands run and their results
- commits intentionally omitted from release notes, with reasons
- whether a release commit, tag, push, publish, or deploy was performed
