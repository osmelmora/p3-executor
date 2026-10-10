/**
 * p3 model configuration: which T3 provider and model each p3 role delegates to.
 * Pure domain logic. Storage lives in store.ts and the tool boundary in tools.ts.
 */

export const roleKinds = {
  "feature, refactoring": "single",
  "bug-fix": "single",
  "perf-issue": "single",
  hillclimb: "single",
  "judgment and prose": "single",
  "hardest tasks": "single",
  "how explorer": "single",
  "how explainer": "single",
  "why investigators": "single",
  "why synthesizer": "single",
  "reflect tooling": "single",
  "reflect judgment, divergent, synthesizer": "single",
  "swarm workers": "single",
  "arena runners": "panel",
  "arena cross-judge pool": "panel",
  "architect runners": "panel",
  "interrogate reviewers": "panel",
} as const satisfies Record<string, "single" | "panel">;

export type Role = keyof typeof roleKinds;
export type RoleKind = (typeof roleKinds)[Role];
export const roles = Object.keys(roleKinds) as Role[];
export const isRole = (value: string): value is Role => Object.hasOwn(roleKinds, value);

export const maxPanelEntries = 16;

/**
 * Reasoning presets: labels for how much reasoning setup proposes, never spending caps.
 * The app stores the label; it never maps a preset to option values.
 */
export const budgetPresets = {
  "provider-default": "Propose no reasoning option, so T3 decides the child's reasoning setting.",
  small: "Propose the value named medium where a model offers it.",
  medium: "Propose the value named high where a model offers it.",
  large: "Propose the value named xhigh where a model offers it.",
  unlimited: "Propose the value named max where a model offers it. Never a value beyond max.",
  custom: "Per-role choices only; no preset proposals.",
} as const;
export type BudgetPreset = keyof typeof budgetPresets;
const isBudgetPreset = (value: string): value is BudgetPreset => Object.hasOwn(budgetPresets, value);

export const skillDeliveryModes = ["executor-read", "inline"] as const;
export type SkillDelivery = (typeof skillDeliveryModes)[number];
const isSkillDelivery = (value: string): value is SkillDelivery =>
  (skillDeliveryModes as readonly string[]).includes(value);

export type OptionValue = string | boolean;

export interface ModelEntry {
  readonly use: "model";
  readonly providerInstanceId: string;
  readonly model: string;
  readonly options: Readonly<Record<string, OptionValue>>;
  /** Option keys setup derived from the reasoning preset. Every other key is the user's explicit choice. */
  readonly presetKeys: readonly string[];
}
export interface InheritEntry {
  readonly use: "inherit-parent";
}
export type RoleEntry = ModelEntry | InheritEntry;

export interface ScopeConfig {
  readonly budget?: BudgetPreset;
  readonly roles: Readonly<Partial<Record<Role, readonly RoleEntry[]>>>;
  readonly skillDelivery: Readonly<Record<string, SkillDelivery>>;
}

export const emptyScope: ScopeConfig = { roles: {}, skillDelivery: {} };
export const isEmptyScope = (scope: ScopeConfig): boolean =>
  scope.budget === undefined &&
  Object.keys(scope.roles).length === 0 &&
  Object.keys(scope.skillDelivery).length === 0;

export type ProblemCode =
  | "catalog-invalid"
  | "unknown-role"
  | "role-conflict"
  | "role-arity"
  | "entry-shape"
  | "provider-missing"
  | "provider-cannot-run-child-task"
  | "cross-provider-unsupported"
  | "model-missing"
  | "option-unsupported"
  | "option-type-unsupported"
  | "option-value-invalid"
  | "preset-key-invalid"
  | "budget-invalid"
  | "skill-delivery-invalid"
  | "project-invalid";

export interface Problem {
  readonly code: ProblemCode;
  readonly message: string;
  readonly role?: string;
  readonly entry?: number;
}

/** A rejected write or a malformed request. Nothing was saved. */
export class ModelConfigRejected extends Error {
  readonly code = "model-config-rejected";
  readonly problemCount: number;
  constructor(readonly problems: readonly Problem[]) {
    super(describeProblems(problems));
    this.name = "ModelConfigRejected";
    this.problemCount = problems.length;
  }
}

