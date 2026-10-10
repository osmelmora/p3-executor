import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { normalizeProjectKey } from "../app/lib/model-config.ts";
import { appDir, host, liveCatalog } from "./harness.ts";
import { invalidPorts, sweep } from "./remote-sweep.ts";

type Json = Record<string, any>;

const ok = (reply: { ok: boolean; value?: unknown; error?: unknown }): Json => {
  assert.equal(reply.ok, true, `expected success, got ${JSON.stringify(reply)}`);
  return reply.value as Json;
};
const failure = (reply: { ok: boolean; value?: unknown; error?: unknown }): Json => {
  assert.equal(reply.ok, false, `expected failure, got ${JSON.stringify(reply)}`);
  return reply.error as Json;
};

const sol = (options: Json = {}) => ({ use: "model", providerInstanceId: "codex", model: "gpt-6.1-sol", options });
const opus = (options: Json = {}) => ({
  use: "model",
  providerInstanceId: "claudeAgent",
  model: "claude-opus-5-5",
  options,
});
const inherit = { use: "inherit-parent" };

const setup = () => {
  const app = host();
  const write = (input: Json) => app.call("models.write", "mutation", { catalog: liveCatalog(), ...input });
  const read = (input: Json = {}) => app.call("models.read", "query", input);
  const resolve = (input: Json = {}) => app.call("models.resolve", "query", { catalog: liveCatalog(), ...input });
  return { app, write, read, resolve };
};

const roleOf = (resolution: Json, role: string): Json => {
  const found = resolution["roles"].find((entry: Json) => entry["role"] === role);
  assert.ok(found, `role ${role} missing from resolution`);
  return found;
};

describe("app surface", () => {
  it("exposes read and resolve as queries and write as a mutation", async () => {
    const { app } = setup();
    const catalog = ok(await app.send({ operation: "inspect" }));
    const tools = catalog["tools"].map((tool: Json) => [tool["name"], tool["readOnly"] === true]);
    assert.deepEqual(tools, [
      ["models.read", true],
      ["models.write", false],
      ["models.resolve", true],
    ]);
  });
});

describe("first use", () => {
  it("reports setup required and every role unset before anything is saved", async () => {
    const { resolve, read } = setup();
    const resolution = ok(await resolve());
    assert.equal(resolution["configured"], false);
    assert.equal(resolution["setupRequired"], true);
    assert.equal(resolution["ok"], true);
    assert.equal(resolution["roles"].length, 17);
    assert.deepEqual(
      resolution["roles"].map((role: Json) => role["status"]),
      Array(17).fill("unset"),
    );
    assert.equal(roleOf(resolution, "interrogate reviewers")["kind"], "panel");
    const saved = ok(await read());
    assert.equal(saved["configured"], false);
    assert.equal(saved["global"], undefined);
    assert.deepEqual(
      saved["budgetPresets"].map((preset: Json) => preset["preset"]),
      ["provider-default", "small", "medium", "large", "unlimited", "custom"],
    );
  });
});

describe("round trip", () => {
  it("returns saved roles, panels, options, and preset provenance exactly as written", async () => {
    const { write, read, resolve } = setup();
    const written = ok(
      await write({
        budget: "large",
        set: [
          { role: "bug-fix", entries: [{ ...sol({ reasoningEffort: "xhigh" }), presetKeys: ["reasoningEffort"] }] },
          { role: "judgment and prose", entries: [opus({ effort: "high", fastMode: false })] },
          { role: "swarm workers", entries: [inherit] },
          { role: "interrogate reviewers", entries: [sol({ reasoningEffort: "high" }), opus(), inherit] },
        ],
      }),
    );
    assert.equal(written["saved"], true);
    assert.equal(written["scope"]["revision"], 1);

    const saved = ok(await read())["global"];
    assert.equal(saved["budget"], "large");
    assert.deepEqual(saved["roles"], [
      {
        role: "bug-fix",
        entries: [
          {
            use: "model",
            providerInstanceId: "codex",
            model: "gpt-6.1-sol",
            options: { reasoningEffort: "xhigh" },
            presetKeys: ["reasoningEffort"],
          },
        ],
      },
      {
        role: "judgment and prose",
        entries: [
          {
            use: "model",
            providerInstanceId: "claudeAgent",
            model: "claude-opus-5-5",
            options: { effort: "high", fastMode: false },
          },
        ],
      },
      { role: "swarm workers", entries: [{ use: "inherit-parent" }] },
      {
        role: "interrogate reviewers",
        entries: [
          { use: "model", providerInstanceId: "codex", model: "gpt-6.1-sol", options: { reasoningEffort: "high" } },
          { use: "model", providerInstanceId: "claudeAgent", model: "claude-opus-5-5" },
          { use: "inherit-parent" },
        ],
      },
    ]);

    const resolution = ok(await resolve());
    assert.deepEqual(resolution["budget"], { preset: "large", source: "global" });
    assert.deepEqual(roleOf(resolution, "bug-fix")["delegates"], [
      {
        inheritParent: false,
        target: { providerInstanceId: "codex", model: "gpt-6.1-sol", options: { reasoningEffort: "xhigh" } },
        runsOn: { providerInstanceId: "codex", model: "gpt-6.1-sol" },
        skillDelivery: "unknown",
      },
    ]);
    assert.deepEqual(roleOf(resolution, "swarm workers")["delegates"], [
      {
        inheritParent: true,
        runsOn: { providerInstanceId: "claudeAgent", model: "claude-opus-5-5" },
        skillDelivery: "unknown",
      },
    ]);
    const panel = roleOf(resolution, "interrogate reviewers");
    assert.equal(panel["status"], "configured");
    assert.deepEqual(
      panel["delegates"].map((delegate: Json) => delegate["target"] ?? "inherit"),
      [
        { providerInstanceId: "codex", model: "gpt-6.1-sol", options: { reasoningEffort: "high" } },
        { providerInstanceId: "claudeAgent", model: "claude-opus-5-5" },
        "inherit",
      ],
    );
    assert.equal(roleOf(resolution, "arena runners")["status"], "unset");
  });

  it("keeps explicit values beyond max and boolean options untouched", async () => {
    const { write, resolve } = setup();
    ok(
      await write({
        set: [
          { role: "hardest tasks", entries: [sol({ reasoningEffort: "ultra", serviceTier: "priority" })] },
          { role: "architect runners", entries: [opus({ effort: "ultracode", fastMode: true })] },
          {
            role: "how explorer",
            entries: [{ use: "model", providerInstanceId: "claudeAgent", model: "claude-haiku-4-5", options: { thinking: true } }],
          },
        ],
      }),
    );
    const resolution = ok(await resolve({ roles: ["hardest tasks", "architect runners", "how explorer"] }));
    assert.deepEqual(
      resolution["roles"].map((role: Json) => role["delegates"][0]["target"]["options"]),
      [{ reasoningEffort: "ultra", serviceTier: "priority" }, { effort: "ultracode", fastMode: true }, { thinking: true }],
    );
  });
});

