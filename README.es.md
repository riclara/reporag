[English](README.md) | Espanol

# reporag

`reporag` es un CLI local de inteligencia de repositorios con servidor MCP
integrado.

El paquete expone dos comandos equivalentes:

- `reporag`
- `rr`

Su objetivo es convertir un repositorio de codigo en una base consultable por:

- personas desde terminal
- agentes via MCP
- flujos locales sin depender de una base de datos externa

En vez de tratar el repo como texto plano, `reporag` indexa simbolos,
relaciones de llamadas y chunks de codigo para responder preguntas utiles como:

- donde vive un simbolo
- quien llama a una funcion
- que llama una funcion
- que archivos o simbolos son relevantes para una consulta textual

Documentacion:

- [Docs en ingles](docs/README.md)
- [Docs en espanol](docs/README.es.md)
- [Post del blog en ingles](https://ricardolara.dev/blog/why-i-built-reporag/)
- [Post del blog en espanol](https://ricardolara.dev/es/blog/por-que-construi-reporag/)

## Por que existe

Muchos flujos de RAG para codigo fallan por tres razones:

- dependen de infraestructura pesada para un problema local
- mezclan busqueda textual con heuristicas pobres de estructura
- no dejan una interfaz clara para que agentes como Codex, Claude o Gemini
  consulten el repo de forma consistente

`reporag` existe para atacar esos tres puntos con una arquitectura local-first:

- indice SQLite dentro del repo
- busqueda `FTS5` para buena latencia local
- relaciones estructurales para `symbol`, `callers` y `callees`
- MCP sobre el mismo core del CLI

## Propuesta de valor

El valor real de `reporag` no es "tener embeddings" o "tener MCP". El valor es
este:

- puedes inicializar e indexar un repo sin servicios externos
- puedes consultar estructura real del codigo, no solo texto aproximado
- puedes exponer ese conocimiento a asistentes AI con la misma semantica que
  usas en CLI
- puedes trabajar offline o casi offline para la mayor parte del flujo
- puedes medir el rendimiento del sistema localmente antes de publicarlo o
  conectarlo a agentes

En la practica, sirve para:

- navegar repos medianos sin abrir todo el arbol manualmente
- dar contexto estructurado a agentes
- depurar flujos donde una AI necesita entender simbolos y llamadas reales
- hacer onboarding tecnico mas rapido en bases TypeScript/JavaScript

## Tecnologias y por que se usan

### TypeScript

`reporag` esta implementado en TypeScript porque el dominio del proyecto es
precisamente entender repos TypeScript/JavaScript, y el compilador de
TypeScript da acceso directo a AST y resolucion semantica.

Valor:

- parser fuerte para simbolos y relaciones
- `ts.Program` para resolver aliases, defaults y reexports
- menor friccion para evolucionar hacia resolucion semantica mas profunda

### SQLite

SQLite se usa como almacenamiento local del indice.

Valor:

- no requiere levantar servicios
- vive dentro del repo en `.reporag/index.sqlite`
- permite modelo relacional para `files`, `symbols`, `relations`, `chunks`
- facilita inspeccion y debugging local

### SQLite FTS5

`FTS5` se usa para la recuperacion textual.

Valor:

- latencia local muy baja
- mejor ranking lexical que un scan en memoria
- base solida para combinar texto y estructura

### TypeScript Compiler API

Se usa para extraer simbolos y relaciones estructurales.

Valor:

- identifica funciones, clases, metodos y variables
- permite resolver llamadas mas alla del string literal
- mejora `callers` y `callees` con informacion real del codigo

### MCP

`reporag` expone un servidor MCP sobre `stdio`.

Valor:

- Codex, Claude y Gemini pueden consultar el mismo indice
- no hay divergencia entre lo que responde el CLI y lo que responde el agente
- la integracion local se vuelve simple y reproducible

### Embeddings opcionales

Los embeddings existen como capa opcional de reranking.

Valor:

- mejoran ranking cuando una consulta necesita mas semantica que texto exacto
- no son obligatorios para que el sistema funcione
- permiten mantener un MVP local util sin volver el setup fragil

## Arquitectura

`reporag` tiene un core compartido y dos superficies:

```text
CLI -> core -> SQLite / parser / retrieval
MCP -> core -> SQLite / parser / retrieval
```

Eso evita tener dos motores distintos y reduce bugs de comportamiento
inconsistente.

Componentes principales:

- `init`: prepara config, SQLite, un MCP local llamado `reporag`, y guia local
  para agentes y Claude Code
- `index`: escanea archivos, extrae simbolos, relaciones, chunks y embeddings
  opcionales
- `query`: combina `FTS5` y reranking estructural, con embeddings opcionales
- `symbol`: lookup exacto o aproximado de simbolos
- `callers`: busca quien llama un simbolo
- `callees`: busca que llama un simbolo
- `doctor`: revisa salud del indice y la configuracion
- `mcp serve`: expone tools MCP sobre el mismo motor

## Instalacion

### Publicado

```bash
npm install -g reporag
```

### Desde el workspace

```bash
cd /Users/riclara/workspace/reporag
npm install
npm run bundle:cli
node packages/cli/bundle/reporag.cjs status
```

### Probar antes de publicar con `npm link`

```bash
cd /Users/riclara/workspace/reporag
npm run bundle:cli

cd /Users/riclara/workspace/reporag/packages/cli
npm link
```

Luego, en cualquier repo:

```bash
reporag init
reporag index
reporag query "algo"
```

O usando el alias corto:

```bash
rr init
rr index
rr query "algo"
```

## Uso rapido

```bash
reporag init
reporag query "repository status"
reporag symbol runMcpServer
reporag callers helper
reporag callees runMcpServer
reporag status
reporag doctor
reporag mcp serve
```

Alias corto:

```bash
rr init
rr index
rr query "repository status"
rr symbol runMcpServer
rr callers helper
rr callees runMcpServer
rr status
rr doctor
rr mcp serve
```

## Que genera `init`

`reporag init` crea:

- `.reporag/config.json`
- `.reporag/index.sqlite`
- `.reporag/run-mcp-server.cjs`
- `.codex/config.toml`
- `.codex/skills/reporag-mcp-usage/SKILL.md`
- `.mcp.json`
- `.claude/reporag-mcp.md`
- `.claude/settings.local.json`
- `.claude/settings.json`
- `.gemini/settings.json`
- `AGENTS.md` creado o actualizado con un bloque gestionado para usar `reporag`
- `CLAUDE.md` creado o actualizado con un bloque gestionado que importa
  `@.claude/reporag-mcp.md`

Tambien agrega a `.gitignore` los artefactos locales generados:

- `.reporag/`
- `.codex/config.toml`
- `.codex/skills/reporag-mcp-usage/`
- `.mcp.json`
- `.claude/settings.local.json`
- `.claude/settings.json`
- `.gemini/settings.json`

`AGENTS.md` no se ignora por defecto. `reporag init` solo gestiona su bloque
marcado y preserva cualquier contenido adicional del repo.

`CLAUDE.md` y `.claude/reporag-mcp.md` tampoco se ignoran por defecto.
`reporag init` solo gestiona su bloque marcado dentro de `CLAUDE.md`, y el
archivo modular `.claude/reporag-mcp.md` queda como guia Claude-native
versionable.

`init` tambien ejecuta un primer `index`, para que el repo quede listo para
consultar inmediatamente.

La idea es que el repo quede listo para ser consultado por CLI, por clientes
MCP, por agentes genericos y por Claude Code cuando necesiten instrucciones
sobre cuando usar `reporag`.

## Tools MCP disponibles

Hoy `reporag mcp serve` expone:

- `search_code`
- `get_symbol`
- `find_callers`
- `find_callees`

## Estado actual

`reporag` ya soporta:

- `init`
- `index`
- `query`
- `symbol`
- `callers`
- `callees`
- `status`
- `doctor`
- `mcp serve`
- `FTS5`
- embeddings opcionales para reranking
- resolucion semantica TypeScript mejorada para aliases, defaults y reexports

## Limitaciones actuales

- el foco actual es TypeScript y JavaScript
- no hay indice vectorial nativo en SQLite; embeddings hoy rerankean candidatos
  FTS
- las relaciones `calls` son bastante mejores que al inicio, pero aun no cubren
  todos los casos complejos del ecosistema TS
- la calidad medida hoy es buena en el repo actual y en fixtures controlados,
  pero todavia falta validacion multi-repo mas amplia

## Embeddings opcionales

Puedes activar embeddings en `.reporag/config.json`:

```json
{
  "embeddings": {
    "enabled": true,
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Notas:

- `enabled: false` por defecto
- `provider: "openai"` requiere `OPENAI_API_KEY`
- `provider: "mock"` sirve para pruebas locales

## Medicion actual

El proyecto ya tiene benchmark reproducible:

```bash
npm run benchmark
```

Ultima validacion local:

- fixture estructural: `5/5`
- suite sobre `reporag`: `5/5`
- latencia warm self: alrededor de `p50 1-2 ms`

Reporte completo en [.reporag/benchmark-report.json](.reporag/benchmark-report.json).

## Release

Para validar el release local:

```bash
npm run release:validate
```

Checklist detallado en [docs/release-checklist.es.md](docs/release-checklist.es.md).
