import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createAppHandler, hostContext } from "apps/host";
import app from "../app/index.ts";

export const appDir = fileURLToPath(new URL("../app/", import.meta.url));

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** The deployable files as the host's build bridge hands them to app code: package-relative, outside ui/. */
export const packagedFiles = (): { path: string; content: string }[] =>
  walk(appDir)
    .map((path) => ({ path: relative(appDir, path).split(sep).join("/"), content: readFileSync(path, "utf8") }))
    .filter((file) => !file.path.startsWith("ui/"));

/** A fresh SQLite database with the app's migrations applied in number order, as a deploy does. */
export const migratedDatabase = (): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  const migrations = readdirSync(join(appDir, "migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) db.exec(readFileSync(join(appDir, "migrations", name), "utf8"));
  return db;
};

let savepoints = 0;

/** Durable Object SqlStorage over node:sqlite, the shape the host's data facet hands the framework. */
const storageOver = (db: DatabaseSync) => ({
  sql: {
    exec(query: string, ...bindings: (string | number | null | ArrayBuffer)[]) {
      const statement = db.prepare(query);
      const params = bindings.map((value) =>
        value instanceof ArrayBuffer ? new Uint8Array(value) : value,
      ) as SQLInputValue[];
      const returnsRows = statement.columns().length > 0;
      const rows = returnsRows ? (statement.all(...params) as Record<string, string | number | null>[]) : [];
      const written = returnsRows ? 0 : Number(statement.run(...params).changes);
      return {
        columnNames: statement.columns().map((column) => column.name),
        rowsRead: rows.length,
        rowsWritten: written,
        toArray: () => rows,
      };
    },
  },
  transactionSync<T>(work: () => T): T {
    const name = `sp${++savepoints}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
      const result = work();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw error;
    }
  },
});

export type HostReply = { ok: true; value: unknown } | { ok: false; error: Record<string, unknown> };

/** One host request against the real app module through the framework's own handler. */
export const host = (db: DatabaseSync = migratedDatabase()) => {
  const handler = createAppHandler(app);
  const files = packagedFiles();
  const send = async (body: unknown): Promise<HostReply> => {
    const response = await handler(
      new Request("https://p3.app.local/", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
      { ...hostContext({}), files, storage: storageOver(db) },
    );
    return (await response.json()) as HostReply;
  };
  return {
    db,
    send,
    call: (tool: string, kind: "query" | "mutation", input: unknown) =>
      send({ operation: "call", tool, kind, input }),
  };
};

type OptionFixture = {
  id: string;
  label: string;
  type: string;
  options?: { id: string; label: string; isDefault?: boolean; description?: string }[];
  [extra: string]: unknown;
};
export interface CatalogFixture {
  inheritedProviderInstanceId: string;
  inheritedModel: string;
  providers: {
    providerInstanceId: string;
    canRunChildTask: boolean;
    canRunCrossProviderChildTask: boolean;
    constraints: string[];
    models: { id: string; label: string; options?: OptionFixture[] }[];
    [extra: string]: unknown;
  }[];
  [extra: string]: unknown;
}

/** The live catalog shape orchestrator_capabilities returned while this app was built, trimmed to what tests need. */
export const liveCatalog = (): CatalogFixture => ({
  parentThreadId: "thread:example",
  inheritedProviderInstanceId: "claudeAgent",
  inheritedModel: "claude-opus-5-5",
  runtimeMode: "full-access",
  providers: [
    {
      providerInstanceId: "codex",
      driverKind: "codex",
      displayName: "Codex",
      models: [
        {
          id: "gpt-6.1-sol",
          label: "GPT-6.1-Sol",
          options: [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select",
              options: ["low", "medium", "high", "xhigh", "max", "ultra"].map((value) => ({
                id: value,
                label: value,
                ...(value === "low" ? { isDefault: true } : {}),
              })),
              currentValue: "low",
            },
            {
              id: "serviceTier",
              label: "Service Tier",
              type: "select",
              options: [
                { id: "default", label: "Standard", isDefault: true },
                { id: "priority", label: "Fast", description: "2x speed, increased usage" },
              ],
            },
          ],
        },
        {
          id: "gpt-6-luna",
          label: "GPT-6-Luna",
          options: [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select",
              options: ["low", "medium", "high", "xhigh", "max"].map((value) => ({ id: value, label: value })),
            },
          ],
        },
      ],
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      constraints: [],
    },
    {
      providerInstanceId: "claudeAgent",
      driverKind: "claudeAgent",
      displayName: "Claude",
      models: [
        {
          id: "claude-opus-5-5",
          label: "Claude Opus 5.5",
          options: [
            {
              id: "effort",
              label: "Reasoning",
              type: "select",
              options: ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"].map((value) => ({
                id: value,
                label: value,
              })),
              promptInjectedValues: ["ultrathink"],
            },
            { id: "fastMode", label: "Fast Mode", type: "boolean" },
          ],
        },
        {
          id: "claude-haiku-4-5",
          label: "Claude Haiku 4.5",
          options: [{ id: "thinking", label: "Thinking", type: "boolean" }],
        },
      ],
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      constraints: [],
    },
    {
      providerInstanceId: "grok",
      driverKind: "grok",
      displayName: "Grok",
      models: [{ id: "grok-build", label: "Grok Build", options: [] }],
      canRunChildTask: false,
      canRunCrossProviderChildTask: false,
      constraints: ["Provider instance is disabled.", "Grok is disabled in T3 Code settings."],
    },
  ],
  features: { appOwnedSubagents: true },
});
