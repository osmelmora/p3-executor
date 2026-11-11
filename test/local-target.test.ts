import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  entrySkill,
  install,
  manifestName,
  namedSkills,
  parseOverlay,
  planInstall,
  readManifest,
  renderLocal,
  root,
  routerDependent,
  select,
  skillNames,
  sourceFiles,
  standaloneSkills,
  uninstall,
  type LocalFile,
} from "../scripts/local-target.ts";

const source = sourceFiles();
const overlay = parseOverlay();
const local = renderLocal();
const text = (files: readonly LocalFile[], path: string) => files.find((file) => file.path === path)!.content;
const scratch = () => mkdtempSync(join(tmpdir(), "p3-local-"));

const lines = (pattern: RegExp, skip: (path: string) => boolean = () => false) =>
  local.flatMap((file) =>
    skip(file.path)
      ? []
      : file.content.split("\n").flatMap((line, index) => (pattern.test(line) ? [`${file.path}:${index + 1}`] : [])),
  );

describe("local-install target", () => {
  it("renders every source skill plus the local p3 entry skill, changing only the files the overlay names", () => {
    assert.deepEqual(skillNames(local), [...skillNames(source), entrySkill].sort());
    assert.equal(skillNames(local).length, 60);
    const overlaid = new Set(overlay.map((replacement) => replacement.file));
    for (const file of source) {
      const rendered = text(local, file.path);
      if (overlaid.has(file.path)) assert.notEqual(rendered, file.content, `${file.path} is rewritten`);
      else assert.equal(rendered, file.content, `${file.path} is copied as is`);
    }
    for (const skill of skillNames(local)) {
      assert.match(text(local, `${skill}/SKILL.md`), new RegExp(`^---\\n(?:.*\\n)*?name: ${skill}\\n`), `${skill} names itself`);
    }
  });

  it("fails the render when the source text an overlay block replaces has changed", () => {
    const block = overlay.find((replacement) => replacement.file === "reflect/SKILL.md")!;
    const drifted = source.map((file) =>
      file.path === block.file ? { ...file, content: file.content.replace(block.executor, "A p3 skill is edited elsewhere.") } : file,
    );
    assert.throws(() => renderLocal(drifted), /reflect\/SKILL\.md has 0 matches, expected 1/);
    assert.throws(() => renderLocal(source, [{ ...block, file: "reflect/MISSING.md" }]), /is not a file under app\/skills/);
    assert.throws(() => parseOverlay("## a.md\n@@ executor\nx\n@@ local\ny\n"), /no @@ end/);
    assert.throws(() => parseOverlay("@@ executor\nx\n@@ local\ny\n@@ end\n"), /needs a "## <file>" heading/);
  });

  it("never mentions Executor: no skill text, entry point, or command depends on it", () => {
    const sharedCode = (path: string) => path.startsWith("p3-mode/scripts/lib/");
    assert.deepEqual(lines(/executor/i, sharedCode), []);
    assert.deepEqual(lines(/\{app[,:]|`skills` tool|app slug|tools\.<|profileRevision|\bthis app\b|Nothing is installed locally|\bredeploy|\bdeployment\b/, sharedCode), []);
    assert.deepEqual(lines(/save it (once )?outside the repository/), [], "bundled scripts run in place");
  });

  it("reads skills from the skills root and model choices through the local command", () => {
    const mode = text(local, "p3-mode/SKILL.md");
    assert.match(mode, /Read a skill by reading `<skills root>\/<name>\/SKILL\.md` in full\./);
    assert.match(mode, /`<skills root>\/\.p3-install\.json` records the installed `version`/);
    assert.match(mode, /run `node <skills root>\/p3-mode\/scripts\/models\.ts <read\|write\|resolve> <that file>`, and read the JSON it prints\./);
    assert.match(mode, /"Read `<skills root>\/p3-mode\/SKILL\.md` and follow its Coordinating child branch\. If you cannot read that file or run its model command, do no work and reply exactly `P3_SKILLS_UNAVAILABLE`\."/);
    const prompt = /## Scheduled ticks\n\n.*\n\n"(.+)"\n/.exec(mode)?.[1];
    assert.ok(prompt, "p3-mode defines the tick prompt");
    for (const part of ["<skills root>/p3-mode/SKILL.md", "<skills root>/p3-mode/<playbook path>", "<skills root>/.p3-install.json", "repository <absolute path>", "delegated task ids in <path>"]) {
      assert.ok(prompt.includes(part), `tick prompt carries ${part}`);
    }
    for (const call of ["models.read", "models.resolve", "models.write"]) assert.ok(mode.includes(call), `p3-mode still calls ${call}`);
    for (const file of ["models.ts", "file-store.ts", "lib/service.ts", "lib/model-config.ts"]) {
      const content = text(local, `p3-mode/scripts/${file}`);
      assert.doesNotMatch(content, /from "[^"]*(app\/lib|apps)[^"]*"|from "\.[^"]*\.js"/, `${file} imports only what the install ships`);
    }

    const entry = text(local, `${entrySkill}/SKILL.md`);
    assert.match(entry, /Read `p3-mode\/SKILL\.md` in the directory that holds this skill's directory\./);
    assert.ok(entry.length < 2000, "the entry skill carries no workflow text");
    assert.equal(manifestName, ".p3-install.json");
  });

  it("picks standalone skills that need no router, no Executor, and no skill outside the set", () => {
    const standalone = standaloneSkills(local);
    assert.equal(standalone.length, 34);
    for (const skill of standalone) {
      const body = local.filter((file) => file.path.startsWith(`${skill}/`) && file.path.endsWith(".md")).map((file) => file.content).join("\n");
      assert.doesNotMatch(body, routerDependent, skill);
      for (const named of namedSkills(local, skill)) assert.ok(standalone.includes(named), `${skill} names ${named}`);
    }
    for (const skill of ["tdd", "unslop", "technical-writing", "statechart", "principle-laziness-protocol"]) {
      assert.ok(standalone.includes(skill), `${skill} is standalone`);
    }
    for (const skill of [entrySkill, "p3-mode", "setup-p3", "how", "swarm"]) {
      assert.ok(!standalone.includes(skill), `${skill} needs the router`);
    }
    assert.deepEqual(select("standalone").manifest.skills, standalone);
    assert.notEqual(select("standalone").manifest.version, select("full").manifest.version);
  });
});

describe("local installer", () => {
  it("writes the rendered files with their modes and a manifest, and is a no-op the second time", () => {
    const dest = join(scratch(), "skills");
    const full = select("full");
    assert.equal(install(dest, full).unchanged, false);
    assert.deepEqual(readdirSync(dest).sort(), [manifestName, ...full.manifest.skills].sort());
    for (const file of full.files) assert.equal(readFileSync(join(dest, file.path), "utf8"), file.content, file.path);
    assert.ok(statSync(join(dest, "show-me-your-work", "scripts", "log.sh")).mode & 0o100, "log.sh stays executable");
    assert.ok(statSync(join(dest, "statechart", "scripts", "statechart")).mode & 0o100, "the statechart launcher stays executable");
    assert.deepEqual(readManifest(dest), full.manifest);
    assert.equal(planInstall(dest, full).unchanged, true);
  });

  it("leaves directories it did not install alone, and writes nothing when one is in the way", () => {
    const dest = scratch();
    mkdirSync(join(dest, "tdd"));
    writeFileSync(join(dest, "tdd", "SKILL.md"), "mine");
    mkdirSync(join(dest, "my-own-skill"));
    assert.throws(() => install(dest, select("full")), /not installed by p3, so left alone: tdd$/);
    assert.deepEqual(readdirSync(dest).sort(), ["my-own-skill", "tdd"]);
    assert.equal(readFileSync(join(dest, "tdd", "SKILL.md"), "utf8"), "mine");

    assert.deepEqual(install(dest, select("full"), { force: true }).conflicts, ["tdd"]);
    assert.notEqual(readFileSync(join(dest, "tdd", "SKILL.md"), "utf8"), "mine");
    assert.ok(existsSync(join(dest, "my-own-skill")));
  });

  it("replaces a symlinked skill under --force without touching what the link points at", () => {
    const dest = scratch();
    const checkout = scratch();
    writeFileSync(join(checkout, "SKILL.md"), "upstream checkout");
    symlinkSync(checkout, join(dest, "how"));
    install(dest, select("full"), { force: true });
    assert.equal(readFileSync(join(checkout, "SKILL.md"), "utf8"), "upstream checkout");
    assert.ok(statSync(join(dest, "how", "references")).isDirectory());
  });

  it("removes skills a narrower reinstall drops, and uninstalls only what it owns", () => {
    const dest = scratch();
    mkdirSync(join(dest, "my-own-skill"));
    install(dest, select("full"));
    const narrowed = install(dest, select("standalone"));
    assert.ok(narrowed.stale.includes("p3-mode") && narrowed.stale.includes(entrySkill));
    assert.deepEqual(readdirSync(dest).sort(), [manifestName, "my-own-skill", ...select("standalone").manifest.skills].sort());
    assert.equal(uninstall(dest).length, 34);
    assert.deepEqual(readdirSync(dest), ["my-own-skill"]);
    assert.deepEqual(uninstall(dest), []);
  });

  it("refuses a manifest whose skill names could escape the skills directory", () => {
    const dest = scratch();
    writeFileSync(join(dest, manifestName), JSON.stringify({ version: "x", mode: "full", upstream: "x", skills: ["../outside"] }));
    assert.throws(() => uninstall(dest), /not a p3 install manifest/);
  });

  it("runs from a plain checkout with node alone, and exits non-zero on a conflict", () => {
    const dest = scratch();
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [join(root, "scripts", "install-local.ts"), "--dir", dest, ...args], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
    const dry = run("--dry-run");
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /would install 60 skills, version [0-9a-f]{12}/);
    assert.deepEqual(readdirSync(dest), []);

    mkdirSync(join(dest, "unslop"));
    const blocked = run();
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /were not installed by p3, so nothing was written/);
    assert.deepEqual(readdirSync(dest), ["unslop"]);

    const alone = run("--standalone", "--force");
    assert.equal(alone.status, 0, alone.stderr);
    assert.match(alone.stdout, /installed 34 skills.*replaced unslop/);
    assert.equal(run("--uninstall").status, 0);
    assert.deepEqual(readdirSync(dest), []);
  });
});

