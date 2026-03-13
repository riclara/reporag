[English](release-checklist.md) | Espanol

# Checklist de Release

## Version 0.1.0

## Pre-release

1. Validar build, tests, benchmark y tarball final.

Expectativa: el comando debe terminar en verde, la suite de fixtures debe
cumplir `fixture.passed === fixture.total`, y la suite sobre el repo debe
cumplir `self.passed === self.total`.

```bash
cd /Users/riclara/workspace/reporag
npm run release:validate
```

2. Inspeccionar el benchmark report y confirmar que ambas suites estan en 100%:

```bash
sed -n '1,240p' /Users/riclara/workspace/reporag/.reporag/benchmark-report.json
```

3. Inspeccionar el contenido que se va a publicar y confirmar que el paquete es
solo CLI, con bundle y README, y sin contrato `dist/*.d.ts` en el tarball:

```bash
cd /Users/riclara/workspace/reporag
NPM_CONFIG_CACHE=/tmp/reporag-npm-cache npm pack --dry-run ./packages/cli
```

4. Ejecutar el smoke test del tarball antes de publicar:

```bash
cd /Users/riclara/workspace/reporag
npm run smoke:pack
```

Este smoke test empaqueta `packages/cli`, instala el tarball en un directorio
temporal y valida `status`, `init`, `index`, `query`, `symbol` y el arranque del
servidor MCP contra un repositorio fixture.

## Publish

1. Confirmar la cuenta de npm activa:

```bash
npm whoami
```

2. Publicar el paquete:

```bash
cd /Users/riclara/workspace/reporag/packages/cli
NPM_CONFIG_CACHE=/tmp/reporag-npm-cache npm publish --access public
```

## Post-release

1. Verificar el metadata del paquete en npm:

```bash
npm view reporag version dist-tags --json
```

2. Verificar una instalacion global fresca:

```bash
NPM_CONFIG_CACHE=/tmp/reporag-npm-cache npm install -g reporag
reporag status
```

3. Verificar el flujo local principal en un repositorio de muestra:

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
