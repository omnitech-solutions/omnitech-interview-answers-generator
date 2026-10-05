// Finds every environment variable the production code reads, with the
// TypeScript compiler API, so scripts/env-docs.test.ts can require each one
// to be documented. It follows the shapes this repository uses:
//   process.env.NAME, process.env["NAME"], env["NAME"], environment["NAME"]
//   helper(env, "NAME", ...), where the first argument is an environment object
//   env[CONSTANT], where CONSTANT is a string constant in the same file
import ts from "typescript";
import {
  isTestSupportPath,
  parse,
  sourcePattern,
  walk,
} from "./guard-support.js";

export interface EnvRead {
  name: string;
  file: string;
}

// `env`, `environment`, `processEnv`, `localEnvironment`, `configuredEnvironment`...
const isEnvName = (name: string) =>
  /(^env|Env|environment|Environment)$/.test(name);
const envName =
  /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^(NODE_ENV|CI|HOME|PATH|PORT|TZ|HOST)$/;

// `process.env`, or a bare identifier that names an environment object.
function isEnvObject(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return isEnvName(node.text);
  if (ts.isNonNullExpression(node)) return isEnvObject(node.expression);
  if (ts.isPropertyAccessExpression(node))
    return node.name.text === "env" || isEnvName(node.name.text);
  return false;
}

function stringConstants(file: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteralLike(node.initializer)
    )
      constants.set(node.name.text, node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return constants;
}

export function envReadsIn(path: string): EnvRead[] {
  const source = parse(path);
  const constants = stringConstants(source);
  const reads: EnvRead[] = [];
  const add = (name: string | undefined) => {
    if (name && envName.test(name)) reads.push({ name, file: path });
  };
  const literalOrConstant = (node: ts.Expression): string | undefined =>
    ts.isStringLiteralLike(node)
      ? node.text
      : ts.isIdentifier(node)
        ? constants.get(node.text)
        : undefined;
  const visit = (node: ts.Node) => {
    if (ts.isElementAccessExpression(node) && isEnvObject(node.expression))
      add(literalOrConstant(node.argumentExpression));
    else if (
      ts.isPropertyAccessExpression(node) &&
      isEnvObject(node.expression) &&
      node.expression.kind !== ts.SyntaxKind.Identifier
    )
      add(node.name.text);
    else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      isEnvName(node.expression.text)
    )
      add(node.name.text);
    else if (
      ts.isCallExpression(node) &&
      node.arguments.length >= 2 &&
      isEnvObject(node.arguments[0] as ts.Expression)
    )
      add(literalOrConstant(node.arguments[1] as ts.Expression));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return reads;
}

// Tests and fixtures are skipped, except the real-provider integration tests:
// they are run by hand and read the variable that selects the runtime. Config
// files (next.config.ts, tsup and drizzle configs) are real readers.
const isReader = (path: string) =>
  /\.integration\.test\.ts$/.test(path) ||
  /\.config\.ts$/.test(path) ||
  !isTestSupportPath(path);

/** Reads in production source, config and scripts. */
export function productionEnvReads(): EnvRead[] {
  return ["apps", "packages", "products", "scripts"].flatMap((root) =>
    walk(root, sourcePattern).filter(isReader).flatMap(envReadsIn),
  );
}