/** Another session saved this scope after the caller read it. */
export class RevisionConflict extends Error {
  readonly code = "revision-conflict";
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Expected revision ${expectedRevision} but the scope is at revision ${currentRevision}. Read it again, reconcile, and retry.`,
    );
    this.name = "RevisionConflict";
  }
}

const maxMessage = 1900;
const describeProblems = (problems: readonly Problem[]): string => {
  const lines = problems.map((problem) => {
    const where = [problem.role, problem.entry === undefined ? undefined : `entry ${problem.entry + 1}`]
      .filter((part) => part !== undefined)
      .join(" ");
    return `[${problem.code}]${where === "" ? "" : ` ${where}:`} ${problem.message}`;
  });
  let text = `Rejected ${problems.length} problem${problems.length === 1 ? "" : "s"}; nothing was saved.`;
  for (const [index, line] of lines.entries()) {
    const remaining = lines.length - index;
    if (text.length + line.length + 1 > maxMessage) return `${text}\n... and ${remaining} more`;
    text += `\n${line}`;
  }
  return text;
};

// Catalog: the caller's orchestrator_capabilities result. Executor cannot read T3's catalog itself.

export interface CatalogInput {
  readonly inheritedProviderInstanceId?: string | undefined;
  readonly inheritedModel?: string | undefined;
  readonly providers: readonly {
    readonly providerInstanceId: string;
    readonly canRunChildTask: boolean;
    readonly canRunCrossProviderChildTask?: boolean | undefined;
    readonly constraints?: readonly string[] | undefined;
    readonly models: readonly {
      readonly id: string;
      readonly options?:
        | readonly {
            readonly id: string;
            readonly type: string;
            readonly options?: readonly { readonly id: string }[] | undefined;
          }[]
        | undefined;
    }[];
  }[];
}

interface CatalogOption {
  readonly type: string;
  readonly values: readonly string[];
}
interface CatalogModel {
  readonly options: ReadonlyMap<string, CatalogOption>;
}
interface CatalogProvider {
  readonly canRunChildTask: boolean;
  readonly canRunCrossProviderChildTask?: boolean | undefined;
  readonly constraints: readonly string[];
  readonly models: ReadonlyMap<string, CatalogModel>;
}
export interface Catalog {
  readonly parentProviderInstanceId?: string | undefined;
  readonly parentModel?: string | undefined;
  readonly providers: ReadonlyMap<string, CatalogProvider>;
}

/** Index a catalog. Duplicate provider, model, or option ids make it ambiguous, so they reject it. */
export const indexCatalog = (input: CatalogInput): Catalog => {
  const problems: Problem[] = [];
  const providers = new Map<string, CatalogProvider>();
  for (const provider of input.providers) {
    if (providers.has(provider.providerInstanceId)) {
      problems.push({
        code: "catalog-invalid",
        message: `Provider instance "${provider.providerInstanceId}" appears twice.`,
      });
      continue;
    }
    const models = new Map<string, CatalogModel>();
    for (const model of provider.models) {
      if (models.has(model.id)) {
        problems.push({
          code: "catalog-invalid",
          message: `Model "${model.id}" appears twice under "${provider.providerInstanceId}".`,
        });
        continue;
      }
      const options = new Map<string, CatalogOption>();
      for (const option of model.options ?? []) {
        if (options.has(option.id)) {
          problems.push({
            code: "catalog-invalid",
            message: `Option "${option.id}" appears twice on ${provider.providerInstanceId}/${model.id}.`,
          });
          continue;
        }
        options.set(option.id, { type: option.type, values: (option.options ?? []).map((value) => value.id) });
      }
      models.set(model.id, { options });
    }
    providers.set(provider.providerInstanceId, {
      canRunChildTask: provider.canRunChildTask,
      canRunCrossProviderChildTask: provider.canRunCrossProviderChildTask,
      constraints: provider.constraints ?? [],
      models,
    });
  }
  if (problems.length > 0) throw new ModelConfigRejected(problems);
  return {
    parentProviderInstanceId: input.inheritedProviderInstanceId,
    parentModel: input.inheritedModel,
    providers,
  };
};

const quoteList = (values: readonly string[]): string =>
  values.length === 0 ? "none" : values.map((value) => `"${value}"`).join(", ");

/** Problems that make an entry unusable with this catalog. Each one names what the catalog offers instead. */
export const checkEntry = (entry: RoleEntry, catalog: Catalog): Omit<Problem, "role" | "entry">[] => {
  if (entry.use === "inherit-parent") {
    const parent =
      catalog.parentProviderInstanceId === undefined
        ? undefined
        : catalog.providers.get(catalog.parentProviderInstanceId);
    return parent !== undefined && !parent.canRunChildTask
      ? [
          {
            code: "provider-cannot-run-child-task",
            message: `The parent provider "${catalog.parentProviderInstanceId}" cannot run child tasks.`,
          },
        ]
      : [];
  }
  const provider = catalog.providers.get(entry.providerInstanceId);
  if (provider === undefined) {
    return [
      {
        code: "provider-missing",
        message: `Provider instance "${entry.providerInstanceId}" is not in the catalog. Catalog providers: ${quoteList([...catalog.providers.keys()])}.`,
      },
    ];
  }
  if (!provider.canRunChildTask) {
    const why = provider.constraints.length === 0 ? "" : ` (${provider.constraints.join(" ")})`;
    return [
      {
        code: "provider-cannot-run-child-task",
        message: `Provider instance "${entry.providerInstanceId}" cannot run child tasks${why}.`,
      },
    ];
  }
  const problems: Omit<Problem, "role" | "entry">[] = [];
  if (
    catalog.parentProviderInstanceId !== undefined &&
    catalog.parentProviderInstanceId !== entry.providerInstanceId &&
    provider.canRunCrossProviderChildTask === false
  ) {
    problems.push({
      code: "cross-provider-unsupported",
      message: `Provider instance "${entry.providerInstanceId}" cannot run a child of a "${catalog.parentProviderInstanceId}" parent.`,
    });
  }
  const model = provider.models.get(entry.model);
  if (model === undefined) {
    problems.push({
      code: "model-missing",
      message: `Model "${entry.model}" is not offered by "${entry.providerInstanceId}". Offered: ${quoteList([...provider.models.keys()])}.`,
    });
    return problems;
  }
  for (const [key, value] of Object.entries(entry.options)) {
    const option = model.options.get(key);
    const at = `${entry.providerInstanceId}/${entry.model}`;
    if (option === undefined) {
      problems.push({
        code: "option-unsupported",
        message: `Option "${key}" is not offered by ${at}. Offered: ${quoteList([...model.options.keys()])}.`,
      });
    } else if (option.type === "boolean") {
      if (typeof value !== "boolean") {
        problems.push({
          code: "option-value-invalid",
          message: `Option "${key}" on ${at} takes true or false, not ${JSON.stringify(value)}.`,
        });
      }
    } else if (option.type === "select") {
      if (typeof value !== "string" || !option.values.includes(value)) {
        problems.push({
          code: "option-value-invalid",
          message: `Option "${key}" on ${at} takes one of ${quoteList(option.values)}, not ${JSON.stringify(value)}.`,
        });
      }
    } else {
      problems.push({
        code: "option-type-unsupported",
        message: `Option "${key}" on ${at} has type "${option.type}", which this app version cannot validate.`,
      });
    }
  }
  return problems;
};

// Entry parsing. Tool inputs arrive structurally decoded; these checks enforce the rest.

export interface EntryInput {
  readonly use: string;
  readonly providerInstanceId?: string | undefined;
  readonly model?: string | undefined;
  readonly options?: Readonly<Record<string, unknown>> | undefined;
  readonly presetKeys?: readonly string[] | undefined;
}

const parseEntry = (input: EntryInput): RoleEntry | Omit<Problem, "role" | "entry"> => {
  if (input.use === "inherit-parent") {
    const extra = (["providerInstanceId", "model", "options", "presetKeys"] as const).filter(
      (key) => input[key] !== undefined,
    );
    return extra.length === 0
      ? { use: "inherit-parent" }
      : {
          code: "entry-shape",
          message: `An inherit-parent entry runs on the parent's model and takes no ${extra.join(", ")}.`,
        };
  }
  if (input.use !== "model") {
    return { code: "entry-shape", message: `"use" must be "model" or "inherit-parent", not "${input.use}".` };
  }
  if (input.providerInstanceId === undefined || input.model === undefined) {
    return { code: "entry-shape", message: 'A "model" entry needs both providerInstanceId and model.' };
  }
  const options: Record<string, OptionValue> = {};
  for (const [key, value] of Object.entries(input.options ?? {})) {
    if (typeof value !== "string" && typeof value !== "boolean") {
      return {
        code: "option-value-invalid",
        message: `Option "${key}" must be a string or a boolean, not ${JSON.stringify(value)}.`,
      };
    }
    options[key] = value;
  }
  const presetKeys = [...new Set(input.presetKeys ?? [])];
  const strayKey = presetKeys.find((key) => !Object.hasOwn(options, key));
  if (strayKey !== undefined) {
    return {
      code: "preset-key-invalid",
      message: `presetKeys names "${strayKey}", which is not one of this entry's options.`,
    };
  }
  return { use: "model", providerInstanceId: input.providerInstanceId, model: input.model, options, presetKeys };
};