describe("the catalog orchestrator_capabilities returned on 2026-10-10, unmodified", () => {
  const captured = () =>
    JSON.parse(readFileSync(new URL("./fixtures/live-capabilities.json", import.meta.url), "utf8")) as Json;

  it("saves and resolves exact provider-specific values, booleans, and inheritance", async () => {
    const app = host();
    const catalog = captured();
    ok(
      await app.call("models.write", "mutation", {
        catalog,
        expectedRevision: 0,
        set: [
          {
            role: "interrogate reviewers",
            entries: [
              sol({ reasoningEffort: "ultra", serviceTier: "priority" }),
              opus({ effort: "ultrathink", fastMode: false }),
              { use: "model", providerInstanceId: "claudeAgent", model: "claude-opus-4-6", options: { contextWindow: "1m" } },
              inherit,
            ],
          },
          { role: "judgment and prose", entries: [inherit] },
        ],
      }),
    );
    const resolution = ok(await app.call("models.resolve", "query", { catalog, roles: ["interrogate reviewers", "judgment and prose"] }));
    assert.equal(resolution["ok"], true);
    assert.deepEqual(roleOf(resolution, "interrogate reviewers")["delegates"].map((d: Json) => d["target"] ?? d["runsOn"]), [
      { providerInstanceId: "codex", model: "gpt-6.1-sol", options: { reasoningEffort: "ultra", serviceTier: "priority" } },
      { providerInstanceId: "claudeAgent", model: "claude-opus-5-5", options: { effort: "ultrathink", fastMode: false } },
      { providerInstanceId: "claudeAgent", model: "claude-opus-4-6", options: { contextWindow: "1m" } },
      { providerInstanceId: "codex", model: "gpt-6.1-sol" },
    ]);
    assert.deepEqual(roleOf(resolution, "judgment and prose")["delegates"], [
      { inheritParent: true, runsOn: { providerInstanceId: "codex", model: "gpt-6.1-sol" }, skillDelivery: "unknown" },
    ]);
  });

  it("rejects its disabled providers and the values a sibling model lacks", async () => {
    const app = host();
    const error = failure(
      await app.call("models.write", "mutation", {
        catalog: captured(),
        set: [
          { role: "bug-fix", entries: [{ use: "model", providerInstanceId: "grok", model: "grok-build" }] },
          { role: "perf-issue", entries: [{ use: "model", providerInstanceId: "codex", model: "gpt-6-luna", options: { reasoningEffort: "ultra" } }] },
          { role: "hillclimb", entries: [{ use: "model", providerInstanceId: "claudeAgent", model: "claude-sonnet-5-5", options: { fastMode: true } }] },
        ],
      }),
    );
    assert.deepEqual(
      [...String(error["message"]).matchAll(/\[([a-z-]+)\]/g)].map((match) => match[1]),
      ["provider-cannot-run-child-task", "option-value-invalid", "option-unsupported"],
    );
    assert.match(String(error["message"]), /Grok is disabled in T3 Code settings\./);
  });
});

describe("partial writes", () => {
  it("patches named roles, unsets, resets, and deletes an emptied project scope", async () => {
    const { write, read } = setup();
    ok(await write({ set: [{ role: "bug-fix", entries: [sol()] }] }));
    ok(await write({ set: [{ role: "perf-issue", entries: [opus()] }] }));
    let roles = ok(await read())["global"]["roles"].map((role: Json) => role["role"]);
    assert.deepEqual(roles, ["bug-fix", "perf-issue"]);

    const unset = ok(await write({ unset: ["bug-fix"] }));
    assert.equal(unset["scope"]["revision"], 3);
    roles = ok(await read())["global"]["roles"].map((role: Json) => role["role"]);
    assert.deepEqual(roles, ["perf-issue"]);

    ok(await write({ reset: true, set: [{ role: "hillclimb", entries: [inherit] }] }));
    roles = ok(await read())["global"]["roles"].map((role: Json) => role["role"]);
    assert.deepEqual(roles, ["hillclimb"]);

    ok(await write({ project: "github.com/acme/web", set: [{ role: "bug-fix", entries: [opus()] }] }));
    const removed = ok(await write({ project: "github.com/acme/web", reset: true }));
    assert.equal(removed["saved"], false);
    assert.equal(removed["deleted"], true);
    assert.equal(ok(await read({ project: "github.com/acme/web" }))["projectScope"], undefined);
  });
});

