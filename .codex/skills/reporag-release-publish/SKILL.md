---
name: reporag-release-publish
description: Use when a user asks about reporag versioning, semver bumps, release PRs, release-please, npm publishing, trusted publishing, release recovery, branch protection for release checks, or "versionado", "publicacion", or "despliegue" of the CLI.
---

# Reporag Release Publish

Use this skill for repo-specific release work in `reporag`: planning version bumps, reviewing release PRs, fixing release automation, publishing the CLI to npm, and recovering failed releases.

## Read first

Read these files before changing release behavior:

- `release-please-config.json`
- `.release-please-manifest.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release-please.yml`
- `.github/workflows/publish.yml`
- `package.json`
- `packages/cli/package.json`

Read `docs/release-checklist.md` only when the user needs the full manual/bootstrap checklist.

## Current release model

- `main` is protected. Prefer branch + PR, not direct pushes.
- Normal version bumps are automatic via `release-please`, not manual edits.
- The root `package.json` is the release anchor for `release-please`.
- Workspace versions and internal dependency pins are synchronized through `release-please-config.json` extra files and `scripts/release-sync.mjs`.
- Only `packages/cli` is published to npm.
- Bootstrap was manual with tag `v0.1.0`.
- Automated release tags are `reporag-vX.Y.Z`.
- Required PR checks for `main` are `ci` and `conventional-pr-title`.
- npm publishing uses trusted publishing from `.github/workflows/publish.yml`; do not introduce a long-lived `NPM_TOKEN`.

## Semver rules

- `fix:` produces a patch release.
- `feat:` produces a minor release.
- With squash merge enabled, the PR title becomes the commit title on `main`, so PR titles must follow Conventional Commits.
- Use the global `conventional-pr-title-release` skill for the cross-project rules around PR titles, squash merge, and Conventional Commit naming.
- In `reporag`, the repository-specific semver mapping is still: `fix:` => patch, `feat:` => minor.
- Do not hand-edit versions during normal releases unless the user explicitly asks for a manual repair or bootstrap-style publish.

## Standard workflow

1. Ensure the feature/fix PR title follows Conventional Commits before creating or updating the PR.
2. Let `ci` pass.
3. Merge into `main`.
4. Wait for `release-please` to open or refresh the release PR.
5. Review the release PR for:
   - synchronized versions in root and `packages/*/package.json`
   - `CHANGELOG.md`
   - the MCP version marker in `packages/app/src/mcp-server.ts`
6. Merge the release PR.
7. Verify the GitHub release and the `publish` workflow run.
8. Verify npm with `npm view reporag version dist-tags --json`.

## Publish recovery

- If the GitHub release exists but `publish` failed, inspect the failing step before changing code.
- `publish.yml` supports `workflow_dispatch`; use it with tag `reporag-vX.Y.Z` to retry a publish for an existing release.
- `publish.yml` is expected to be idempotent: if the version already exists on npm, the workflow should exit green after the existence check.
- If the failure is in workflow syntax or action configuration, fix the workflow on a branch, merge it to `main`, and then rerun `publish` manually for the existing tag.

## Manual/bootstrap cases

- Use manual publish only for bootstrap or when the user explicitly wants to bypass automation.
- Follow `docs/release-checklist.md` for manual publish commands and post-release validation.
- The baseline validation commands are:
  - `npm run release:validate`
  - `npm run smoke:pack`
  - `npm view reporag version dist-tags --json`

## Branch protection and GitHub setup

When the user asks to protect `main`, the target setup is:

- pull request required
- conversation resolution required
- linear history required
- block force pushes
- restrict deletions
- required checks: `ci`, `conventional-pr-title`

Do not require `release-please` as a PR check on normal development PRs.

If the ruleset UI does not show checks yet, wait for successful workflow runs or trigger a new PR/main run before trying again.

## Editing rules

- Preserve existing workflow names and trigger shapes.
- Keep `publish.yml` runnable from both `release.published` and `workflow_dispatch`.
- Before changing release automation, check current `origin/main`, current release tags, and whether the target change is already merged.
- Use `apply_patch` for manual edits.
