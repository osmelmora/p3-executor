/**
 * The p3 model-configuration operations, independent of where the choices are stored. The Executor app
 * runs them over its SQL database (store.ts) and the on-disk install runs them over a JSON file.
 */
import {
  applyPatch,
  budgetPresets,
  type CatalogInput,
  indexCatalog,
  normalizeProjectKey,
  type Problem,
  resolveRoles,
  type RoleEntry,
  roleKinds,
  roles,
  type ScopeConfig,
  type ScopePatch,
  staleRoles,
} from "./model-config.js";

export interface StoredScope {
  readonly scopeKey: string;
  readonly project?: string;
  readonly config: ScopeConfig;
  readonly revision: number;
  readonly updatedAt: number;
}

export const globalScopeKey = "global";
export const projectScopeKey = (project: string): string => `project:${project}`;

/** Where scopes are kept. `update` reads, changes, and saves one scope as one atomic step. */
export interface ScopeStore {
  read(project: string | undefined): { readonly global?: StoredScope; readonly project?: StoredScope };
  /**
   * `expectedRevision` 0 means the scope must not exist yet; a mismatch throws RevisionConflict. An update
   * that leaves the scope empty deletes it and returns undefined. Revisions never repeat across the store.
   */
  update(
    project: string | undefined,
    expectedRevision: number | undefined,
    update: (current: ScopeConfig) => ScopeConfig,
    now: number,
  ): StoredScope | undefined;
}

export interface ReadInput {
  readonly project?: string | undefined;
}
export interface WriteInput extends ScopePatch {
  readonly project?: string | undefined;
  readonly catalog: CatalogInput;
  readonly expectedRevision?: number | undefined;
}
export interface ResolveInput {
  readonly project?: string | undefined;
  readonly catalog: CatalogInput;
  readonly roles?: readonly string[] | undefined;
}

const entryView = (entry: RoleEntry) =>
  entry.use === "inherit-parent"
    ? { use: entry.use }
    : {
        use: entry.use,
        providerInstanceId: entry.providerInstanceId,
        model: entry.model,
        ...(Object.keys(entry.options).length === 0 ? {} : { options: entry.options }),
        ...(entry.presetKeys.length === 0 ? {} : { presetKeys: entry.presetKeys }),
      };

const scopeView = (stored: StoredScope) => {
  const config: ScopeConfig = stored.config;
  return {
    scope: stored.project === undefined ? "global" : "project",
    ...(stored.project === undefined ? {} : { project: stored.project }),
    revision: stored.revision,
    updatedAt: new Date(stored.updatedAt).toISOString(),
    ...(config.budget === undefined ? {} : { budget: config.budget }),
    roles: roles.flatMap((role) => {
      const entries = config.roles[role];
      return entries === undefined ? [] : [{ role, entries: entries.map(entryView) }];
    }),
    skillDelivery: Object.entries(config.skillDelivery).map(([providerInstanceId, mode]) => ({
      providerInstanceId,
      mode,
    })),
  };
};

const problemView = (problem: Problem) => ({
  code: problem.code,
  message: problem.message,
  ...(problem.role === undefined ? {} : { role: problem.role }),
  ...(problem.entry === undefined ? {} : { entry: problem.entry }),
});

const projectKey = (raw: string | undefined): string | undefined =>
  raw === undefined ? undefined : normalizeProjectKey(raw);

export const readModels = (
  store: ScopeStore,
  input: ReadInput,
) => {
  const project = projectKey(input.project);
  const scopes = store.read(project);
  return {
    configured: scopes.global !== undefined || scopes.project !== undefined,
    ...(project === undefined ? {} : { project }),
    ...(scopes.global === undefined ? {} : { global: scopeView(scopes.global) }),
    ...(scopes.project === undefined ? {} : { projectScope: scopeView(scopes.project) }),
    roleCatalog: roles.map((role) => ({ role, kind: roleKinds[role] })),
    budgetPresets: Object.entries(budgetPresets).map(([preset, proposal]) => ({ preset, proposal })),
  };
};

export const writeModels = (
  store: ScopeStore,
  input: WriteInput,
  now: number = Date.now(),
) => {
  const project = projectKey(input.project);
  const catalog = indexCatalog(input.catalog);
  const stored = store.update(
    project,
    input.expectedRevision,
    (current) => applyPatch(current, input, catalog),
    now,
  );
  return {
    saved: stored !== undefined,
    deleted: stored === undefined,
    ...(project === undefined ? {} : { project }),
    ...(stored === undefined ? {} : { scope: scopeView(stored) }),
    staleInScope: stored === undefined ? [] : staleRoles(stored.config, catalog).map(problemView),
  };
};

export const resolveModels = (
  store: ScopeStore,
  input: ResolveInput,
) => {
  const project = projectKey(input.project);
  const catalog = indexCatalog(input.catalog);
  const scopes = store.read(project);
  const resolution = resolveRoles(
    { global: scopes.global?.config, project: scopes.project?.config },
    catalog,
    input.roles,
  );
  return {
    configured: resolution.configured,
    setupRequired: !resolution.configured,
    ok: resolution.ok,
    ...(project === undefined ? {} : { project }),
    ...(resolution.budget === undefined ? {} : { budget: resolution.budget }),
    roles: resolution.roles.map((role) => ({
      role: role.role,
      kind: role.kind,
      status: role.status,
      ...(role.source === undefined ? {} : { source: role.source }),
      delegates: role.delegates.map((delegate) => ({
        inheritParent: delegate.inheritParent,
        ...(delegate.target === undefined ? {} : { target: delegate.target }),
        ...(delegate.runsOn === undefined ? {} : { runsOn: delegate.runsOn }),
        skillDelivery: delegate.skillDelivery,
      })),
      problems: role.problems.map(problemView),
    })),
  };
};
