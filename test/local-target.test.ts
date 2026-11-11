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

  it("carries no instruction to read p3 skills from Executor", () => {
    const transcriptShapes = (path: string) => /^reflect\/references\/(judgment|tooling|divergent)-reviewer\.md$/.test(path);
    assert.deepEqual(lines(/\{app[,:]|`skills` tool/, transcriptShapes), []);
    assert.deepEqual(lines(/profileRevision|\bthis (Executor )?app\b|Nothing is installed locally|\bredeploy|\bdeployment\b/), []);
    assert.deepEqual(lines(/Executor returns|save it (once )?outside the repository/), [], "bundled scripts run in place");
    const mentions = new Set(lines(/Executor/).map((where) => where.split(":")[0]));
    assert.deepEqual([...mentions].sort(), [
      "p3-agent/SKILL.md",
      "p3-help/SKILL.md",
      "p3-mode/SKILL.md",
      "p3/SKILL.md",
      "reflect/references/divergent-reviewer.md",
      "reflect/references/judgment-reviewer.md",
      "reflect/references/tooling-reviewer.md",
      "setup-p3/SKILL.md",
    ]);
  });

  it("reads skills from the skills root and keeps model choices in the Executor app", () => {
    const mode = text(local, "p3-mode/SKILL.md");
    assert.match(mode, /Read a skill by reading `<skills root>\/<name>\/SKILL\.md` in full\./);
    assert.match(mode, /`<skills root>\/\.p3-install\.json` records the installed `version`/);
    assert.match(mode, /Call the p3 app's tools inside Executor `execute` at `tools\.<app slug>\.models\.\*`\. The slug is `p3` unless/);
    assert.match(mode, /"Read `<skills root>\/p3-mode\/SKILL\.md` and follow its Coordinating child branch\. If you cannot read that file, or cannot call Executor's `execute` tool, do no work and reply exactly `P3_SKILLS_UNAVAILABLE`\."/);
    const prompt = /## Scheduled ticks\n\n.*\n\n"(.+)"\n/.exec(mode)?.[1];
    assert.ok(prompt, "p3-mode defines the tick prompt");
    for (const part of ["<skills root>/p3-mode/SKILL.md", "<skills root>/p3-mode/<playbook path>", "<skills root>/.p3-install.json", "repository <absolute path>", "delegated task ids in <path>"]) {
      assert.ok(prompt.includes(part), `tick prompt carries ${part}`);
    }
    for (const call of ["models.read", "models.resolve", "models.write"]) assert.ok(mode.includes(call), `p3-mode still calls ${call}`);

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