const isProblem = (value: RoleEntry | Omit<Problem, "role" | "entry">): value is Omit<Problem, "role" | "entry"> =>
  "code" in value;

// Writes: patch one scope, validating every entry it writes against the caller's catalog.

export interface ScopePatch {
  readonly reset?: boolean | undefined;
  /** A preset label, or "unset" to clear the scope's budget. */
  readonly budget?: string | undefined;
  readonly set?: readonly { readonly role: string; readonly entries: readonly EntryInput[] }[] | undefined;
  readonly unset?: readonly string[] | undefined;
  /** mode is a delivery mode, or "unset" to clear that provider's setting. */
  readonly skillDelivery?: readonly { readonly providerInstanceId: string; readonly mode: string }[] | undefined;
}

export const applyPatch = (current: ScopeConfig, patch: ScopePatch, catalog: Catalog): ScopeConfig => {
  const problems: Problem[] = [];
  const base = patch.reset === true ? emptyScope : current;
  const nextRoles: Partial<Record<Role, readonly RoleEntry[]>> = { ...base.roles };
  const touched = new Set<string>();

  for (const role of patch.unset ?? []) {
    if (!isRole(role)) {
      problems.push({ code: "unknown-role", role, message: `Unknown role. Roles: ${quoteList(roles)}.` });
      continue;
    }
    touched.add(role);
    delete nextRoles[role];
  }

  for (const { role, entries } of patch.set ?? []) {
    if (!isRole(role)) {
      problems.push({ code: "unknown-role", role, message: `Unknown role. Roles: ${quoteList(roles)}.` });
      continue;
    }
    if (touched.has(role)) {
      problems.push({ code: "role-conflict", role, message: "The write names this role more than once." });
      continue;
    }
    touched.add(role);
    const kind = roleKinds[role];
    if (kind === "single" && entries.length !== 1) {
      problems.push({
        code: "role-arity",
        role,
        message: `A single role takes exactly one entry, not ${entries.length}.`,
      });
      continue;
    }
    if (kind === "panel" && (entries.length < 1 || entries.length > maxPanelEntries)) {
      problems.push({
        code: "role-arity",
        role,
        message: `A panel takes 1 to ${maxPanelEntries} entries, not ${entries.length}. Each entry runs one delegate.`,
      });
      continue;
    }
    const parsed: RoleEntry[] = [];
    for (const [index, input] of entries.entries()) {
      const entry = parseEntry(input);
      if (isProblem(entry)) {
        problems.push({ ...entry, role, entry: index });
        continue;
      }
      problems.push(...checkEntry(entry, catalog).map((problem) => ({ ...problem, role, entry: index })));
      parsed.push(entry);
    }
    nextRoles[role] = parsed;
  }

  let budget = base.budget;
  if (patch.budget !== undefined) {
    if (patch.budget === "unset") budget = undefined;
    else if (isBudgetPreset(patch.budget)) budget = patch.budget;
    else {
      problems.push({
        code: "budget-invalid",
        message: `Unknown reasoning preset "${patch.budget}". Presets: ${quoteList(Object.keys(budgetPresets))}, or "unset".`,
      });
    }
  }

  const skillDelivery: Record<string, SkillDelivery> = { ...base.skillDelivery };
  for (const { providerInstanceId, mode } of patch.skillDelivery ?? []) {
    if (mode === "unset") {
      delete skillDelivery[providerInstanceId];
    } else if (!isSkillDelivery(mode)) {
      problems.push({
        code: "skill-delivery-invalid",
        message: `Skill delivery for "${providerInstanceId}" must be ${quoteList(skillDeliveryModes)} or "unset", not "${mode}".`,
      });
    } else if (!catalog.providers.has(providerInstanceId)) {
      problems.push({
        code: "provider-missing",
        message: `Provider instance "${providerInstanceId}" is not in the catalog. Catalog providers: ${quoteList([...catalog.providers.keys()])}.`,
      });
    } else {
      skillDelivery[providerInstanceId] = mode;
    }
  }

  if (problems.length > 0) throw new ModelConfigRejected(problems);
  return {
    ...(budget === undefined ? {} : { budget }),
    roles: nextRoles,
    skillDelivery,
  };
};

