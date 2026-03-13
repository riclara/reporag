[English](reporag-mvp-backlog.md) | Espanol

# Backlog Ejecutable de `reporag`

## Estado de implementacion (auto-actualizado)

Ultima actualizacion: 2026-03-10

### Hitos completados

- **Monorepo + build**: workspaces `packages/*`, TypeScript project references y
  `npm run build` compila.
- **Core compartido**: `CodeIntelService` (paquete `app`) usado por CLI.
- **Bootstrap local (`reporag init`)**:
  - crea `.reporag/`
  - genera `.reporag/config.json`
  - crea `.reporag/index.sqlite`
  - crea tabla `index_metadata` y setea `schema_version = 1`

### En progreso inmediato

- **`reporag index` (corte 1)**: escaneo de archivos TS/JS + persistencia en
  `files` (`hash`/`updated_at`).

### Implementado (corte 1)

- **`reporag index` (minimo)**:
  - lee `include/exclude` desde `.reporag/config.json`
  - escanea archivos (TS/JS) y calcula `sha1`
  - asegura schema minimo en SQLite (crea `files` si falta)
  - upsert de `files(path, language, sha1, updated_at)`

### Implementado (scanner + simbolos, corte 2)

- **Schema SQLite**:
  - tablas adicionales: `symbols(file_id, parent_symbol_id, name, kind,
    signature, start_line, end_line, exported)` y
    `relations(source_symbol_id, target_symbol_id, relation_type)` creadas en
    `ensureDatabase`.
- **Parser TS/JS**:
  - modulo `adapters/parser/typescript` con extraccion basica de:
    - funciones
    - clases
    - metodos de clase
    - variables exportadas/no exportadas
- **Index de simbolos**:
  - `reporag index` ahora:
    - recorre los archivos escaneados
    - parsea el codigo con la TypeScript Compiler API
    - guarda simbolos minimos en `symbols` (un nivel, sin relaciones aun)
    - muestra en CLI el total de simbolos indexados (`symbols: N`)

## 1. Decision

Si vale la pena construir `reporag`, pero no como una reimplementacion completa
de `ai-ragcode`.

La tesis de arranque para `reporag` es:

- producto principal: CLI local de inteligencia de repositorios
- producto derivado: servidor MCP que reutiliza exactamente el mismo core
- persistencia base: SQLite local
- soporte inicial: TypeScript y JavaScript
- retrieval inicial: simbolos + relaciones + FTS
- retrieval hibrido real: en una segunda ola del MVP, no en el dia 1

## 2. Nombre y superficie inicial

Nombre del binario:

```bash
reporag
```

Comandos del MVP:

```bash
reporag init
reporag index
reporag query "<texto>"
reporag symbol <name>
reporag callers <symbol>
reporag status
reporag doctor
reporag mcp serve
```

Comandos fuera del primer sprint:

- `reporag callees`
- `reporag explain-flow`
- `reporag watch`
- hooks automaticos de Git
- multilenguaje mas alla de TS/JS
- ranking avanzado con graph expansion profunda

## 3. Objetivo del MVP

Al final del arranque, `reporag` debe ser capaz de:

1. inicializar `.reporag/` dentro de un repo
2. indexar archivos TS/JS con simbolos y relaciones basicas
3. responder consultas utiles por texto, simbolo y callers
4. exponer esas mismas capacidades por MCP
5. operar localmente con SQLite, sin Postgres obligatorio

## 4. No objetivos del MVP

Estos puntos no deben entrar en el primer backlog de ejecucion:

- overlay complejo del working tree
- memoria de sesion
- model routing
- benchmark multi-repo sofisticado
- indexacion incremental perfecta desde el primer corte
- soporte a Python, Java, Dart u otros lenguajes
- heuristicas contextuales muy especificas por dominio

## 5. Arquitectura de arranque

Principio clave: el CLI y el servidor MCP no deben contener logica de dominio.

Estructura propuesta:

```txt
packages/
  domain/
    src/
      bootstrap.ts
      status.ts
      query.ts
      index/
        planner.ts
        runner.ts
      symbols/
        lookup.ts
        callers.ts
  adapters/
    src/
      storage/
        sqlite.ts
        migrations/
      parser/
        typescript.ts
      retrieval/
        fts.ts
        vector.ts
      embeddings/
        openai.ts
  app/
    src/
      codeintel-service.ts
  cli/
    src/
      commands/
        init.ts
        index.ts
        query.ts
        symbol.ts
        callers.ts
        status.ts
        doctor.ts
        mcp-serve.ts
  mcp-server/
    src/
      server.ts
      tools/
        search-code.ts
        get-symbol.ts
        find-callers.ts
  shared/
    src/
      schemas/
      types/
      utils/
```

## 6. Contratos base

### 6.1 Tool central

Nombre:

```txt
resolve-repository-query
```

Input minimo:

```ts
type QueryIntent = "hybrid-search" | "symbol-lookup" | "find-callers";

type QueryInput = {
  repoRoot: string;
  intent: QueryIntent;
  query?: string;
  symbolName?: string;
  limit?: number;
  stalePolicy?: "fail" | "warn" | "auto-index-light";
};
```

Output minimo:

```ts
type QueryHit = {
  filePath: string;
  symbolName?: string;
  startLine: number;
  endLine: number;
  score: number;
  rationale: string;
};

type QueryResult =
  | {
      ok: true;
      route: "symbol" | "fts" | "hybrid";
      stale: boolean;
      hits: QueryHit[];
    }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "REPO_NOT_INITIALIZED"
        | "INDEX_STALE"
        | "UNSUPPORTED_LANGUAGE"
        | "EMBEDDINGS_UNAVAILABLE";
      message: string;
      retryable: boolean;
    };
```

### 6.2 Boundary validation

Todo input de CLI o MCP debe validarse con Zod antes de tocar storage o parser.

### 6.3 Regla operativa

Si embeddings no estan disponibles, `reporag query` debe seguir funcionando con
`FTS + symbol boost`. No se debe bloquear el producto por la capa vectorial.

## 7. Modelo de datos minimo

Base de datos local:

```txt
.reporag/index.sqlite
```

Tablas del corte inicial:

- `files`
- `symbols`
- `relations`
- `chunks`
- `index_metadata`

Se puede dejar `chunk_embeddings` y vector index para el segundo bloque del MVP.

Campos minimos recomendados:

```txt
files(id, path, language, sha1, updated_at)
symbols(id, file_id, parent_symbol_id, name, kind, signature, start_line, end_line, exported)
relations(id, source_symbol_id, target_symbol_id, relation_type)
chunks(id, file_id, symbol_id, chunk_type, content, start_line, end_line, content_sha1)
index_metadata(key, value)
```

## 8. Roadmap de 2 semanas

## Semana 1

### Bloque 1. Scaffold y contratos

Objetivo:
dejar el repositorio listo para crecer sin mezclar transporte y dominio.

Tareas:

- crear monorepo basico con `packages/`
- configurar TypeScript, lint y test
- definir schemas Zod compartidos
- definir tipos `InitInput`, `QueryInput`, `QueryResult`, `RepoStatus`
- crear `CodeIntelService` como fachada de aplicacion

Criterios de aceptacion:

- `npm run build` compila
- `npm test` puede ejecutar al menos una prueba smoke
- CLI y MCP pueden importar el mismo servicio sin duplicacion

### Bloque 2. Bootstrap local

Objetivo:
tener `reporag init` funcional con SQLite local.

Tareas:

- detectar raiz del repo
- crear `.reporag/`
- crear `config.json`
- crear `index.sqlite`
- ejecutar migraciones
- registrar metadata inicial
- agregar `.reporag/` a `.gitignore` si aplica

Criterios de aceptacion:

- `reporag init` deja el repo listo sin pedir Postgres
- correr `init` dos veces no rompe nada
- el comando falla con mensajes claros si no esta dentro de un repo valido

### Bloque 3. Scanner y parser TS/JS

Objetivo:
producir un indice estructural minimo util.

Tareas:

- escanear archivos segun include/exclude
- parsear TS/JS
- extraer simbolos principales
- extraer imports y llamadas basicas
- persistir `files`, `symbols`, `relations`

