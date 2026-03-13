[English](release-checklist.md) | Espanol

# Checklist de Release

## Configuracion inicial

1. Crear un secret de GitHub llamado `RELEASE_PLEASE_TOKEN`.

Recomendado: usar un PAT fine-grained limitado a este repositorio con permisos
de escritura sobre contents, pull requests e issues para que `release-please`
pueda abrir y actualizar release PRs que igual disparen CI normal.

2. Configurar trusted publishing de npm para este repositorio publico.

Usa el paquete npm `reporag` y apunta el trusted publisher a este repositorio y
workflow:

- repositorio: `riclara/reporag`
- workflow file: `.github/workflows/publish.yml`
- environment: dejar vacio salvo que luego quieras gatear publishes con un
  environment de GitHub

3. Cuando los workflows ya esten en `main`, actualizar el ruleset de proteccion
para exigir estos checks:

- `ci`
- `conventional-pr-title`

## Bootstrap manual de 0.1.0

El primer release se mantiene manual. Publica `0.1.0` una sola vez, crea el
tag y el GitHub release correspondientes, y deja que la automatizacion tome el
control desde `0.1.1`.

### Pre-release

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

### Publish

1. Confirmar la cuenta de npm activa:

```bash
npm whoami
```

2. Publicar el paquete:

```bash
cd /Users/riclara/workspace/reporag/packages/cli
NPM_CONFIG_CACHE=/tmp/reporag-npm-cache npm publish
```

3. Crear el tag y GitHub release inicial desde `main`:

- tag: `v0.1.0`
- titulo del release: `v0.1.0`

Ese tag es el punto de arranque para `release-please`.
El workflow `release-please` queda en espera hasta que exista `v0.1.0`.

## Releases automaticos despues de 0.1.0

1. Usa titulos de PR con Conventional Commits como `fix:`, `feat:`, `docs:` o
   `chore:`. Con squash merge, ese titulo pasa a ser el commit en `main`.

2. Mergea el PR a `main`.

3. Espera a que el workflow `release-please` abra o actualice el release PR.

4. Revisa el release PR generado:

- root y workspaces deben quedar con la misma version
- `CHANGELOG.md` debe describir el release
- el marcador de version del servidor MCP debe coincidir con la version nueva

5. Mergea el release PR.

Ese merge crea el release/tag en GitHub y dispara el workflow `publish`, que
ejecuta `release:validate`, `smoke:pack` y despues publica `packages/cli` en
npm.

6. Si la version ya existe en npm, el workflow termina en verde sin intentar
republicarla.

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
