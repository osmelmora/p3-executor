/** The scope store of the on-disk install: one JSON file on this machine. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  emptyScope,
  isEmptyScope,
  parseScope,
  RevisionConflict,
  serializeScope,
  StoredConfigCorrupt,
} from "../../app/lib/model-config.ts";
import { globalScopeKey, projectScopeKey, type ScopeStore, type StoredScope } from "../../app/lib/service.ts";

interface StoredRow {
  project?: string;
  revision: number;
  updatedAt: number;
  config: unknown;
}
interface StoredFile {
  version: 1;
  /** The last revision handed out. It only grows, so a deleted scope's revisions are never reused. */
  clock: number;
  scopes: Record<string, StoredRow>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const load = (path: string): StoredFile => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, clock: 0, scopes: {} };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new StoredConfigCorrupt(path, (error as Error).message);
  }
  if (!isRecord(parsed) || parsed["version"] !== 1 || typeof parsed["clock"] !== "number" || !isRecord(parsed["scopes"])) {
    throw new StoredConfigCorrupt(path, "expected { version: 1, clock, scopes }");
  }
  return parsed as unknown as StoredFile;
};

const save = (path: string, file: StoredFile): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(temporary, path);
};

const toStored = (scopeKey: string, row: StoredRow): StoredScope => ({
  scopeKey,
  ...(row.project === undefined ? {} : { project: row.project }),
  config: parseScope(scopeKey, JSON.stringify(row.config)),
  revision: row.revision,
  updatedAt: row.updatedAt,
});

export const fileStore = (path: string): ScopeStore => ({
  read(project) {
    const { scopes } = load(path);
    const global = scopes[globalScopeKey];
    const scoped = project === undefined ? undefined : scopes[projectScopeKey(project)];
    return {
      ...(global === undefined ? {} : { global: toStored(globalScopeKey, global) }),
      ...(scoped === undefined ? {} : { project: toStored(projectScopeKey(project!), scoped) }),
    };
  },
  update(project, expectedRevision, update, now) {
    const file = load(path);
    const scopeKey = project === undefined ? globalScopeKey : projectScopeKey(project);
    const row = file.scopes[scopeKey];
    const currentRevision = row?.revision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new RevisionConflict(expectedRevision, currentRevision);
    }
    const next = update(row === undefined ? emptyScope : toStored(scopeKey, row).config);
    if (isEmptyScope(next)) {
      delete file.scopes[scopeKey];
      save(path, file);
      return undefined;
    }
    file.clock += 1;
    file.scopes[scopeKey] = {
      ...(project === undefined ? {} : { project }),
      revision: file.clock,
      updatedAt: now,
      config: JSON.parse(serializeScope(next)),
    };
    save(path, file);
    return toStored(scopeKey, file.scopes[scopeKey]!);
  },
});
