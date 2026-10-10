import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileSkill } from "apps/skills";
import { join } from "node:path";
import { describe, it } from "node:test";
import { roleKinds } from "../app/lib/model-config.ts";
import { principleNames } from "../scripts/child-briefs.ts";
import { appDir, host } from "./harness.ts";

type Skill = { name: string; description: string; files: { path: string; content: string }[] };

const loadCatalog = async (): Promise<Skill[]> => {
  const reply = await host().send({ operation: "skills" });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return (reply as { value: Skill[] }).value;
};

const skillDirs = readdirSync(join(appDir, "skills")).filter((name) =>
  statSync(join(appDir, "skills", name)).isDirectory(),
);

/** Example output the create-verification-skill skill copies into a project; its links are relative to itself there. */
const isExampleOutput = (skill: string, path: string) =>
  skill === "create-verification-skill" && path.startsWith("references/feature-map-example/");

const p3Names = (catalog: Skill[]) => new Set(catalog.map((skill) => skill.name));

describe("bundled skills", async () => {
  const catalog = await loadCatalog();
  const names = p3Names(catalog);

  it("load through the framework's packaged-skill loader, one per skills/ directory", () => {
    assert.deepEqual([...names].sort(), [...skillDirs].sort());
    assert.equal(catalog.length, 52);
    for (const required of ["p3-mode", "setup-p3", "p3-agent", "p3-help", "principle-prove-it-works"]) {
      assert.ok(names.has(required), `${required} is bundled`);
    }
  });

  it("carry valid frontmatter: names match directories, descriptions fit the format", () => {
    for (const skill of catalog) {
      assert.match(skill.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, skill.name);
      assert.ok(skill.name.length <= 64, `${skill.name} name length`);
      assert.ok(skill.description.trim().length > 0, `${skill.name} has a description`);
      assert.ok(skill.description.length <= 1024, `${skill.name} description length`);
      const document = skill.files.find((file) => file.path === "SKILL.md");
      assert.ok(document, `${skill.name} ships SKILL.md`);
      assert.match(document.content, new RegExp(`^---\\n(?:.*\\n)*?name: ${skill.name}\\n`), `${skill.name} frontmatter names itself`);
    }
  });

  it("resolve every linked or named resource inside the same skill", () => {
    const problems: string[] = [];
    for (const skill of catalog) {
      const paths = new Set(skill.files.map((file) => file.path));
      for (const file of skill.files) {
        if (isExampleOutput(skill.name, file.path)) continue;
        const targets = [
          ...[...file.content.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]!),
          ...[...file.content.matchAll(/`((?:references|playbooks|scripts)\/[^`\s]+\.(?:md|tsv|sh))`/g)].map((match) => match[1]!),
        ];
        for (const raw of targets) {
          if (/^(https?:|mailto:|#)/.test(raw)) continue;
          const target = raw.split("#")[0]!;
          if (target === "" || /[<*]/.test(target) || !/[./]/.test(target)) continue;
          const found = target.endsWith("/") ? [...paths].some((path) => path.startsWith(target)) : paths.has(target);
          if (!found) problems.push(`${skill.name}/${file.path} -> ${raw}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  it("name only skills that exist in this app", () => {
    const problems: string[] = [];
    for (const skill of catalog) {
      for (const file of skill.files) {
        if (isExampleOutput(skill.name, file.path)) continue;
        for (const match of file.content.matchAll(/\*\*([a-z0-9-]+)\*\* (principle )?skill/g)) {
          const name = match[2] === undefined ? match[1]! : `principle-${match[1]}`;
          if (!names.has(name)) problems.push(`${skill.name}/${file.path}: ${match[0]}`);
        }
        for (const match of file.content.matchAll(/\*\*(principle-[a-z0-9-]+)\*\*/g)) {
          if (!names.has(match[1]!)) problems.push(`${skill.name}/${file.path}: ${match[0]}`);
        }
        for (const name of principleNames(file.content)) {
          if (!names.has(name)) problems.push(`${skill.name}/${file.path}: ${name}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  it("name only model roles the app can resolve", () => {
    const problems: string[] = [];
    const resolutionTerms = new Set(["configured", "unset", "invalid", "inherit-parent"]);
    const rolePattern = /`([a-z][a-z ,-]+)` role\b|role (?:is |from )?`([a-z][a-z ,-]+)`/g;
    for (const skill of catalog) {
      for (const file of skill.files) {
        for (const match of file.content.matchAll(rolePattern)) {
          const role = match[1] ?? match[2]!;
          if (resolutionTerms.has(role)) continue;
          if (!Object.hasOwn(roleKinds, role)) problems.push(`${skill.name}/${file.path}: ${role}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  it("assume no local p3-stack installation", () => {
    const skillNames = [...names].join("|");
    const forbidden: [string, RegExp][] = [
      ["p3-models.md file", /p3-models\.md/],
      ["p3 installer", /\.\/install\.sh|`install\.sh`/],
      ["root agents/ brief", /agents\/(p3-agent|comment-sicko)\.md/],
      ["parent-relative path", /\]\(\.\.\/|`\.\.\//],
      ["filesystem path to a p3 skill", new RegExp(`(^|[\\s\`(:])(\\.?/)?skills/(${skillNames})/`)],
      ["home-directory p3 skill", new RegExp(`~/\\.agents/skills/(${skillNames})\\b`)],
      ["slash invocation of a p3 skill", new RegExp(`(^|[\\s(\`"'])/(${skillNames}|principle-[a-z-]+)\\b`)],
      ["upstream repository link", /github\.com\/uzairansaruzi/],
    ];
    const problems: string[] = [];
    for (const skill of catalog) {
      for (const file of skill.files) {
        file.content.split("\n").forEach((line, index) => {
          for (const [label, pattern] of forbidden) {
            if (pattern.test(line)) problems.push(`${skill.name}/${file.path}:${index + 1} ${label}: ${line.trim().slice(0, 120)}`);
          }
        });
      }
    }
    assert.deepEqual(problems, []);
  });

  it("route every p3-mode playbook entry to a bundled playbook", () => {
    const mode = catalog.find((skill) => skill.name === "p3-mode")!;
    const document = mode.files.find((file) => file.path === "SKILL.md")!.content;
    const listed = [...document.matchAll(/`(playbooks\/[a-z-]+\.md)`/g)].map((match) => match[1]!);
    const shipped = mode.files.filter((file) => file.path.startsWith("playbooks/")).map((file) => file.path);
    assert.deepEqual([...new Set(listed)].sort(), shipped.sort());
  });

  it("ship one native p3 wrapper skill that loads the bundled router under the default slug", async () => {
    const wrapperDir = join(appDir, "..", "wrapper");
    assert.deepEqual(readdirSync(wrapperDir), ["p3"]);
    assert.deepEqual(readdirSync(join(wrapperDir, "p3")), ["SKILL.md"]);
    const content = readFileSync(join(wrapperDir, "p3", "SKILL.md"), "utf8");
    const wrapper = await fileSkill([{ path: "SKILL.md", content }]);
    assert.equal(wrapper.name, "p3");
    assert.ok(!names.has(wrapper.name), "the wrapper's name collides with no bundled skill");
    const read = /\{app: "([a-z0-9-]+)", name: "([a-z0-9-]+)"\}/.exec(content);
    assert.ok(read, "wrapper names an Executor skills read");
    assert.equal(read[1], "p3");
    assert.equal(read[2], "p3-mode");
    assert.ok(names.has(read[2]!), `${read[2]} is bundled`);
    assert.match(content, /expectedProfileRevision/);
    assert.doesNotMatch(content, /\$ARGUMENTS/, "no legacy command interpolation");
    assert.ok(content.length < 2000, "the wrapper carries no workflow text");
  });

  it("reference only app tools the deployed app exposes", async () => {
    const reply = await host().send({ operation: "inspect" });
    const tools = new Set((reply as { value: { tools: { name: string }[] } }).value.tools.map((tool) => tool.name));
    const referenced = new Set<string>();
    for (const skill of catalog) {
      for (const file of skill.files) {
        for (const match of file.content.matchAll(/\bmodels\.([a-z]+)\b/g)) referenced.add(`models.${match[1]}`);
      }
    }
    assert.deepEqual([...referenced].sort(), ["models.read", "models.resolve", "models.write"]);
    for (const name of referenced) assert.ok(tools.has(name), `${name} exists`);
  });

  it("give the coordinating and scheduled paths the Executor read contract, and use only the two documented sentinels", () => {
    const text = (name: string) =>
      catalog.find((skill) => skill.name === name)!.files.map((file) => file.content).join("\n");
    const mode = text("p3-mode");
    for (const field of ["{app, name}", "{app, name, file}", "deployment", "revision", "expectedProfileRevision"]) {
      assert.ok(mode.includes(field), `p3-mode carries ${field}`);
    }
    assert.match(mode, /\{app: "<app slug>", name: "p3-mode"\}`, and follow its Coordinating child branch\./);
    const sentinels = new Set<string>();
    for (const skill of catalog) for (const file of skill.files) for (const m of file.content.matchAll(/\bP3_[A-Z_]+\b/g)) sentinels.add(m[0]);
    assert.deepEqual([...sentinels].sort(), ["P3_NEEDS", "P3_SKILLS_UNAVAILABLE"]);
    for (const sentinel of sentinels) {
      assert.ok(mode.includes(sentinel), `p3-mode handles ${sentinel}`);
      assert.ok(text("p3-help").includes(sentinel), `p3-help explains ${sentinel}`);
    }
  });

  const lines = (pattern: RegExp) =>
    catalog.flatMap((skill) =>
      skill.files.flatMap((file) =>
        file.content.split("\n").flatMap((line, index) => (pattern.test(line) ? [`${skill.name}/${file.path}:${index + 1}`] : [])),
      ),
    );

  it("wait for delegates on T3 completion wakes, never by draining or polling task_status", () => {
    assert.deepEqual(lines(/[Dd]rain(ed)? (?:it |them |results |the candidates |background work )?with `task_status`|`task_status` until|poll(?:ing)? (?:for|until) (?:every |each )?(?:worker|delegate|child|task)/), []);
    const mode = catalog.find((skill) => skill.name === "p3-mode")!.files.find((file) => file.path === "SKILL.md")!.content;
    assert.match(mode, /When none is left, end the turn: T3 wakes this thread when each async child finishes\./);
    assert.match(mode, /Never poll in a loop, sleep, or spawn a watcher to wait for a child\./);
    const waiting = lines(/collect(?:ed)? .*on T3's completion wakes?/i);
    assert.ok(waiting.length >= 15, `skills point at the wake protocol (${waiting.length})`);
  });

  it("read scheduled-tick playbooks from Executor with a cold-turn prompt, never from the application's trunk", () => {
    assert.deepEqual(lines(/\bre-?read\b[^.]*from trunk|git show origin\/main:skills/i), []);
    const mode = catalog.find((skill) => skill.name === "p3-mode")!.files.find((file) => file.path === "SKILL.md")!.content;
    const prompt = /## Scheduled ticks\n\n.*\n\n"(.+)"\n/.exec(mode)?.[1];
    assert.ok(prompt, "p3-mode defines the tick prompt");
    for (const part of ['{app: "<app slug>", name: "p3-mode"}', 'file: "<playbook path>"', "expectedProfileRevision", "repository <absolute path>", "delegated task ids in <path>"]) {
      assert.ok(prompt.includes(part), `tick prompt carries ${part}`);
    }
    for (const playbook of ["autopilot-full", "autopilot-stack", "orchestrate", "multi-phase-plan"]) {
      const text = catalog.find((skill) => skill.name === "p3-mode")!.files.find((file) => file.path === `playbooks/${playbook}.md`)!.content;
      assert.match(text, /schedule_task/, `${playbook} arms a tick`);
      assert.match(text, /p3-mode's Scheduled ticks prompt/, `${playbook} uses the cold-turn prompt`);
    }
  });

  it("never let autonomy or diversity override a configured or invalid role", () => {
    assert.deepEqual(
      lines(/different provider or model family|different model family|retry on a different model|one model per provider instance|Under a full-autonomy grant, run that role/),
      [],
    );
    const capabilityPicks = lines(/orchestrator_capabilities/).filter(
      (where) => !/^(p3-mode\/SKILL\.md|setup-p3\/SKILL\.md|how\/SKILL\.md|why\/SKILL\.md):/.test(where),
    );
    assert.deepEqual(capabilityPicks, [], "only the router, setup, and catalog-for-resolve lines read capabilities");
    const mode = catalog.find((skill) => skill.name === "p3-mode")!.files.find((file) => file.path === "SKILL.md")!.content;
    const step6 = /\n6\. (.+)\n/.exec(mode.slice(mode.indexOf("## Model configuration")))![1]!;
    assert.match(step6, /never omit `target` to run it on this conversation's model instead/);
    assert.match(step6, /is not a model choice\. Only the user's explicit approval of a named replacement lets that role run/);
    const trail = catalog.find((skill) => skill.name === "show-me-your-work")!.files.find((file) => file.path === "SKILL.md")!.content;
    assert.match(trail, /on the `judgment and prose` role, resolved through this app's `models\.resolve`/);
  });

  it("refresh the catalog for each task, dispatch wave, and rejected target", () => {
    const mode = catalog.find((skill) => skill.name === "p3-mode")!.files.find((file) => file.path === "SKILL.md")!.content;
    assert.match(mode, /1\. Call `orchestrator_capabilities` at the start of each task, before each dispatch wave .*, and again after `delegate_task` rejects a target\. Never reuse a catalog from an earlier task or wave\./);
    assert.doesNotMatch(mode, /once per conversation/i);
    const setup = catalog.find((skill) => skill.name === "setup-p3")!.files.find((file) => file.path === "SKILL.md")!.content;
    assert.match(setup, /Call `orchestrator_capabilities` again right before saving/);
  });
});