/** Stored roles in this scope that the catalog no longer supports. Writes report them without blocking. */
export const staleRoles = (scope: ScopeConfig, catalog: Catalog): Problem[] =>
  roles.flatMap((role) =>
    (scope.roles[role] ?? []).flatMap((entry, index) =>
      checkEntry(entry, catalog).map((problem) => ({ ...problem, role, entry: index })),
    ),
  );

// Resolution: project over global, role by role, then the catalog check. Nothing is substituted.

export interface DelegateTarget {
  readonly providerInstanceId: string;
  readonly model: string;
  readonly options?: Readonly<Record<string, OptionValue>>;
}

export interface ResolvedDelegate {
  /** True: call delegate_task without `target`, so the child inherits the parent's provider, model, and options. */
  readonly inheritParent: boolean;
  /** Pass as delegate_task `target`. Absent for inheritParent. */
  readonly target?: DelegateTarget;
  /** Where the child runs, as far as the catalog says. */
  readonly runsOn?: { readonly providerInstanceId: string; readonly model?: string };
  /** How the child gets p3 skill text. "unknown" means use the fail-fast loader brief. */
  readonly skillDelivery: SkillDelivery | "unknown";
}

export interface ResolvedRole {
  readonly role: Role;
  readonly kind: RoleKind;
  /** configured: use delegates. unset: the skill's own default applies. invalid: do not delegate this role; see problems. */
  readonly status: "configured" | "unset" | "invalid";
  readonly source?: "project" | "global";
  readonly delegates: readonly ResolvedDelegate[];
  readonly problems: readonly Problem[];
}

