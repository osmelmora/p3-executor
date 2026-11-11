/**
 * p3 model configuration for the on-disk install: models.read, models.write, and models.resolve,
 * stored in a JSON file on this machine.
 *
 *   node models.ts read    [input.json]
 *   node models.ts write   input.json
 *   node models.ts resolve input.json
 *   node models.ts where
 *
 * The input is a JSON object in a file, or on stdin when the path is "-". The result is printed as JSON.
 * A failure prints { "error": { code, message, ... } } and exits 1.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readModels, resolveModels, writeModels, type ReadInput, type ResolveInput, type WriteInput } from "../../app/lib/service.ts";
import { fileStore } from "./file-store.ts";

const configPath = process.env["P3_MODELS_FILE"] ?? join(process.env["P3_HOME"] ?? join(homedir(), ".p3"), "models.json");

class InvalidInput extends Error {
  readonly code = "invalid-input";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readInput = (path: string | undefined): Record<string, unknown> => {
  if (path === undefined) return {};
  let text: string;
  try {
    text = readFileSync(path === "-" ? 0 : path, "utf8");
  } catch (error) {
    throw new InvalidInput(`cannot read the input ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = text.trim() === "" ? {} : JSON.parse(text);
  } catch (error) {
    throw new InvalidInput(`the input is not JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) throw new InvalidInput("the input must be a JSON object");
  return parsed;
};

/** Shape checks on the input, so a malformed request fails with a message instead of a stack trace. */
const check = (input: Record<string, unknown>, needsCatalog: boolean): void => {
  const expect = (ok: boolean, message: string) => {
    if (!ok) throw new InvalidInput(message);
  };
  const optional = (key: string, ok: (value: unknown) => boolean, what: string) =>
    expect(input[key] === undefined || ok(input[key]), `"${key}" must be ${what}`);
  const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
  optional("project", (value) => typeof value === "string", "a string");
  optional("expectedRevision", (value) => typeof value === "number", "a number");
  optional("reset", (value) => typeof value === "boolean", "a boolean");
  optional("budget", (value) => typeof value === "string", "a string");
  optional("roles", strings, "a list of role names");
  optional("unset", strings, "a list of role names");
  optional(
    "set",
    (value) => Array.isArray(value) && value.every((item) => isRecord(item) && typeof item["role"] === "string" && Array.isArray(item["entries"]) && item["entries"].every(isRecord)),
    "a list of { role, entries }",
  );
  optional(
    "skillDelivery",
    (value) => Array.isArray(value) && value.every((item) => isRecord(item) && typeof item["providerInstanceId"] === "string" && typeof item["mode"] === "string"),
    "a list of { providerInstanceId, mode }",
  );
  if (needsCatalog) {
    const catalog = input["catalog"];
    expect(isRecord(catalog) && Array.isArray(catalog["providers"]), '"catalog" must be the orchestrator_capabilities result, an object with a "providers" list');
  }
};

const run = (command: string | undefined, inputPath: string | undefined): unknown => {
  if (command === "where") return { file: configPath };
  if (command !== "read" && command !== "write" && command !== "resolve") {
    throw new InvalidInput("usage: models.ts <read|write|resolve|where> [input.json | -]");
  }
  const input = readInput(inputPath);
  const store = fileStore(configPath);
  check(input, command !== "read");
  if (command === "read") return readModels(store, input as ReadInput);
  if (command === "write") return writeModels(store, input as unknown as WriteInput);
  return resolveModels(store, input as unknown as ResolveInput);
};

try {
  console.log(JSON.stringify(run(process.argv[2], process.argv[3]), null, 2));
} catch (error) {
  const failure = error as Error & { code?: unknown };
  const { stack: _stack, name: _name, ...fields } = { ...failure } as Record<string, unknown>;
  console.log(JSON.stringify({ error: { ...fields, code: typeof failure.code === "string" ? failure.code : "internal", message: failure.message } }, null, 2));
  process.exitCode = 1;
}