describe("local model command", () => {
  const dest = join(scratch(), "skills");
  install(dest, select("full"));
  const home = scratch();
  const command = join(dest, "p3-mode", "scripts", "models.ts");
  const catalog = JSON.parse(readFileSync(join(root, "test", "fixtures", "live-capabilities.json"), "utf8")) as {
    providers: { providerInstanceId: string; canRunChildTask: boolean; models: { id: string }[] }[];
  };
  const provider = catalog.providers.find((candidate) => candidate.canRunChildTask)!;
  const entry = { use: "model", providerInstanceId: provider.providerInstanceId, model: provider.models[0]!.id };
  type Reply = { status: number; value: Record<string, any> };
  const run = (name: string, input?: unknown, env: Record<string, string> = {}): Reply => {
    const args = [command, name];
    if (input !== undefined) {
      const file = join(scratch(), "input.json");
      writeFileSync(file, JSON.stringify(input));
      args.push(file);
    }
    const result = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", P3_HOME: home, ...env } });
    return { status: result.status ?? -1, value: JSON.parse(result.stdout) as Record<string, any> };
  };

  it("runs from the installed copy with node alone and starts unconfigured", () => {
    assert.equal(run("where").value["file"], join(home, "models.json"));
    const read = run("read");
    assert.equal(read.status, 0);
    assert.equal(read.value["configured"], false);
    assert.equal(read.value["roleCatalog"].length, 17);
    assert.equal(run("resolve", { catalog }).value["setupRequired"], true);
    assert.equal(existsSync(join(home, "models.json")), false, "reading creates no file");
  });

  it("saves choices to the file, resolves them to delegate targets, and layers a project over global", () => {
    const saved = run("write", { catalog, expectedRevision: 0, budget: "medium", set: [{ role: "bug-fix", entries: [entry] }, { role: "swarm workers", entries: [{ use: "inherit-parent" }] }] });
    assert.equal(saved.status, 0, JSON.stringify(saved.value));
    assert.equal(saved.value["scope"]["revision"], 1);
    const project = "git@github.com:example/repo.git";
    const scoped = run("write", { catalog, project, expectedRevision: 0, set: [{ role: "bug-fix", entries: [{ use: "inherit-parent" }] }] });
    assert.equal(scoped.value["scope"]["revision"], 2, "one clock for the whole file");

    const roles = (reply: Reply) => Object.fromEntries((reply.value["roles"] as any[]).map((role) => [role.role, role]));
    const global = roles(run("resolve", { catalog, roles: ["bug-fix", "swarm workers", "hillclimb"] }));
    assert.deepEqual(global["bug-fix"].delegates[0].target, { providerInstanceId: entry.providerInstanceId, model: entry.model });
    assert.equal(global["swarm workers"].delegates[0].inheritParent, true);
    assert.equal(global["hillclimb"].status, "unset");
    const layered = roles(run("resolve", { catalog, project, roles: ["bug-fix", "swarm workers"] }));
    assert.equal(layered["bug-fix"].delegates[0].inheritParent, true);
    assert.equal(layered["bug-fix"].source, "project");
    assert.equal(layered["swarm workers"].source, "global");

    const stored = JSON.parse(readFileSync(join(home, "models.json"), "utf8")) as { version: number; clock: number; scopes: Record<string, unknown> };
    assert.equal(stored.version, 1);
    assert.equal(stored.clock, 2);
    assert.equal(Object.keys(stored.scopes).length, 2);
  });

  it("rejects stale revisions, unknown models, and malformed input with a code and exit 1, saving nothing", () => {
    const before = readFileSync(join(home, "models.json"), "utf8");
    const stale = run("write", { catalog, expectedRevision: 0, set: [{ role: "hillclimb", entries: [entry] }] });
    assert.equal(stale.status, 1);
    assert.equal(stale.value["error"]["code"], "revision-conflict");
    assert.equal(stale.value["error"]["currentRevision"], 1);
    const unknown = run("write", { catalog, expectedRevision: 1, set: [{ role: "hillclimb", entries: [{ ...entry, model: "no-such-model" }] }] });
    assert.equal(unknown.value["error"]["code"], "model-config-rejected");
    assert.equal(unknown.value["error"]["problems"][0]["code"], "model-missing");
    assert.equal(run("resolve", { roles: ["bug-fix"] }).value["error"]["code"], "invalid-input");
    assert.equal(run("write", { catalog, set: "bug-fix" }).value["error"]["code"], "invalid-input");
    assert.equal(run("explode").value["error"]["code"], "invalid-input");
    assert.equal(readFileSync(join(home, "models.json"), "utf8"), before);
  });

  it("never reuses a revision after a scope is deleted, and reports a corrupt file", () => {
    const cleared = run("write", { catalog, expectedRevision: 1, reset: true });
    assert.equal(cleared.value["deleted"], true);
    const again = run("write", { catalog, expectedRevision: 0, set: [{ role: "bug-fix", entries: [entry] }] });
    assert.equal(again.value["scope"]["revision"], 3);
    const broken = scratch();
    writeFileSync(join(broken, "models.json"), "{ not json");
    const corrupt = run("read", undefined, { P3_HOME: broken });
    assert.equal(corrupt.status, 1);
    assert.equal(corrupt.value["error"]["code"], "stored-config-corrupt");
  });
});
