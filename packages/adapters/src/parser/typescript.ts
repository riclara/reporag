import ts from "typescript";

export type RawSymbol = {
  localKey: string;
  name: string;
  kind: "function" | "class" | "method" | "variable";
  startLine: number;
  endLine: number;
  exported: boolean;
  parentName?: string;
  parentLocalKey?: string;
  signature?: string;
  content: string;
};

export type RawRelation = {
  sourceLocalKey: string;
  targetName: string;
  targetParentName?: string;
  relationType: "calls";
};

export type ParsedSourceArtifacts = {
  symbols: RawSymbol[];
  relations: RawRelation[];
};

type ExtractOptions = {
  absoluteFilePath?: string;
  program?: ts.Program;
};

type ResolverState = {
  importAliases: Map<string, string>;
  localAliases: Map<string, string>;
  instanceAliases: Map<string, string>;
  classMethodNamesByClass: Map<string, Set<string>>;
};

type CallTargetRef = {
  name: string;
  parentName?: string;
};

function resolveIdentifierTargets(
  name: string,
  state: ResolverState,
): string[] {
  const resolved = new Set<string>([name]);
  const queue = [name];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const aliasTargets = [
      state.importAliases.get(current),
      state.localAliases.get(current),
      state.instanceAliases.get(current),
    ].filter((value): value is string => Boolean(value));

    for (const target of aliasTargets) {
      if (resolved.has(target)) {
        continue;
      }
      resolved.add(target);
      queue.push(target);
    }
  }

  return [...resolved];
}

function resolveClassNameForExpression(
  expression: ts.Expression,
  state: ResolverState,
  currentClassName?: string,
): string | null {
  if (expression.kind === ts.SyntaxKind.ThisKeyword) {
    return currentClassName ?? null;
  }

  if (!ts.isIdentifier(expression)) {
    return null;
  }

  const targets = resolveIdentifierTargets(expression.text, state);

  for (const target of targets) {
    if (state.classMethodNamesByClass.has(target)) {
      return target;
    }
  }

  return null;
}

function getCallTargetRefs(
  expression: ts.LeftHandSideExpression,
  state: ResolverState,
  currentClassName?: string,
): CallTargetRef[] {
  if (ts.isIdentifier(expression)) {
    return resolveIdentifierTargets(expression.text, state).map((name) => ({
      name,
    }));
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const ownerClassName = resolveClassNameForExpression(
      expression.expression,
      state,
      currentClassName,
    );
    const methodName = expression.name.text;

    if (ownerClassName) {
      const classMethods = state.classMethodNamesByClass.get(ownerClassName);
      if (classMethods?.has(methodName)) {
        return [{ name: methodName, parentName: ownerClassName }];
      }
    }

    return resolveIdentifierTargets(methodName, state).map((name) => ({
      name,
    }));
  }

  return [];
}

function getNodeDeclaredName(node: ts.Node | undefined): string | null {
  if (!node) {
    return null;
  }

  const namedNode = node as { name?: ts.Node };
  if (!namedNode.name) {
    return null;
  }

  if (ts.isIdentifier(namedNode.name)) {
    return namedNode.name.text;
  }

  if (ts.isStringLiteral(namedNode.name)) {
    return namedNode.name.text;
  }

  return null;
}

function getDeclarationParentName(declaration: ts.Declaration): string | undefined {
  let current: ts.Node | undefined = declaration.parent;

  while (current) {
    if (
      ts.isClassDeclaration(current) &&
      current.name &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }

    current = current.parent;
  }

  return undefined;
}

