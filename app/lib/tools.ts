import {
  array,
  boolean,
  json,
  mutation,
  number,
  object,
  query,
  record,
  router,
  string,
} from "apps";
import { never } from "apps/operations/approval";
import { readModels, resolveModels, writeModels } from "./service.js";
import { sqlStore } from "./store.js";

export const requirements = {};
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
      omittedModels: number().optional(),
      models: array(
        object({
          id: id(),
          options: array(
            object({
              id: id(),
              type: id().optional(),
              options: array(object({ id: id() })).optional(),
              values: array(json()).optional(),
            }),
          ).optional(),
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
      async (ctx, input) => readModels(sqlStore(ctx.sql), input),
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
      async (ctx, input) => writeModels(sqlStore(ctx.sql), input),
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
      async (ctx, input) => resolveModels(sqlStore(ctx.sql), input),
    ),
  },
  {
    title: "p3 model configuration",
    description: "Per-role T3 provider and model choices for p3-stack delegation.",
  },
);