describe("project overrides", () => {
  it("wins role by role and falls through to global for roles it does not set", async () => {
    const { write, resolve } = setup();
    ok(
      await write({
        budget: "medium",
        set: [
          { role: "bug-fix", entries: [sol({ reasoningEffort: "high" })] },
          { role: "feature, refactoring", entries: [sol()] },
        ],
      }),
    );
    ok(
      await write({
        project: "git@github.com:Acme/Web.git",
        budget: "small",
        set: [{ role: "bug-fix", entries: [opus({ effort: "medium" })] }],
      }),
    );

    const inProject = ok(await resolve({ project: "https://github.com/acme/web", roles: ["bug-fix", "feature, refactoring"] }));
    assert.equal(inProject["project"], "github.com/acme/web");
    assert.deepEqual(inProject["budget"], { preset: "small", source: "project" });
    assert.deepEqual(
      inProject["roles"].map((role: Json) => [role["source"], role["delegates"][0]["target"]["model"]]),
      [
        ["project", "claude-opus-5-5"],
        ["global", "gpt-6.1-sol"],
      ],
    );

    const elsewhere = ok(await resolve({ roles: ["bug-fix"] }));
    assert.deepEqual(elsewhere["budget"], { preset: "medium", source: "global" });
    assert.equal(elsewhere["roles"][0]["delegates"][0]["target"]["model"], "gpt-6.1-sol");
  });

  it("normalizes remotes and never stores credentials embedded in a remote URL", async () => {
    const { write, app } = setup();
    const saved = ok(
      await write({
        project: "https://deploy:ghp_secret123@GitHub.com/Acme/Web.git/",
        set: [{ role: "bug-fix", entries: [inherit] }],
      }),
    );
    assert.equal(saved["project"], "github.com/acme/web");
    const rows = app.db.prepare("SELECT scope_key, project, document FROM model_config_scopes").all();
    assert.deepEqual(
      rows.map((row) => row["scope_key"]),
      ["project:github.com/acme/web"],
    );
    assert.equal(JSON.stringify(rows).includes("ghp_secret123"), false);
  });

  it("keeps remotes on different non-default ports of one host apart, for reads and writes", async () => {
    const { write, read, resolve } = setup();
    const portA = "ssh://git@git.example.com:2222/team/repo.git";
    const portB = "ssh://git@git.example.com:2223/team/repo.git";
    ok(await write({ set: [{ role: "bug-fix", entries: [opus()] }] }));
    const savedA = ok(await write({ project: portA, expectedRevision: 0, set: [{ role: "bug-fix", entries: [sol()] }] }));
    assert.equal(savedA["project"], "//git.example.com:2222/team/repo");

    const otherServer = ok(await read({ project: portB }));
    assert.equal(otherServer["project"], "//git.example.com:2223/team/repo");
    assert.equal(otherServer["projectScope"], undefined);
    const fallsThrough = ok(await resolve({ project: portB, roles: ["bug-fix"] }));
    assert.deepEqual(
      [fallsThrough["roles"][0]["source"], fallsThrough["roles"][0]["delegates"][0]["target"]["model"]],
      ["global", "claude-opus-5-5"],
    );

    ok(await write({ project: portB, expectedRevision: 0, set: [{ role: "perf-issue", entries: [inherit] }] }));
    const roleNames = async (project: string) =>
      ok(await read({ project }))["projectScope"]["roles"].map((role: Json) => role["role"]);
    assert.deepEqual(await roleNames(portA), ["bug-fix"]);
    assert.deepEqual(await roleNames(portB), ["perf-issue"]);
  });

  it("gives one key to the ssh, scp, and https forms of a remote on default ports, and none to other ports", async () => {
    const { write, read } = setup();
    ok(await write({ project: "git@git.example.com:team/repo.git", set: [{ role: "bug-fix", entries: [inherit] }] }));
    for (const same of [
      "ssh://git@git.example.com:22/team/repo.git",
      "https://git.example.com/team/repo",
      "https://git.example.com:443/team/repo/",
      "git+ssh://git@GIT.example.com/team/repo.git",
    ]) {
      const found = ok(await read({ project: same }));
      assert.equal(found["project"], "git.example.com/team/repo", same);
      assert.notEqual(found["projectScope"], undefined, same);
    }
    const otherPort = ok(await read({ project: "https://git.example.com:8443/team/repo" }));
    assert.equal(otherPort["project"], "//git.example.com:8443/team/repo");
    assert.equal(otherPort["projectScope"], undefined);
  });

  it("keeps path case on hosts whose paths may be case-sensitive, and folds it only for github.com", async () => {
    const { write, read } = setup();
    ok(await write({ project: "https://git.example.com/Team/Repo.git", set: [{ role: "bug-fix", entries: [inherit] }] }));
    const lower = ok(await read({ project: "https://git.example.com/team/repo.git" }));
    assert.equal(lower["project"], "git.example.com/team/repo");
    assert.equal(lower["projectScope"], undefined);
    assert.equal(ok(await read({ project: "git@git.example.com:Team/Repo" }))["project"], "git.example.com/Team/Repo");
    assert.equal(ok(await read({ project: "git@github.com:Acme/Web.git" }))["project"], "github.com/acme/web");
  });

  it("stores no user, password, token, query, or fragment from a remote URL", async () => {
    const { write, app } = setup();
    const saved = ok(
      await write({
        project: "https://ci-user:glpat-SECRET@git.example.com:8443/team/repo.git?private_token=QUERYSECRET#FRAGMENT",
        set: [{ role: "bug-fix", entries: [inherit] }],
      }),
    );
    assert.equal(saved["project"], "//git.example.com:8443/team/repo");
    const noPath = ok(await write({ project: "https://ci-user:PATHLESS@host.example", set: [{ role: "bug-fix", entries: [inherit] }] }));
    assert.equal(noPath["project"], "host.example");
    const stored = JSON.stringify(app.db.prepare("SELECT * FROM model_config_scopes").all());
    for (const secret of ["ci-user", "glpat-SECRET", "QUERYSECRET", "FRAGMENT", "PATHLESS", "private_token"]) {
      assert.equal(stored.includes(secret), false, `${secret} is not stored`);
    }
  });

  it("rejects a remote whose port is not a number", async () => {
    const { write } = setup();
    const error = failure(await write({ project: "https://git.example.com:abc/team/repo", set: [{ role: "bug-fix", entries: [inherit] }] }));
    assert.equal(error["code"], "model-config-rejected");
    assert.match(String(error["message"]), /\[project-invalid\]/);
  });

  it("accepts a returned non-default-port key back unchanged for read, resolve, patch, and reset, apart from the default-port repository at path 2222/...", async () => {
    const { app, write, read, resolve } = setup();
    const onPort = "ssh://git@git.example.com:2222/team/repo.git";
    const atPath = "https://git.example.com/2222/team/repo.git";
    const solPinned = sol({ reasoningEffort: "ultra", serviceTier: "priority" });
    const opusPinned = opus({ effort: "ultrathink", fastMode: false });

    const saved = ok(await write({ project: onPort, expectedRevision: 0, set: [{ role: "bug-fix", entries: [solPinned] }] }));
    const key = saved["project"];
    assert.equal(saved["scope"]["project"], key);
    const other = ok(await write({ project: atPath, expectedRevision: 0, set: [{ role: "bug-fix", entries: [opusPinned] }] }));
    assert.equal(other["project"], "git.example.com/2222/team/repo");
    assert.equal(ok(await read({ project: "git@git.example.com:2222/team/repo.git" }))["project"], other["project"], "scp `host:2222/...` is a path");

    for (const reused of [key, saved["scope"]["project"]]) {
      const found = ok(await read({ project: reused }));
      assert.equal(found["project"], key);
      assert.equal(found["projectScope"]["revision"], saved["scope"]["revision"]);
      assert.deepEqual(found["projectScope"]["roles"], saved["scope"]["roles"]);
    }
    const byRemote = ok(await resolve({ project: onPort, roles: ["bug-fix"] }));
    const byKey = ok(await resolve({ project: key, roles: ["bug-fix"] }));
    assert.deepEqual(byKey, byRemote, "a child given the returned key resolves what the parent resolved from the remote");
    assert.deepEqual(roleOf(byKey, "bug-fix")["delegates"][0]["target"], {
      providerInstanceId: "codex",
      model: "gpt-6.1-sol",
      options: { reasoningEffort: "ultra", serviceTier: "priority" },
    });
    assert.deepEqual(roleOf(ok(await resolve({ project: other["project"], roles: ["bug-fix"] })), "bug-fix")["delegates"][0]["target"], {
      providerInstanceId: "claudeAgent",
      model: "claude-opus-5-5",
      options: { effort: "ultrathink", fastMode: false },
    });

    const patched = ok(
      await write({
        project: saved["scope"]["project"],
        expectedRevision: saved["scope"]["revision"],
        set: [{ role: "perf-issue", entries: [inherit] }],
      }),
    );
    assert.equal(patched["project"], key);
    assert.deepEqual(patched["scope"]["roles"].map((role: Json) => role["role"]), ["bug-fix", "perf-issue"]);
    const reset = ok(await write({ project: patched["project"], expectedRevision: patched["scope"]["revision"], reset: true }));
    assert.equal(reset["deleted"], true);
    assert.equal(ok(await read({ project: onPort }))["projectScope"], undefined);

    const untouched = ok(await read({ project: atPath }))["projectScope"];
    assert.equal(untouched["revision"], other["scope"]["revision"]);
    assert.deepEqual(untouched["roles"], other["scope"]["roles"]);
    assert.deepEqual(
      app.db.prepare("SELECT scope_key FROM model_config_scopes").all().map((row) => row["scope_key"]),
      ["project:git.example.com/2222/team/repo"],
    );
  });

  it("accepts a returned case-folded key back unchanged for read, resolve, patch, and reset, with .GIT and .GIT.git/ endings", async () => {
    const key = "//github.com:2222/acme/web";
    const solPinned = sol({ reasoningEffort: "ultra", serviceTier: "priority" });
    const opusPinned = opus({ effort: "ultrathink", fastMode: false });
    // Other repositories, each with its own scope that no write below may touch.
    const distinct: [key: string, remote: string][] = [
      ["github.com/acme/web", "https://github.com/Acme/Web.GIT"],
      ["//github.com:2223/acme/web", "ssh://git@github.com:2223/Acme/Web.GIT"],
      ["github.com/2222/acme/web", "git@github.com:2222/Acme/Web.GIT"],
      ["//git.example.com:2222/Acme/Web.GIT", "ssh://git@git.example.com:2222/Acme/Web.GIT"],
      ["//git.example.com:2222/Acme/Web", "ssh://git@git.example.com:2222/Acme/Web.git"],
    ];

    for (const raw of ["ssh://git@github.com:2222/Acme/Web.GIT", "ssh://git@GitHub.com:2222/Acme/Web.GIT.git/"]) {
      const { app, write, read, resolve } = setup();
      const others = new Map<string, Json>();
      for (const [otherKey, remote] of distinct) {
        const other = ok(await write({ project: remote, expectedRevision: 0, set: [{ role: "bug-fix", entries: [opusPinned] }] }));
        assert.equal(other["project"], otherKey, remote);
        others.set(otherKey, other["scope"]);
      }

      const saved = ok(await write({ project: raw, expectedRevision: 0, set: [{ role: "bug-fix", entries: [solPinned] }] }));
      assert.equal(saved["project"], key, raw);
      assert.equal(saved["scope"]["project"], key, raw);
      for (const alias of [
        saved["project"],
        saved["scope"]["project"],
        "ssh://git@github.com:2222/acme/web.git",
        "https://github.com:2222/ACME/WEB",
        "//github.com:2222/Acme/Web.Git/",
      ]) {
        const found = ok(await read({ project: alias }));
        assert.equal(found["project"], key, alias);
        assert.equal(found["projectScope"]["revision"], saved["scope"]["revision"], alias);
        assert.deepEqual(found["projectScope"]["roles"], saved["scope"]["roles"], alias);
      }
      const aliasCreate = failure(
        await write({ project: "ssh://git@github.com:2222/acme/web.git", expectedRevision: 0, set: [{ role: "bug-fix", entries: [opusPinned] }] }),
      );
      assert.equal(aliasCreate["code"], "revision-conflict", "a lowercase alias names the scope just saved");

      const byRemote = ok(await resolve({ project: raw, roles: ["bug-fix"] }));
      const byKey = ok(await resolve({ project: saved["scope"]["project"], roles: ["bug-fix"] }));
      assert.deepEqual(byKey, byRemote);
      assert.deepEqual(roleOf(byKey, "bug-fix")["delegates"][0]["target"], {
        providerInstanceId: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "ultra", serviceTier: "priority" },
      });

      const patched = ok(
        await write({
          project: saved["scope"]["project"],
          expectedRevision: saved["scope"]["revision"],
          set: [{ role: "perf-issue", entries: [inherit] }],
        }),
      );
      assert.equal(patched["project"], key);
      assert.deepEqual(patched["scope"]["roles"].map((role: Json) => role["role"]), ["bug-fix", "perf-issue"]);
      const reset = ok(await write({ project: patched["project"], expectedRevision: patched["scope"]["revision"], reset: true }));
      assert.equal(reset["deleted"], true);
      assert.equal(ok(await read({ project: raw }))["projectScope"], undefined);

      for (const [otherKey, remote] of distinct) {
        const untouched = ok(await read({ project: remote }));
        assert.equal(untouched["project"], otherKey);
        assert.deepEqual(untouched["projectScope"], others.get(otherKey), remote);
      }
      assert.deepEqual(
        app.db.prepare("SELECT scope_key FROM model_config_scopes ORDER BY scope_key").all().map((row) => row["scope_key"]),
        distinct.map(([otherKey]) => `project:${otherKey}`).sort(),
      );
    }
  });

  it("rejects a port outside 1 to 65535, including one too long to print back as written, and saves nothing", async () => {
    const { app, write, read } = setup();
    for (const port of invalidPorts) {
      for (const remote of [`ssh://git@git.example.com:${port}/team/repo.git`, `//github.com:${port}/acme/web`]) {
        const error = failure(await write({ project: remote, set: [{ role: "bug-fix", entries: [inherit] }] }));
        assert.match(String(error["message"]), /\[project-invalid\] The remote's port must be from 1 to 65535/, remote);
        assert.equal(failure(await read({ project: remote }))["code"], "model-config-rejected", remote);
      }
    }
    assert.deepEqual(app.db.prepare("SELECT * FROM model_config_scopes").all(), []);

    for (const [remote, key] of [
      ["ssh://git@git.example.com:1/team/repo.git", "//git.example.com:1/team/repo"],
      ["ssh://git@git.example.com:65535/team/repo.git", "//git.example.com:65535/team/repo"],
      ["ssh://git@git.example.com:0000022/team/repo.git", "git.example.com/team/repo"],
      ["https://git.example.com:002222/team/repo.git", "//git.example.com:2222/team/repo"],
    ] as const) {
      const saved = ok(await write({ project: remote, set: [{ role: "bug-fix", entries: [inherit] }] }));
      assert.equal(saved["project"], key, remote);
      assert.equal(ok(await read({ project: saved["project"] }))["projectScope"]["revision"], saved["scope"]["revision"], remote);
    }
  });

  it("refuses a value whose key would change when passed back, and saves nothing", async () => {
    const { app, write } = setup();
    for (const remote of [
      "https://github.com/acme/web .git",
      "ssh://git@git.example.com:2222/team/repo /",
      "https:// git.example.com/team/repo",
      "git@ git.example.com:team/repo",
      "/srv/git/repo /",
      `https://github.com/acme/${"İ".repeat(300)}`,
    ]) {
      const error = failure(await write({ project: remote, set: [{ role: "bug-fix", entries: [inherit] }] }));
      assert.match(String(error["message"]), /\[project-invalid\] This value's key would change when passed back/, remote);
    }
    assert.deepEqual(app.db.prepare("SELECT * FROM model_config_scopes").all(), []);
  });
});

describe("project keys", () => {
  const keys: [remote: string, key: string][] = [
    ["https://github.com/Acme/Web.git", "github.com/acme/web"],
    ["git@github.com:Acme/Web.git", "github.com/acme/web"],
    ["git://git.example.com:9418/team/repo", "git.example.com/team/repo"],
    ["git.example.com:2222/team/repo", "git.example.com/2222/team/repo"],
    ["git@git.example.com:2222/team/repo.git", "git.example.com/2222/team/repo"],
    ["ssh://git@git.example.com:2222/team/repo.git", "//git.example.com:2222/team/repo"],
    ["ssh://git@git.example.com:2222/team/repo.git.git/", "//git.example.com:2222/team/repo"],
    ["ssh://git@git.example.com:02222/team/repo", "//git.example.com:2222/team/repo"],
    ["ssh://git@github.com:2222/Acme/Web.GIT", "//github.com:2222/acme/web"],
    ["https://GitHub.com:8443/Acme/Web.GIT.git/", "//github.com:8443/acme/web"],
    ["git@github.com:Acme/Web.GIT", "github.com/acme/web"],
    ["ssh://git@git.example.com:2222/Team/Repo.GIT", "//git.example.com:2222/Team/Repo.GIT"],
    ["ssh://git@git.example.com:2222", "//git.example.com:2222"],
    ["HTTPS://ci:glpat-SECRET@Git.Example.com:8443/Team/Repo/?private_token=Q#F", "//git.example.com:8443/Team/Repo"],
    ["https://git.example.com:22/team/repo", "//git.example.com:22/team/repo"],
    ["ssh://git@ssh.github.com:443/Acme/Web.git", "//ssh.github.com:443/Acme/Web"],
    ["ssh://git@[2001:DB8::1]:2222/team/repo.git", "//[2001:db8::1]:2222/team/repo"],
    ["ssh://git@[2001:db8::1]/team/repo.git", "[2001:db8::1]/team/repo"],
    ["git@[2001:db8::1]:team/repo.git", "[2001:db8::1]/team/repo"],
    ["//user:token@git.example.com:2222/team/repo/", "//git.example.com:2222/team/repo"],
    ["//git.example.com/team/repo", "git.example.com/team/repo"],
    ["file:///srv/git/repo.git", "file:///srv/git/repo"],
    ["constructor://git.example.com/team/repo", "constructor://git.example.com/team/repo"],
    ["/srv/git/repo/", "/srv/git/repo"],
    ["../repo", "../repo"],
  ];

  it("normalize every supported form to one key, and every key to itself", () => {
    for (const [remote, key] of keys) {
      assert.equal(normalizeProjectKey(remote), key, remote);
      assert.equal(normalizeProjectKey(key), key, `${remote} -> ${key} is stable`);
    }
  });

  it("reject remotes that name no host", () => {
    for (const remote of ["https:///team/repo", "//:2222/team/repo", "//git@:2222/team/repo"]) {
      assert.throws(() => normalizeProjectKey(remote), (error: Json) => error["problems"][0]["code"] === "project-invalid", remote);
    }
  });

  it("give every generated remote a stable key, shared exactly by the remotes naming one endpoint and repository", () => {
    const result = sweep(normalizeProjectKey, {
      schemes: ["https", "SSH", "git+ssh", "git"],
      hosts: ["Git.Example.COM", "github.com", "GitHub.COM", "ssh.github.com", "[2001:DB8::1]"],
      ports: [undefined, "22", "443", "9418", "2222", "8443", "02222", "65535"],
      repositories: ["team/repo", "Team/Repo", "2222/team/repo"],
      caseSuffixes: ["", ".GIT", ".Git"],
      trims: ["", ".git", "/", ".git.git/", "//"],
      leadings: ["", "/"],
      decorations: [
        { user: "", tail: "" },
        { user: "git@", tail: "#FRAGSECRET" },
        { user: "ci:TOKEN@", tail: "?private_token=QSECRET" },
      ],
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.remotes, 54_900);
    // Three case-sensitive hosts keep 9 paths each, github.com folds them to 2; 7 distinct ports, default included.
    assert.equal(result.identities, (3 * 9 + 2) * 7);
    assert.equal(result.keys, result.identities);
  });
});

describe("validation against the caller's catalog", () => {
  const rejected = async (input: Json) => {
    const { write, read } = setup();
    ok(await write({ set: [{ role: "bug-fix", entries: [sol()] }] }));
    const error = failure(await write(input));
    const after = ok(await read())["global"];
    assert.equal(after["revision"], 1, "a rejected write saves nothing");
    return error;
  };
  const codes = (error: Json): string[] =>
    [...String(error["message"]).matchAll(/\[([a-z-]+)\]/g)].map((match) => match[1]!);

  it("rejects a disabled provider with its constraints", async () => {
    const error = await rejected({
      set: [{ role: "bug-fix", entries: [{ use: "model", providerInstanceId: "grok", model: "grok-build" }] }],
    });
    assert.equal(error["code"], "model-config-rejected");
    assert.deepEqual(codes(error), ["provider-cannot-run-child-task"]);
    assert.match(String(error["message"]), /Grok is disabled in T3 Code settings\./);
  });

  it("rejects unknown providers and models, naming what the catalog offers", async () => {
    const error = await rejected({
      set: [
        { role: "bug-fix", entries: [{ use: "model", providerInstanceId: "openai", model: "gpt-6.1-sol" }] },
        { role: "perf-issue", entries: [{ use: "model", providerInstanceId: "codex", model: "gpt-9" }] },
      ],
    });
    assert.deepEqual(codes(error), ["provider-missing", "model-missing"]);
    assert.match(String(error["message"]), /Offered: "gpt-6\.1-sol", "gpt-6-luna"/);
  });

  it("rejects option ids and values the model does not advertise, exactly as spelled", async () => {
    const error = await rejected({
      set: [
        { role: "bug-fix", entries: [sol({ effort: "high" })] },
        { role: "perf-issue", entries: [sol({ ReasoningEffort: "high" })] },
        { role: "hillclimb", entries: [sol({ reasoningEffort: "extreme" })] },
        { role: "hardest tasks", entries: [sol({ reasoningEffort: true })] },
        { role: "judgment and prose", entries: [opus({ fastMode: "true" })] },
        { role: "how explainer", entries: [{ use: "model", providerInstanceId: "codex", model: "gpt-6-luna", options: { reasoningEffort: "ultra" } }] },
      ],
    });
    assert.deepEqual(codes(error), [
      "option-unsupported",
      "option-unsupported",
      "option-value-invalid",
      "option-value-invalid",
      "option-value-invalid",
      "option-value-invalid",
    ]);
  });

  it("rejects option values that are neither strings nor booleans", async () => {
    const error = await rejected({ set: [{ role: "bug-fix", entries: [sol({ reasoningEffort: { level: "high" } })] }] });
    assert.deepEqual(codes(error), ["option-value-invalid"]);
  });

  it("rejects an option type it cannot validate instead of accepting it", async () => {
    const { write } = setup();
    const catalog = liveCatalog();
    catalog.providers[0]!.models[0]!.options!.push({ id: "temperature", label: "Temperature", type: "slider" });
    const error = failure(
      await write({ catalog, set: [{ role: "bug-fix", entries: [sol({ temperature: "0.2" })] }] }),
    );
    assert.deepEqual(codes(error), ["option-type-unsupported"]);
  });

  it("rejects a cross-provider child when the catalog says the provider cannot run one", async () => {
    const { write } = setup();
    const catalog = liveCatalog();
    catalog.providers[0]!.canRunCrossProviderChildTask = false;
    const error = failure(await write({ catalog, set: [{ role: "bug-fix", entries: [sol()] }] }));
    assert.deepEqual(codes(error), ["cross-provider-unsupported"]);
    ok(await write({ catalog, set: [{ role: "bug-fix", entries: [opus()] }] }));
  });

  it("enforces single-role and panel arity", async () => {
    const error = await rejected({
      set: [
        { role: "bug-fix", entries: [sol(), opus()] },
        { role: "arena runners", entries: [] },
        { role: "architect runners", entries: Array(17).fill(inherit) },
      ],
    });
    assert.deepEqual(codes(error), ["role-arity", "role-arity", "role-arity"]);
  });

  it("rejects malformed entries, unknown roles, and conflicting role edits", async () => {
    const error = await rejected({
      set: [
        { role: "bug-fix", entries: [{ use: "inherit-parent", model: "gpt-6.1-sol" }] },
        { role: "perf-issue", entries: [{ use: "auto" }] },
        { role: "hillclimb", entries: [{ use: "model", providerInstanceId: "codex" }] },
        { role: "feature", entries: [inherit] },
        { role: "hardest tasks", entries: [{ ...sol({ reasoningEffort: "high" }), presetKeys: ["serviceTier"] }] },
      ],
      unset: ["how explorer"],
    });
    assert.deepEqual(codes(error), ["entry-shape", "entry-shape", "entry-shape", "unknown-role", "preset-key-invalid"]);

    const conflict = await rejected({ set: [{ role: "bug-fix", entries: [inherit] }], unset: ["bug-fix"] });
    assert.deepEqual(codes(conflict), ["role-conflict"]);
  });

  it("rejects unknown presets and delivery modes, and providers absent from the catalog", async () => {
    const error = await rejected({
      budget: "huge",
      skillDelivery: [
        { providerInstanceId: "codex", mode: "pasted" },
        { providerInstanceId: "openai", mode: "inline" },
      ],
    });
    assert.deepEqual(codes(error), ["budget-invalid", "skill-delivery-invalid", "provider-missing"]);
  });

  it("rejects an ambiguous catalog", async () => {
    const { write } = setup();
    const catalog = liveCatalog();
    catalog.providers.push(catalog.providers[0]!);
    const error = failure(await write({ catalog, set: [{ role: "bug-fix", entries: [inherit] }] }));
    assert.deepEqual(codes(error), ["catalog-invalid"]);
  });

  it("rejects structurally malformed input at the tool boundary", async () => {
    const { write, app } = setup();
    const missingProviders = failure(await app.call("models.write", "mutation", { catalog: { models: [] } }));
    assert.equal(missingProviders["_tag"], "HostInputInvalid");
    const entriesNotArray = failure(await write({ set: [{ role: "bug-fix", entries: sol() }] }));
    assert.equal(entriesNotArray["_tag"], "HostInputInvalid");
    const flagAsString = failure(
      await write({ catalog: { providers: [{ providerInstanceId: "codex", canRunChildTask: "yes", models: [] }] } }),
    );
    assert.equal(flagAsString["_tag"], "HostInputInvalid");
    const emptyProject = failure(await write({ project: "   ", set: [{ role: "bug-fix", entries: [inherit] }] }));
    assert.equal(emptyProject["code"], "model-config-rejected");
    assert.deepEqual(codes(emptyProject), ["project-invalid"]);
  });
});

describe("resolution never substitutes", () => {
  it("marks a role invalid when its model leaves the catalog, and keeps resolving the rest", async () => {
    const { write, resolve } = setup();
    ok(
      await write({
        set: [
          { role: "bug-fix", entries: [{ use: "model", providerInstanceId: "codex", model: "gpt-6-luna" }] },
          { role: "interrogate reviewers", entries: [opus(), { use: "model", providerInstanceId: "codex", model: "gpt-6-luna" }] },
          { role: "perf-issue", entries: [opus()] },
        ],
      }),
    );
    const catalog = liveCatalog();
    catalog.providers[0]!.models = catalog.providers[0]!.models.filter((model) => model.id !== "gpt-6-luna");
    const resolution = ok(await resolve({ catalog, roles: ["bug-fix", "interrogate reviewers", "perf-issue"] }));
    assert.equal(resolution["ok"], false);
    assert.deepEqual(
      resolution["roles"].map((role: Json) => [role["status"], role["delegates"].length, role["problems"].map((p: Json) => [p["code"], p["entry"]])]),
      [
        ["invalid", 0, [["model-missing", 0]]],
        ["invalid", 0, [["model-missing", 1]]],
        ["configured", 1, []],
      ],
    );
  });

  it("marks a role invalid when its provider is disabled or its saved option value is withdrawn", async () => {
    const { write, resolve } = setup();
    ok(
      await write({
        set: [
          { role: "bug-fix", entries: [sol({ reasoningEffort: "ultra" })] },
          { role: "perf-issue", entries: [opus({ effort: "high" })] },
        ],
      }),
    );
    const catalog = liveCatalog();
    const effort = catalog.providers[0]!.models[0]!.options![0]!;
    effort.options = effort.options!.filter((value) => value.id !== "ultra");
    catalog.providers[1]!.canRunChildTask = false;
    catalog.providers[1]!.constraints = ["Provider instance is disabled."];
    const resolution = ok(await resolve({ catalog, roles: ["bug-fix", "perf-issue"] }));
    assert.deepEqual(
      resolution["roles"].map((role: Json) => role["problems"].map((p: Json) => p["code"])),
      [["option-value-invalid"], ["provider-cannot-run-child-task"]],
    );
  });

  it("reports stale stored roles after a write without blocking unrelated edits", async () => {
    const { write } = setup();
    ok(await write({ set: [{ role: "bug-fix", entries: [{ use: "model", providerInstanceId: "codex", model: "gpt-6-luna" }] }] }));
    const catalog = liveCatalog();
    catalog.providers[0]!.models.pop();
    const saved = ok(await write({ catalog, set: [{ role: "perf-issue", entries: [opus()] }] }));
    assert.deepEqual(
      saved["staleInScope"].map((problem: Json) => [problem["role"], problem["code"]]),
      [["bug-fix", "model-missing"]],
    );
  });

  it("rejects unknown role names in a resolve request", async () => {
    const { resolve } = setup();
    const error = failure(await resolve({ roles: ["bug-fix", "reviewers"] }));
    assert.equal(error["code"], "model-config-rejected");
    assert.match(String(error["message"]), /\[unknown-role\] reviewers/);
  });
});

describe("skill delivery", () => {
  it("follows the provider each delegate actually runs on, including inherited ones", async () => {
    const { write, resolve } = setup();
    ok(
      await write({
        set: [
          { role: "swarm workers", entries: [inherit] },
          { role: "arena runners", entries: [sol(), opus()] },
        ],
        skillDelivery: [
          { providerInstanceId: "claudeAgent", mode: "inline" },
          { providerInstanceId: "codex", mode: "executor-read" },
        ],
      }),
    );
    ok(await write({ project: "github.com/acme/web", skillDelivery: [{ providerInstanceId: "codex", mode: "inline" }] }));

    const global = ok(await resolve({ roles: ["swarm workers", "arena runners"] }));
    assert.deepEqual(
      global["roles"].map((role: Json) => role["delegates"].map((d: Json) => d["skillDelivery"])),
      [["inline"], ["executor-read", "inline"]],
    );
    const project = ok(await resolve({ project: "github.com/acme/web", roles: ["arena runners"] }));
    assert.deepEqual(project["roles"][0]["delegates"].map((d: Json) => d["skillDelivery"]), ["inline", "inline"]);

    ok(await write({ skillDelivery: [{ providerInstanceId: "claudeAgent", mode: "unset" }] }));
    const cleared = ok(await resolve({ roles: ["swarm workers"] }));
    assert.equal(cleared["roles"][0]["delegates"][0]["skillDelivery"], "unknown");
  });
});

describe("concurrency and storage", () => {
  it("rejects a write based on a stale revision and saves nothing", async () => {
    const { write, read } = setup();
    ok(await write({ expectedRevision: 0, set: [{ role: "bug-fix", entries: [sol()] }] }));
    const firstAgain = failure(await write({ expectedRevision: 0, set: [{ role: "bug-fix", entries: [opus()] }] }));
    assert.equal(firstAgain["code"], "revision-conflict");
    ok(await write({ expectedRevision: 1, set: [{ role: "perf-issue", entries: [opus()] }] }));
    const stale = failure(await write({ expectedRevision: 1, unset: ["bug-fix"] }));
    assert.equal(stale["code"], "revision-conflict");
    const saved = ok(await read())["global"];
    assert.equal(saved["revision"], 2);
    assert.deepEqual(
      saved["roles"].map((role: Json) => role["role"]),
      ["bug-fix", "perf-issue"],
    );
  });

  it("rejects a stale write after its scope is deleted and created again", async () => {
    const { write, read } = setup();
    const project = "https://github.com/review/project.git";
    const sessionA = ok(await write({ project, expectedRevision: 0, set: [{ role: "bug-fix", entries: [inherit] }] }));
    const revisionA = sessionA["scope"]["revision"];

    const deleted = ok(await write({ project, expectedRevision: revisionA, reset: true }));
    assert.equal(deleted["deleted"], true);
    assert.equal(ok(await read({ project }))["projectScope"], undefined, "a deleted scope reads as absent");
    const recreated = ok(
      await write({ project, expectedRevision: 0, set: [{ role: "feature, refactoring", entries: [inherit] }] }),
    );
    assert.notEqual(recreated["scope"]["revision"], revisionA, "a new incarnation never reuses a revision");

    const stale = failure(
      await write({ project, expectedRevision: revisionA, reset: true, set: [{ role: "bug-fix", entries: [inherit] }] }),
    );
    assert.equal(stale["code"], "revision-conflict");
    const after = ok(await read({ project }))["projectScope"];
    assert.equal(after["revision"], recreated["scope"]["revision"]);
    assert.deepEqual(after["roles"].map((role: Json) => role["role"]), ["feature, refactoring"]);

    const staleCreate = failure(await write({ project, expectedRevision: 0, set: [{ role: "bug-fix", entries: [inherit] }] }));
    assert.equal(staleCreate["code"], "revision-conflict", "expectedRevision 0 no longer matches once it exists");
  });

  it("guards the global scope the same way, and never conflicts across scopes", async () => {
    const { write, read } = setup();
    const sessionA = ok(await write({ expectedRevision: 0, set: [{ role: "bug-fix", entries: [sol()] }] }));
    const revisionA = sessionA["scope"]["revision"];

    ok(await write({ project: "github.com/acme/web", expectedRevision: 0, set: [{ role: "bug-fix", entries: [opus()] }] }));
    const unchanged = ok(await read())["global"]["revision"];
    assert.equal(unchanged, revisionA, "a project write leaves the global revision alone");

    ok(await write({ expectedRevision: revisionA, reset: true }));
    const projectOnly = ok(await read({ project: "github.com/acme/web" }));
    assert.equal(projectOnly["global"], undefined);
    assert.notEqual(projectOnly["projectScope"], undefined, "deleting global leaves the project scope");
    const recreated = ok(await write({ expectedRevision: 0, set: [{ role: "hillclimb", entries: [inherit] }] }));
    assert.notEqual(recreated["scope"]["revision"], revisionA);

    const stale = failure(await write({ expectedRevision: revisionA, set: [{ role: "bug-fix", entries: [inherit] }] }));
    assert.equal(stale["code"], "revision-conflict");
    assert.deepEqual(ok(await read())["global"]["roles"].map((role: Json) => role["role"]), ["hillclimb"]);
  });

  it("continues revisions above those already stored when the revision migration is applied", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(join(appDir, "migrations", "0001_model_config.sql"), "utf8"));
    db.prepare(
      "INSERT INTO model_config_scopes (scope_key, project, document, revision, updated_at) VALUES ('global', NULL, ?, 5, 0)",
    ).run(JSON.stringify({ version: 1, roles: { "bug-fix": [{ use: "inherit-parent" }] }, skillDelivery: {} }));
    db.exec(readFileSync(join(appDir, "migrations", "0002_revision_clock.sql"), "utf8"));
    const app = host(db);
    const next = ok(
      await app.call("models.write", "mutation", {
        catalog: liveCatalog(),
        project: "github.com/acme/web",
        expectedRevision: 0,
        set: [{ role: "bug-fix", entries: [inherit] }],
      }),
    );
    assert.equal(next["scope"]["revision"], 6);
  });

  it("refuses to use a stored document it cannot parse", async () => {
    const { app, resolve } = setup();
    app.db
      .prepare(
        "INSERT INTO model_config_scopes (scope_key, project, document, revision, updated_at) VALUES ('global', NULL, ?, 1, 0)",
      )
      .run(JSON.stringify({ version: 1, roles: { "bug-fix": [{ use: "auto" }] }, skillDelivery: {} }));
    const error = failure(await resolve());
    assert.equal(error["code"], "stored-config-corrupt");
  });
});
