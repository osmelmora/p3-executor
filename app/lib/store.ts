import type { Sql, SqlReader, SqlTransaction } from "apps";
import {
  emptyScope,
  isEmptyScope,
  parseScope,
  RevisionConflict,
  type ScopeConfig,
  serializeScope,
} from "./model-config.js";

export interface StoredScope {
  readonly scopeKey: string;
  readonly project?: string;
  readonly config: ScopeConfig;
  readonly revision: number;
  readonly updatedAt: number;
}

type Row = {
  scope_key: string;
  project: string | null;
  document: string;
  revision: number;
  updated_at: number;
};

export const globalScopeKey = "global";
export const projectScopeKey = (project: string): string => `project:${project}`;

const toStored = (row: Row): StoredScope => ({
  scopeKey: row.scope_key,
  ...(row.project === null ? {} : { project: row.project }),
  config: parseScope(row.scope_key, row.document),
  revision: Number(row.revision),
  updatedAt: Number(row.updated_at),
});

const selectScope = (sql: SqlReader, scopeKey: string): StoredScope | undefined => {
  const [row] = sql
    .exec<Row>(
      "SELECT scope_key, project, document, revision, updated_at FROM model_config_scopes WHERE scope_key = ?",
      scopeKey,
    )
    .toArray();
  return row === undefined ? undefined : toStored(row);
};

export const readScopes = (
  sql: SqlReader,
  project: string | undefined,
): { readonly global?: StoredScope; readonly project?: StoredScope } => {
  const global = selectScope(sql, globalScopeKey);
  const scoped = project === undefined ? undefined : selectScope(sql, projectScopeKey(project));
  return { ...(global === undefined ? {} : { global }), ...(scoped === undefined ? {} : { project: scoped }) };
};

/**
 * Revisions come from one counter for the whole database, so a scope deleted and created again never
 * gets back a revision an earlier incarnation had, and a stale expectedRevision cannot match it.
 */
const nextRevision = (tx: SqlTransaction): number => {
  tx.exec(
    `INSERT INTO model_config_clock (id, revision) VALUES (1, 1)
     ON CONFLICT (id) DO UPDATE SET revision = revision + 1`,
  );
  const [row] = tx.exec<{ revision: number }>("SELECT revision FROM model_config_clock WHERE id = 1").toArray();
  return Number(row!.revision);
};

/**
 * Read, update, and save one scope in a single transaction. `expectedRevision` 0 means the scope must
 * not exist yet. An update that leaves the scope empty deletes its row.
 */
export const updateScope = (
  sql: Sql,
  project: string | undefined,
  expectedRevision: number | undefined,
  update: (current: ScopeConfig) => ScopeConfig,
  now: number,
): StoredScope | undefined =>
  sql.transaction((tx) => {
    const scopeKey = project === undefined ? globalScopeKey : projectScopeKey(project);
    const current = selectScope(tx, scopeKey);
    const currentRevision = current?.revision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new RevisionConflict(expectedRevision, currentRevision);
    }
    const next = update(current?.config ?? emptyScope);
    if (isEmptyScope(next)) {
      tx.exec("DELETE FROM model_config_scopes WHERE scope_key = ?", scopeKey);
      return undefined;
    }
    const revision = nextRevision(tx);
    tx.exec(
      `INSERT INTO model_config_scopes (scope_key, project, document, revision, updated_at)
       VALUES (?, ?, ?, CAST(? AS INTEGER), CAST(? AS INTEGER))
       ON CONFLICT (scope_key) DO UPDATE SET
         document = excluded.document, revision = excluded.revision, updated_at = excluded.updated_at`,
      scopeKey,
      project ?? null,
      serializeScope(next),
      revision,
      now,
    );
    return { scopeKey, ...(project === undefined ? {} : { project }), config: next, revision, updatedAt: now };
  });
