import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditBrief, type Brief, fileText, loadSkills, parentOwned, principleNames, templateBody, walkthroughBriefs } from "../scripts/child-briefs.ts";

const partNames = (brief: Brief) => brief.parts.map((part) => (part.file === "SKILL.md" ? part.skill : `${part.skill}/${part.file}`));

describe("briefs for a child with no Executor tools", async () => {
  const skills = await loadSkills();
  const briefs = walkthroughBriefs(skills);
  const brief = (id: string) => briefs.find((entry) => entry.id === id)!;

  it("keep every workflow skill with the parent", () => {
    assert.deepEqual([...parentOwned(skills)].sort(), [
      "architect",
      "arena",
      "automate-me",
      "blast-radius",
      "create-verification-skill",
      "figure-it-out",
      "how",
      "interrogate",
      "maintain-verification-skill",
      "make-bot-ui",
      "no-comments",
      "p3-help",
      "p3-mode",
      "recall",
      "reflect",
      "setup-p3",
      "show-me-your-work",
      "swarm",
      "teach",
      "why",
    ]);
  });

  it("are closed: every skill or file they name is pasted or kept by the parent, and no sentence asks for a read the child cannot do", () => {
    for (const entry of briefs) {
      const audit = auditBrief(entry, skills);
      assert.deepEqual(audit.missing, [], `${entry.id} names something it neither pastes nor leaves to the parent`);
      assert.deepEqual(audit.unavailableReads, [], `${entry.id} asks the child to read something it lacks`);
    }
  });

  it("give a code worker the leaf contract and the transitive text of the skills it uses, without p3-mode", () => {
    const worker = brief("code-worker");
    assert.deepEqual(partNames(worker), [
      "p3-agent",
      "principle-fix-root-causes",
      "principle-test-behavior-not-implementation",
      "principle-prove-it-works",
      "principle-model-the-domain",
      "typescript-best-practices",
      "tdd",
      "principle-type-system-discipline",
      "principle-boundary-discipline",
      "typescript-best-practices/references/patterns.md",
      "principle-encode-lessons-in-structure",
    ]);
    assert.deepEqual(auditBrief(worker, skills).keptByParent, [
      "architect",
      "arena",
      "how",
      "interrogate",
      "no-comments",
      "p3-mode",
      "reflect",
      "setup-p3",
      "show-me-your-work",
      "swarm",
      "why",
    ]);
  });

  it("give an architect runner its template, the rationale template, and every principle it names, transitively", () => {
    const runner = brief("architect-runner");
    assert.deepEqual(partNames(runner), [
      "architect/references/runner-prompt.md",
      "architect/references/rationale-template.md",
      "principle-separate-before-serializing-shared-state",
      "principle-encode-lessons-in-structure",
      "principle-boundary-discipline",
      "principle-make-operations-idempotent",
      "principle-laziness-protocol",
      "principle-minimize-reader-load",
      "principle-guard-the-context-window",
    ]);
    for (const named of principleNames(runner.parts[0]!.text)) assert.ok(partNames(runner).includes(named), `${named} is pasted`);
    assert.deepEqual(auditBrief(runner, skills).keptByParent, ["architect", "arena"]);
    assert.match(runner.parts[0]!.text, /You are one runner, a leaf\./);
    assert.match(runner.parts[0]!.text, /Do not run architect, arena, how, or any other workflow skill, and do not delegate\./);
  });

  it("attach only files the template header or its dispatching skill tells the parent to attach", () => {
    const dispatcher: Record<string, string> = { how: "how", why: "why", interrogate: "interrogate", reflect: "reflect", architect: "architect", "no-comments": "no-comments" };
    for (const entry of briefs.filter((candidate) => candidate.kind === "template")) {
      const [template, ...attachments] = entry.parts;
      const header = fileText(skills, template!.skill, template!.file).replace(templateBody(fileText(skills, template!.skill, template!.file)), "");
      const instructions = header + fileText(skills, dispatcher[template!.skill]!, "SKILL.md");
      for (const part of attachments.filter((candidate) => candidate.file !== "SKILL.md")) {
        assert.ok(instructions.includes(part.file) || instructions.includes(part.file.replace(/sources\/[a-z-]+\.md$/, "sources/<source>.md")), `${entry.id}: ${part.file} is named where the parent builds the brief`);
      }
    }
  });

  it("catch the round-2 gap: a principle named inside a list, or one that is not bundled, that the brief does not paste", () => {
    assert.deepEqual(principleNames("per the **a** and **b** principle skills, and the **c**, **d**, and **e** principle skills"), [
      "principle-a",
      "principle-b",
      "principle-c",
      "principle-d",
      "principle-e",
    ]);
    const runner = brief("architect-runner");
    const withoutLaziness: Brief = { ...runner, parts: runner.parts.filter((part) => part.skill !== "principle-laziness-protocol") };
    assert.deepEqual(auditBrief(withoutLaziness, skills).missing, ["principle-laziness-protocol"]);
    const misnamed: Brief = { ...runner, parentWritten: `${runner.parentWritten}\n\nKeep it small, per the **minimize-reader-load** and **lazyness-protocol** principle skills.` };
    assert.deepEqual(auditBrief(misnamed, skills).missing, ["principle-lazyness-protocol"]);
  });

  it("catch the round-1 failure: a worker told to read a skill its brief does not carry", () => {
    const worker = brief("code-worker");
    const regressed: Brief = {
      ...worker,
      parts: [{ ...worker.parts[0]!, text: "Read the **p3-mode** skill in full before doing any work." }, ...worker.parts.slice(1)],
    };
    assert.deepEqual(auditBrief(regressed, skills).unavailableReads, ["Read the **p3-mode** skill in full before doing any work."]);
  });
});

describe("the leaf contract", async () => {
  const skills = await loadSkills();
  const agent = fileText(skills, "p3-agent");
  const mode = fileText(skills, "p3-mode");

  it("makes the worker a leaf that asks the parent instead of delegating or fetching", () => {
    assert.match(agent, /You are a leaf\./);
    assert.match(agent, /Never call `delegate_task`, `schedule_task`, or `t3_thread_launch`, and never pick a model/);
    assert.match(agent, /Run only the skills whose text your brief pastes\./);
    assert.match(agent, /`P3_NEEDS`/);
    assert.doesNotMatch(agent, /Read the \*\*p3-mode\*\* skill/);
    assert.doesNotMatch(agent, /omit `target`/);
  });

  it("carries p3-mode's Comments rule verbatim", () => {
    const comments = /## Comments\n\n(.+)\n/.exec(mode)![1]!;
    assert.ok(agent.includes(`**Comments.** ${comments}`), "p3-agent copies the Comments section");
  });

  it("is what p3-mode's Skill delivery tells the parent to open every leaf brief with, under every delivery mode", () => {
    assert.match(mode, /\*\*Leaf briefs\.\*\* Open with the text of the \*\*p3-agent\*\* skill\./);
    assert.match(mode, /A leaf brief always carries text, whatever the child's provider, so it never needs Executor\./);
    assert.doesNotMatch(mode, /this file's Non-negotiables, Principles, Autonomy, Writing the reply, and Comments sections/);
  });
});