export interface Resolution {
  readonly configured: boolean;
  readonly ok: boolean;
  readonly budget?: { readonly preset: BudgetPreset; readonly source: "project" | "global" };
  readonly roles: readonly ResolvedRole[];
}

export const resolveRoles = (
  scopes: { readonly global?: ScopeConfig | undefined; readonly project?: ScopeConfig | undefined },
  catalog: Catalog,
  requested?: readonly string[],
): Resolution => {
  const unknown = (requested ?? []).filter((role) => !isRole(role));
  if (unknown.length > 0) {
    throw new ModelConfigRejected(
      unknown.map((role) => ({ code: "unknown-role", role, message: `Unknown role. Roles: ${quoteList(roles)}.` })),
    );
  }
  const wanted = requested === undefined ? roles : [...new Set(requested)].filter(isRole);
  const delivery = { ...scopes.global?.skillDelivery, ...scopes.project?.skillDelivery };
  const deliveryFor = (providerInstanceId: string | undefined): SkillDelivery | "unknown" =>
    (providerInstanceId === undefined ? undefined : delivery[providerInstanceId]) ?? "unknown";

  const resolved = wanted.map((role): ResolvedRole => {
    const kind = roleKinds[role];
    const fromProject = scopes.project?.roles[role];
    const entries = fromProject ?? scopes.global?.roles[role];
    if (entries === undefined) return { role, kind, status: "unset", delegates: [], problems: [] };
    const source = fromProject === undefined ? "global" : "project";
    const problems = entries.flatMap((entry, index) =>
      checkEntry(entry, catalog).map((problem) => ({ ...problem, role, entry: index })),
    );
    if (problems.length > 0) return { role, kind, status: "invalid", source, delegates: [], problems };
    const delegates = entries.map((entry): ResolvedDelegate => {
      if (entry.use === "inherit-parent") {
        const parent = catalog.parentProviderInstanceId;
        return {
          inheritParent: true,
          ...(parent === undefined
            ? {}
            : {
                runsOn: {
                  providerInstanceId: parent,
                  ...(catalog.parentModel === undefined ? {} : { model: catalog.parentModel }),
                },
              }),
          skillDelivery: deliveryFor(parent),
        };
      }
      const hasOptions = Object.keys(entry.options).length > 0;
      return {
        inheritParent: false,
        target: {
          providerInstanceId: entry.providerInstanceId,
          model: entry.model,
          ...(hasOptions ? { options: entry.options } : {}),
        },
        runsOn: { providerInstanceId: entry.providerInstanceId, model: entry.model },
        skillDelivery: deliveryFor(entry.providerInstanceId),
      };
    });
    return { role, kind, status: "configured", source, delegates, problems: [] };
  });

  const budget =
    scopes.project?.budget !== undefined
      ? { preset: scopes.project.budget, source: "project" as const }
      : scopes.global?.budget !== undefined
        ? { preset: scopes.global.budget, source: "global" as const }
        : undefined;
  return {
    configured: scopes.global !== undefined || scopes.project !== undefined,
    ok: resolved.every((role) => role.status !== "invalid"),
    ...(budget === undefined ? {} : { budget }),
    roles: resolved,
  };
};

