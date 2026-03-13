English | [Espanol](release-checklist.es.md)

# Release Checklist

## One-time setup

1. Create a GitHub secret named `RELEASE_PLEASE_TOKEN`.

Recommended: use a fine-grained PAT scoped to this repository with write access
to contents, pull requests, and issues so `release-please` can open and update
release PRs that still trigger normal CI.

2. Configure npm trusted publishing for this public repository.

Use the npm package `reporag` and point the trusted publisher to this GitHub
repository and workflow file:

- repository: `riclara/reporag`
- workflow file: `.github/workflows/publish.yml`
- environment: leave empty unless you later decide to gate publishes with a
  GitHub environment

3. After the workflows are merged into `main`, update the branch protection
ruleset to require these checks:

- `ci`
- `conventional-pr-title`

## Bootstrap 0.1.0

The first release stays manual. Publish `0.1.0` once, create the matching tag
and GitHub release, and let automation take over from `0.1.1` onward.

### Pre-release

1. Validate the build, tests, benchmark, and final tarball.

Expectation: the command must finish green, the fixture suite must satisfy
`fixture.passed === fixture.total`, and the self suite must satisfy
`self.passed === self.total`.

```bash
cd /Users/riclara/workspace/reporag
npm run release:validate
```

2. Inspect the benchmark report and confirm both suites are 100% passing:

```bash
sed -n '1,240p' /Users/riclara/workspace/reporag/.reporag/benchmark-report.json
```

3. Inspect the package contents that will be published and confirm the package
is CLI-only, with the bundle and README but without `dist/*.d.ts` in the
tarball:

```bash
cd /Users/riclara/workspace/reporag
NPM_CONFIG_CACHE=/tmp/reporag-npm-cache npm pack --dry-run ./packages/cli
```

4. Run the packed-tarball smoke test before publishing:

```bash
cd /Users/riclara/workspace/reporag
npm run smoke:pack
```

This smoke test packs `packages/cli`, installs the tarball into a temporary
directory, and validates `status`, `init`, `index`, `query`, `symbol`, and MCP
server startup against a fixture repository.

### Publish

1. Confirm the currently active npm account:

```bash
npm whoami
```

2. Publish the package:

```bash
cd /Users/riclara/workspace/reporag/packages/cli
NPM_CONFIG_CACHE=/tmp/reporag-npm-cache npm publish
```

3. Create the initial GitHub tag and release from `main`:

- tag: `v0.1.0`
- release title: `v0.1.0`

This tag is the hand-off point for `release-please`.
The `release-please` workflow stays idle until `v0.1.0` exists.

## Automated releases after 0.1.0

1. Use Conventional Commit PR titles such as `fix:`, `feat:`, `docs:`, or
   `chore:`. With squash merge enabled, that PR title becomes the commit title
   on `main`.

2. Merge the PR into `main`.

3. Wait for the `release-please` workflow to open or refresh the release PR.

4. Review the generated release PR:

- root and workspace versions should be synchronized
- `CHANGELOG.md` should describe the release
- the MCP server version marker should match the release version

5. Merge the release PR.

That merge creates the GitHub release/tag and triggers the `publish` workflow,
which runs `release:validate`, `smoke:pack`, and then publishes `packages/cli`
to npm.

6. If the version already exists on npm, the publish workflow exits successfully
without attempting to republish it.

## Post-release

1. Verify the package metadata in npm:

```bash
npm view reporag version dist-tags --json
```

2. Verify a fresh global install:

```bash
NPM_CONFIG_CACHE=/tmp/reporag-npm-cache npm install -g reporag
reporag status
```

3. Verify the main local workflow in a sample repository:

```bash
mkdir -p /tmp/reporag-smoke
cd /tmp/reporag-smoke
printf '{"name":"reporag-smoke","private":true}\n' > package.json
mkdir -p src
printf 'export function hello() { return 1; }\n' > src/index.ts
reporag init
reporag index
reporag query "hello"
reporag symbol hello
reporag mcp serve
```