Criterios de aceptacion:

- un repo TS/JS pequeno genera simbolos navegables
- se pueden encontrar al menos funciones, clases y metodos
- fallos de parseo se reportan sin abortar toda la indexacion

## Semana 2

### Bloque 4. Chunks, FTS y `query`

Objetivo:
entregar valor real sin depender aun de embeddings.

Tareas:

- construir chunks por simbolo
- crear indice FTS sobre contenido de chunks
- implementar ranking base
- implementar `reporag query`
- devolver archivo, simbolo, lineas, score y razon corta

Criterios de aceptacion:

- `reporag query` responde preguntas simples sobre un repo TS/JS
- `query` funciona sin embeddings
- latencia warm aceptable en repos medianos

### Bloque 5. `symbol`, `callers`, `status`, `doctor`

Objetivo:
dar herramientas estructurales directas ademas del search.

Tareas:

- implementar `reporag symbol <name>`
- implementar `reporag callers <symbol>`
- implementar `reporag status`
- implementar `reporag doctor`
- detectar indice faltante o stale

Criterios de aceptacion:

- `symbol` encuentra coincidencias exactas o aproximadas
- `callers` devuelve relaciones trazables
- `doctor` valida SQLite, schema, config y estado del indice

### Bloque 6. MCP minimo compartiendo el core

Objetivo:
exponer el mismo motor a agentes sin logica duplicada.

Tareas:

- levantar `reporag mcp serve` por `stdio`
- exponer tools `search_code`, `get_symbol`, `find_callers`
- mapear tools al mismo `CodeIntelService`
- normalizar errores y salidas

Criterios de aceptacion:

- el servidor MCP usa el mismo contrato que el CLI
- no existe SQL ni parsing de dominio dentro de `mcp-server`
- un cliente MCP puede consultar el repo ya indexado

## 9. Backlog inmediatamente posterior

Estos items entran solo si el corte de 2 semanas queda estable:

1. embeddings con OpenAI
2. `sqlite-vec` o alternativa vectorial validada
3. ranking hibrido `FTS + vector + symbol boost`
4. indexacion incremental por hash
5. `find_callees`
6. deteccion ligera de staleness al consultar
7. hooks opcionales y delgados de Git

## 10. Criterios de exito del arranque

`reporag` se considera validado para seguir si cumple esta barra minima:

- `init` funciona sin dependencias externas complejas
- `index` procesa un repo TS/JS mediano en menos de 5 minutos en cold start
- `query` responde en warm path con `p50 < 1.5s`
- `symbol` y `callers` son correctos en la mayoria de casos del set de prueba
- el MCP devuelve el mismo tipo de resultados que el CLI

## 11. Riesgos que no se deben reintroducir

- convertir el MVP en otra plataforma sobredimensionada
- hacer obligatoria la capa vectorial antes de probar utilidad real
- duplicar logica entre CLI y MCP
- prometer soporte multilenguaje sin contratos por lenguaje
- meter autoindexacion agresiva dentro de `query`
- mezclar configuracion global, credenciales y logica de negocio en `init`

## 12. Orden de implementacion real

Secuencia recomendada:

1. scaffold tecnico
2. schemas y contratos
3. SQLite y migraciones
4. `reporag init`
5. scanner de archivos
6. parser TS/JS
7. simbolos y relaciones
8. chunks
9. FTS
10. `reporag query`
11. `reporag symbol`
12. `reporag callers`
13. `reporag status`
14. `reporag doctor`
15. `reporag mcp serve`
16. embeddings
17. retrieval hibrido real
18. indexacion incremental

## 13. Definicion de terminado para el primer release interno

El primer release interno de `reporag` esta listo cuando:

- existe un repositorio instalable y compilable
- el flujo `init -> index -> query -> symbol -> callers -> mcp serve` funciona
- hay pruebas minimas de smoke y pruebas sobre un repo fixture
- hay documentacion de instalacion, limites de soporte y troubleshooting basico
- el equipo puede usarlo en al menos un repo real sin depender de conocimiento
  tribal