// Project keys. A git remote names an endpoint (host and port) and a repository path on it.
// Forms that reach the same endpoint and path share a key; credentials, query, and fragment never enter it.
// A forge key is `host/path` on the transport's default port and `//host:port/path` on any other port. The
// leading `//` is what keeps a port apart from a path: git reads `host:2222/team/repo` as its scp form, the path
// `2222/team/repo` on the default port. Every key normalizes to itself, so a returned key can be passed back.

const maxProjectKey = 512;

/** The highest TCP port. A port outside 1 to 65535 names no endpoint, and a very long one prints back as `1e+25`. */
const maxPort = 65535;

/** Transports forges serve the same repositories over, with each one's default port. */
const transportPorts: ReadonlyMap<string, number> = new Map([
  ["https", 443],
  ["http", 80],
  ["ssh", 22],
  ["git+ssh", 22],
  ["ssh+git", 22],
  ["git", 9418],
]);

/** Hosts whose repository paths are case-insensitive. Every other host keeps its path's case. */
const caseInsensitivePathHosts = new Set(["github.com"]);

const projectRejected = (detail: string) =>
  new ModelConfigRejected([{ code: "project-invalid", message: detail }]);

interface Remote {
  /** Undefined for a `//host:port/path` key, whose port is kept whatever it is. */
  readonly scheme: string | undefined;
  readonly host: string;
  readonly port?: number;
  readonly path: string;
}

/**
 * A URL remote, a `//host[:port]/path` key, or git's scp-like `[user@]host:path`.
 * Undefined for anything else, such as a local path.
 */
