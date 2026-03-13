English | [Espanol](release-checklist.es.md)

# Release Checklist

## Version 0.1.0

## Pre-release

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

## Publish

1. Confirm the currently active npm account:

```bash
npm whoami
```

2. Publish the package:

```bash
cd /Users/riclara/workspace/reporag/packages/cli
NPM_CONFIG_CACHE=/tmp/reporag-npm-cache npm publish --access public
```

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
