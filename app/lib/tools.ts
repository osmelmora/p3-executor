import {
  array,
  boolean,
  type Infer,
  json,
  mutation,
  type MutationContext,
  number,
  object,
  query,
  type QueryContext,
  record,
  router,
  string,
} from "apps";
import { never } from "apps/operations/approval";
import {
  applyPatch,
  budgetPresets,
  indexCatalog,
  normalizeProjectKey,
  type Problem,
  resolveRoles,
  type RoleEntry,
  roleKinds,
  roles,
  type ScopeConfig,
  staleRoles,
} from "./model-config.js";
import { readScopes, type StoredScope, updateScope } from "./store.js";

export const requirements = { accounts: {} };
type Reader = Pick<QueryContext<typeof requirements>, "sql">;
type Writer = Pick<MutationContext<typeof requirements>, "sql">;

const id = () => string({ minLength: 1 });

/** The orchestrator_capabilities result, passed as returned. Undeclared fields are dropped. */
export const Catalog = object({
  inheritedProviderInstanceId: id().optional(),
  inheritedModel: id().optional(),
  providers: array(
    object({
      providerInstanceId: id(),
      canRunChildTask: boolean(),
      canRunCrossProviderChildTask: boolean().optional(),
      constraints: array(string()).optional(),
      models: array(
        object({
          id: id(),
          options: array(object({ id: id(), type: id(), options: array(object({ id: id() })).optional() })).optional(),
        }),
      ),
    }),
  ),
});

const Entry = object({
  use: id(),
  providerInstanceId: id().optional(),
  model: id().optional(),
  options: record(json()).optional(),
  presetKeys: array(string()).optional(),
});

const Scope = object({
  scope: string(),
  project: string().optional(),
  revision: number(),
  updatedAt: string(),
  budget: string().optional(),
  roles: array(object({ role: string(), entries: array(Entry) })),
  skillDelivery: array(object({ providerInstanceId: string(), mode: string() })),
});

const ProblemOut = object({
  code: string(),
  message: string(),
  role: string().optional(),
  entry: number().optional(),
});

export const ReadInput = object({ project: string().optional() });
export const ReadOutput = object({
  configured: boolean(),
  project: string().optional(),
  global: Scope.optional(),
  projectScope: Scope.optional(),
  roleCatalog: array(object({ role: string(), kind: string() })),
  budgetPresets: array(object({ preset: string(), proposal: string() })),
});

export const WriteInput = object({
  project: string().optional(),
  catalog: Catalog,
  expectedRevision: number().optional(),
  reset: boolean().optional(),
  budget: string().optional(),
  set: array(object({ role: id(), entries: array(Entry) })).optional(),
  unset: array(string()).optional(),
  skillDelivery: array(object({ providerInstanceId: id(), mode: id() })).optional(),
});
export const WriteOutput = object({
  saved: boolean(),
  deleted: boolean(),
  project: string().optional(),
  scope: Scope.optional(),
  staleInScope: array(ProblemOut),
});

export const ResolveInput = object({
  project: string().optional(),
  catalog: Catalog,
  roles: array(string()).optional(),
});
const Target = object({
  providerInstanceId: string(),
  model: string(),
  options: record(json()).optional(),
});
export const ResolveOutput = object({
  configured: boolean(),
  setupRequired: boolean(),
  ok: boolean(),
  project: string().optional(),
  budget: object({ preset: string(), source: string() }).optional(),
  roles: array(
    object({
      role: string(),
      kind: string(),
      status: string(),
      source: string().optional(),
      delegates: array(
        object({
          inheritParent: boolean(),
          target: Target.optional(),
          runsOn: object({ providerInstanceId: string(), model: string().optional() }).optional(),
          skillDelivery: string(),
        }),
      ),
      problems: array(ProblemOut),
    }),
  ),
});

const entryView = (entry: RoleEntry): Infer<typeof Entry> =>
  entry.use === "inherit-parent"
    ? { use: entry.use }
    : {
        use: entry.use,
        providerInstanceId: entry.providerInstanceId,
        model: entry.model,
        ...(Object.keys(entry.options).length === 0 ? {} : { options: entry.options }),
        ...(entry.presetKeys.length === 0 ? {} : { presetKeys: entry.presetKeys }),
      };

const scopeView = (stored: StoredScope): Infer<typeof Scope> => {
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

const problemView = (problem: Problem): Infer<typeof ProblemOut> => ({
  code: problem.code,
  message: problem.message,
  ...(problem.role === undefined ? {} : { role: problem.role }),
  ...(problem.entry === undefined ? {} : { entry: problem.entry }),
});

const projectKey = (raw: string | undefined): string | undefined =>
  raw === undefined ? undefined : normalizeProjectKey(raw);

export const readModels = (
  { sql }: Reader,
  input: Infer<typeof ReadInput>,
): Infer<typeof ReadOutput> => {
  const project = projectKey(input.project);
  const scopes = readScopes(sql, project);
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
  { sql }: Writer,
  input: Infer<typeof WriteInput>,
  now: number = Date.now(),
): Infer<typeof WriteOutput> => {
  const project = projectKey(input.project);
  const catalog = indexCatalog(input.catalog);
  const stored = updateScope(
    sql,
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
  { sql }: Reader,
  input: Infer<typeof ResolveInput>,
): Infer<typeof ResolveOutput> => {
  const project = projectKey(input.project);
  const catalog = indexCatalog(input.catalog);
  const scopes = readScopes(sql, project);
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

export const modelsRouter = router(
  {
    read: query(
      {
        title: "Read p3 model configuration",
        description:
          "Read saved p3 role choices: the global scope and, with `project` (the repository's origin remote), that project's overrides. Also returns every role name and the reasoning presets setup can propose. A scope that does not exist is absent; write it with expectedRevision 0.",
        input: ReadInput,
        output: ReadOutput,
        approval: never(),
      },
      async (ctx, input) => readModels(ctx, input),
    ),
    write: mutation(
      {
        title: "Save p3 model configuration",
        description:
          "Patch the global scope, or one project's overrides when `project` is set. Pass the current orchestrator_capabilities result as `catalog`; every entry written must exist there with exact option ids and values, or the whole write is rejected. `set` replaces listed roles ({role, entries}; use \"model\" with providerInstanceId, model, options, or \"inherit-parent\"), `unset` removes roles, `reset` clears the scope first, `budget` records a reasoning preset label or \"unset\", `skillDelivery` sets \"executor-read\", \"inline\", or \"unset\" per provider instance. `expectedRevision` (0 for a scope that does not exist) rejects a write that would overwrite another session's save; revisions are never reused, even after a scope is deleted and created again. `project` keys by host, non-default port, and repository path; credentials, query, and fragment are dropped.",
        input: WriteInput,
        output: WriteOutput,
        approval: never(),
      },
      async (ctx, input) => writeModels(ctx, input),
    ),
    resolve: query(
      {
        title: "Resolve p3 roles to delegate targets",
        description:
          "Resolve roles to delegate_task targets for this session. Pass the current orchestrator_capabilities result as `catalog` and, for project overrides, `project`. Project choices win role by role over global ones. A configured delegate gives `target` to pass as delegate_task target, or `inheritParent` to omit target. An invalid role lists problems and must not be delegated; nothing is substituted. setupRequired means no configuration exists yet.",
        input: ResolveInput,
        output: ResolveOutput,
        approval: never(),
      },
      async (ctx, input) => resolveModels(ctx, input),
    ),
  },
  {
    title: "p3 model configuration",
    description: "Per-role T3 provider and model choices for p3-stack delegation.",
  },
);