function dedupeCallTargetRefs(targets: CallTargetRef[]): CallTargetRef[] {
  const namesWithParent = new Set(
    targets
      .filter((target) => target.parentName && target.parentName.trim().length > 0)
      .map((target) => target.name),
  );
  const seen = new Set<string>();
  const deduped: CallTargetRef[] = [];

  for (const target of targets) {
    if (!target.parentName && namesWithParent.has(target.name)) {
      continue;
    }

    const key = `${target.parentName ?? ""}:${target.name}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(target);
  }

  return deduped;
}

function getSemanticTargetRefs(
  expression: ts.LeftHandSideExpression,
  checker: ts.TypeChecker,
  currentClassName?: string,
): CallTargetRef[] {
  const targets: CallTargetRef[] = [];
  const targetNode = ts.isPropertyAccessExpression(expression)
    ? expression.name
    : expression;
  const symbol = checker.getSymbolAtLocation(targetNode);

  if (!symbol) {
    return [];
  }

  const pushSymbolTargets = (current: ts.Symbol | undefined) => {
    if (!current) {
      return;
    }

    const symbolName = current.getName();
    if (symbolName && symbolName !== "__function" && symbolName !== "default") {
      targets.push({ name: symbolName });
    }

    for (const declaration of current.declarations ?? []) {
      const declaredName = getNodeDeclaredName(declaration);
      if (declaredName) {
        targets.push({
          name: declaredName,
          parentName: getDeclarationParentName(declaration),
        });
      }
    }
  };

  pushSymbolTargets(symbol);

  const aliased =
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  pushSymbolTargets(aliased);

  if (
    currentClassName &&
    ts.isPropertyAccessExpression(expression) &&
    expression.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    targets.push({
      name: expression.name.text,
      parentName: currentClassName,
    });
  }

  return dedupeCallTargetRefs(targets);
}

function collectCallTargets(
  node: ts.Node,
  state: ResolverState,
  currentClassName?: string,
): CallTargetRef[] {
  const targets: CallTargetRef[] = [];

  function walk(current: ts.Node) {
    if (ts.isCallExpression(current)) {
      for (const target of getCallTargetRefs(
        current.expression,
        state,
        currentClassName,
      )) {
        targets.push(target);
      }
    }

    if (ts.isNewExpression(current) && current.expression) {
      for (const target of getCallTargetRefs(
        current.expression,
        state,
        currentClassName,
      )) {
        targets.push(target);
      }
    }

    ts.forEachChild(current, walk);
  }

  walk(node);

  return dedupeCallTargetRefs(targets);
}

function collectResolverState(sourceFile: ts.SourceFile): ResolverState {
  const importAliases = new Map<string, string>();
  const localAliases = new Map<string, string>();
  const instanceAliases = new Map<string, string>();
  const classMethodNamesByClass = new Map<string, Set<string>>();

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;

      if (clause.name) {
        importAliases.set(clause.name.text, clause.name.text);
      }

      if (clause.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            importAliases.set(
              element.name.text,
              element.propertyName?.text ?? element.name.text,
            );
          }
        } else if (ts.isNamespaceImport(clause.namedBindings)) {
          importAliases.set(
            clause.namedBindings.name.text,
            clause.namedBindings.name.text,
          );
        }
      }
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        localAliases.set(
          element.name.text,
          element.propertyName?.text ?? element.name.text,
        );
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (ts.isIdentifier(node.initializer)) {
        localAliases.set(node.name.text, node.initializer.text);
      }

      if (
        ts.isNewExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression)
      ) {
        instanceAliases.set(node.name.text, node.initializer.expression.text);
      }
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const methodNames = new Set<string>();
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) &&
          member.name &&
          ts.isIdentifier(member.name)
        ) {
          methodNames.add(member.name.text);
        }
      }
      classMethodNamesByClass.set(node.name.text, methodNames);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    importAliases,
    localAliases,
    instanceAliases,
    classMethodNamesByClass,
  };
}

export function extractSymbolsFromSource(
  fileName: string,
  sourceText: string,
  options: ExtractOptions = {},
): ParsedSourceArtifacts {
  const sourceFile =
    (options.program && options.absoluteFilePath
      ? options.program.getSourceFile(options.absoluteFilePath)
      : undefined) ??
    ts.createSourceFile(
      fileName,
      sourceText,
      ts.ScriptTarget.ES2020,
      true,
      fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS,
    );
  const checker = options.program?.getTypeChecker();
  const resolverState = collectResolverState(sourceFile);

  const symbols: RawSymbol[] = [];
  const relations: RawRelation[] = [];

  function getLine(pos: number): number {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }

  function hasExportModifier(node: ts.Node): boolean {
    const modifiers = (node as ts.HasModifiers).modifiers;
    if (!modifiers) return false;
    return modifiers.some(
      (m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
  }

  function pushSyntheticExportSymbol(
    name: string,
    targetName: string,
    node: ts.Node,
  ): void {
    const localKey = `reexport:${name}`;
    symbols.push({
      localKey,
      name,
      kind: "variable",
      startLine: getLine(node.getStart()),
      endLine: getLine(node.end),
      exported: true,
      signature: name,
      content: node.getText(sourceFile),
    });

    relations.push({
      sourceLocalKey: localKey,
      targetName,
      relationType: "calls",
    });
  }

  function registerCalls(
    sourceLocalKey: string,
    body: ts.Node | undefined,
    currentClassName?: string,
  ) {
    if (!body) {
      return;
    }

    const targetRefs = collectCallTargets(body, resolverState, currentClassName);

    if (checker) {
      const walkSemantic = (current: ts.Node) => {
        if ((ts.isCallExpression(current) || ts.isNewExpression(current)) && current.expression) {
          for (const targetRef of getSemanticTargetRefs(
            current.expression,
            checker,
            currentClassName,
          )) {
            targetRefs.push(targetRef);
          }
        }

        ts.forEachChild(current, walkSemantic);
      };

      walkSemantic(body);
    }

    for (const target of dedupeCallTargetRefs(targetRefs)) {
      relations.push({
        sourceLocalKey,
        targetName: target.name,
        targetParentName: target.parentName,
        relationType: "calls",
      });
    }
  }

  function visit(node: ts.Node, exported = false) {
    const isExported = exported || hasExportModifier(node);

    if (ts.isFunctionDeclaration(node) && node.name) {
      const localKey = `function:${node.name.text}`;
      symbols.push({
        localKey,
        name: node.name.text,
        kind: "function",
        startLine: getLine(node.getStart()),
        endLine: getLine(node.end),
        exported: isExported,
        signature: node.getText(sourceFile).slice(0, 256),
        content: node.getText(sourceFile),
      });
      registerCalls(localKey, node.body);
    } else if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const classLocalKey = `class:${className}`;

      symbols.push({
        localKey: classLocalKey,
        name: className,
        kind: "class",
        startLine: getLine(node.getStart()),
        endLine: getLine(node.end),
        exported: isExported,
        signature: node.name.getText(sourceFile),
        content: node.getText(sourceFile),
      });

      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) &&
          member.name &&
          ts.isIdentifier(member.name)
        ) {
          const localKey = `method:${className}.${member.name.text}`;
          symbols.push({
            localKey,
            name: member.name.text,
            kind: "method",
            startLine: getLine(member.getStart()),
            endLine: getLine(member.end),
            exported: isExported,
            parentName: className,
            parentLocalKey: classLocalKey,
            signature: member.name.getText(sourceFile),
            content: member.getText(sourceFile),
          });
          registerCalls(localKey, member.body, className);
        }
      }
    } else if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.length > 0
    ) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const localKey = `variable:${decl.name.text}`;
          symbols.push({
            localKey,
            name: decl.name.text,
            kind: "variable",
            startLine: getLine(decl.getStart()),
            endLine: getLine(decl.end),
            exported: isExported,
            signature: decl.name.getText(sourceFile),
            content: decl.getText(sourceFile),
          });

          if (
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer))
          ) {
            registerCalls(localKey, decl.initializer.body);
          }
        }
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        const exportedName = element.name.text;
        const targetName = element.propertyName?.text ?? exportedName;
        pushSyntheticExportSymbol(exportedName, targetName, node);
      }
    }

    ts.forEachChild(node, (child) => visit(child, isExported));
  }

  visit(sourceFile);

  return {
    symbols,
    relations,
  };
}