const parseRemote = (value: string): Remote | undefined => {
  const url = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?\/\/([^/?#]*)([^?#]*)/.exec(value);
  if (url !== null && (url[1] !== undefined || url[2] !== "")) {
    const authority = url[2]!.slice(url[2]!.lastIndexOf("@") + 1);
    const endpoint = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(authority);
    if (endpoint === null) throw projectRejected(`The remote's port must be a number: "${authority}".`);
    const port = endpoint[2] === undefined || endpoint[2] === "" ? undefined : Number(endpoint[2]);
    if (port !== undefined && !(port >= 1 && port <= maxPort)) {
      throw projectRejected(`The remote's port must be from 1 to ${maxPort}: "${authority}".`);
    }
    return {
      scheme: url[1]?.toLowerCase(),
      host: endpoint[1]!.toLowerCase(),
      ...(port === undefined ? {} : { port }),
      path: url[3]!,
    };
  }
  const scp = /^(?:[^/]*@)?(\[[^\]]+\]|[^:/@[\]]{2,}):(.*)$/.exec(value);
  return scp === null ? undefined : { scheme: "ssh", host: scp[1]!.toLowerCase(), path: scp[2]! };
};

const remoteKey = ({ scheme, host, port, path }: Remote): string => {
  // Case is folded before the suffix is trimmed, so `Web.GIT` on github.com loses its `.git` in this pass.
  const cased = caseInsensitivePathHosts.has(host) ? path.toLowerCase() : path;
  const repository = cased.replace(/^\/+/, "").replace(/(?:\/|\.git)+$/, "");
  const at = (endpoint: string) => (repository === "" ? endpoint : `${endpoint}/${repository}`);
  if (scheme !== undefined && !transportPorts.has(scheme)) {
    return `${scheme}://${at(port === undefined ? host : `${host}:${port}`)}`;
  }
  if (host === "") throw projectRejected("The remote names no host.");
  return port === undefined || port === transportPorts.get(scheme ?? "") ? at(host) : `//${at(`${host}:${port}`)}`;
};

const keyOf = (raw: string): string => {
  const value = raw.trim();
  const printable = [...value].every((char) => char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f);
  if (value === "" || value.length > maxProjectKey || !printable) {
    throw projectRejected(
      `A project key is 1 to ${maxProjectKey} printable characters, such as the repository's origin remote.`,
    );
  }
  const remote = parseRemote(value);
  if (remote !== undefined) return remoteKey(remote);
  return value.replace(/\/+$/, "") || value;
};

/**
 * The scope key for a project value. A value whose key would change when passed back is refused, so a returned key
 * never names another scope: a path that ends in a space once `/` and `.git` are trimmed, a host that starts with
 * one, or a key that lowercasing makes longer than the limit.
 */
export const normalizeProjectKey = (raw: string): string => {
  const key = keyOf(raw);
  let again: string | undefined;
  try {
    again = keyOf(key);
  } catch (error) {
    if (!(error instanceof ModelConfigRejected)) throw error;
  }
  if (again !== key) {
    throw projectRejected(
      "This value's key would change when passed back, so it cannot name a scope. Pass the origin remote as `git remote get-url origin` prints it.",
    );
  }
  return key;
};

// Stored documents. Parsed defensively because they cross a storage boundary.

const documentVersion = 1;

export const serializeScope = (scope: ScopeConfig): string =>
  JSON.stringify({
    version: documentVersion,
    ...(scope.budget === undefined ? {} : { budget: scope.budget }),
    roles: Object.fromEntries(roles.filter((role) => scope.roles[role] !== undefined).map((role) => [role, scope.roles[role]])),
    skillDelivery: scope.skillDelivery,
  });

export class StoredConfigCorrupt extends Error {
  readonly code = "stored-config-corrupt";
  constructor(
    readonly scope: string,
    detail: string,
  ) {
    super(`Stored model configuration for ${scope} is unreadable: ${detail}. Reset that scope with models.write.`);
    this.name = "StoredConfigCorrupt";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseScope = (scopeKey: string, text: string): ScopeConfig => {
  const fail = (detail: string): never => {
    throw new StoredConfigCorrupt(scopeKey, detail);
  };
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return fail("not JSON");
  }
  if (!isRecord(document) || document["version"] !== documentVersion) return fail("unknown document version");
  const budget = document["budget"];
  if (budget !== undefined && (typeof budget !== "string" || !isBudgetPreset(budget))) return fail("bad budget");
  const storedRoles = document["roles"];
  const storedDelivery = document["skillDelivery"];
  if (!isRecord(storedRoles) || !isRecord(storedDelivery)) return fail("missing roles or skillDelivery");
  const parsedRoles: Partial<Record<Role, readonly RoleEntry[]>> = {};
  for (const [role, entries] of Object.entries(storedRoles)) {
    if (!isRole(role) || !Array.isArray(entries)) return fail(`bad role "${role}"`);
    parsedRoles[role] = entries.map((entry: unknown) => {
      if (!isRecord(entry)) return fail(`bad entry in "${role}"`);
      const parsed = parseEntry({
        use: String(entry["use"]),
        providerInstanceId: typeof entry["providerInstanceId"] === "string" ? entry["providerInstanceId"] : undefined,
        model: typeof entry["model"] === "string" ? entry["model"] : undefined,
        options: isRecord(entry["options"]) ? entry["options"] : undefined,
        presetKeys: Array.isArray(entry["presetKeys"]) ? entry["presetKeys"].map(String) : undefined,
      });
      return isProblem(parsed) ? fail(`bad entry in "${role}": ${parsed.message}`) : parsed;
    });
  }
  const skillDelivery: Record<string, SkillDelivery> = {};
  for (const [provider, mode] of Object.entries(storedDelivery)) {
    if (typeof mode !== "string" || !isSkillDelivery(mode)) return fail(`bad skill delivery for "${provider}"`);
    skillDelivery[provider] = mode;
  }
  return { ...(budget === undefined ? {} : { budget }), roles: parsedRoles, skillDelivery };
};
