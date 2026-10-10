/**
 * Child-brief walkthroughs for a child with no Executor tools. Each brief is assembled from the skills the
 * framework serves, the way p3-mode's Skill delivery says, then audited: every skill and file its text names
 * must be pasted into it or kept by the parent, and no sentence may tell the child to read something it lacks.
 *
 *   node --import tsx scripts/child-briefs.ts                # summary table
 *   node --import tsx scripts/child-briefs.ts --write <dir>  # also each brief's exact text and audit
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { host } from "../test/harness.ts";

export type Skill = { name: string; files: { path: string; content: string }[] };
export type Skills = ReadonlyMap<string, Skill>;

export const loadSkills = async (): Promise<Skills> => {
  const reply = await host().send({ operation: "skills" });
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return new Map((reply.value as Skill[]).map((skill) => [skill.name, skill]));
};

export const fileText = (skills: Skills, skill: string, file = "SKILL.md"): string => {
  const found = skills.get(skill)?.files.find((entry) => entry.path === file);
  if (found === undefined) throw new Error(`${skill}/${file} is not bundled`);
  return found.content;
};

const withoutFrontmatter = (text: string): string => text.replace(/^---\n[\s\S]*?\n---\n/, "");

/** A template's brief text: what follows its first `---` line. A file without one is all brief. */
export const templateBody = (text: string): string => {
  const at = text.indexOf("\n---\n");
  return at === -1 ? text : text.slice(at + 5);
};

/** Skills the parent keeps: the router, setup, help, and every non-principle skill whose steps delegate or schedule. */
export const parentOwned = (skills: Skills): Set<string> =>
  new Set(
    [...skills.values()]
      .filter(
        (skill) =>
          ["p3-mode", "setup-p3", "p3-help"].includes(skill.name) ||
          (!skill.name.startsWith("principle-") &&
            skill.name !== "p3-agent" &&
            skill.files.some((file) => /\b(delegate_task|schedule_task|t3_thread_launch)\b/.test(file.content))),
      )
      .map((skill) => skill.name),
  );

export type Ref = { readonly kind: "skill"; readonly name: string } | { readonly kind: "file"; readonly skill: string; readonly path: string };
const refId = (ref: Ref): string => (ref.kind === "skill" ? ref.name : `${ref.skill}/${ref.path}`);

/**
 * Principle skills a text names as `**a** principle skill`, or as a list such as `**a** and **b** principle
 * skills`, in text order. Every name in the list counts, not only the one next to "principle skills".
 */
export const principleNames = (text: string): string[] =>
  [...text.matchAll(/((?:\*\*[a-z0-9-]+\*\*(?:,? and |,? or |, ))*\*\*[a-z0-9-]+\*\*) principle skills?\b/g)].flatMap((phrase) =>
    [...phrase[1]!.matchAll(/\*\*([a-z0-9-]+)\*\*/g)].map((name) => `principle-${name[1]}`),
  );

/**
 * Skills and files a text names, in the forms p3 text uses. `owner` resolves skill-relative paths. A named
 * principle is a reference even when it is not bundled, so the audit reports it missing instead of dropping it.
 */
export const references = (text: string, owner: string, skills: Skills): Ref[] => {
  const found = new Map<string, Ref>();
  const skill = (name: string) => {
    if (skills.has(name)) found.set(name, { kind: "skill", name });
  };
  for (const name of principleNames(text)) found.set(name, { kind: "skill", name });
  for (const m of text.matchAll(/\*\*([a-z0-9-]+)\*\*/g)) skill(m[1]!);
  for (const m of text.matchAll(/\bprinciple-[a-z0-9-]+[a-z0-9]/g)) skill(m[0]);
  for (const m of text.matchAll(/`([a-z0-9-]+)`/g)) skill(m[1]!);
  for (const m of text.matchAll(/`((?:references|playbooks|scripts)\/[^`\s]+)`|\]\(((?:references|playbooks|scripts)\/[^)\s#]+)/g)) {
    const path = (m[1] ?? m[2])!;
    if (!/[<*{]/.test(path)) found.set(`${owner}/${path}`, { kind: "file", skill: owner, path });
  }
  return [...found.values()];
};

/** Sentences that tell the reader to read, run, or load a skill or file, or to use Executor. */
const instructions = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) =>
      /^(?:First,? )?(?:Read|Run|Follow|Load|Open)\b|\b(?:you|I) (?:must |should )?(?:read|run|follow|load)\b/i.test(sentence.trim()),
    );

export interface Part {
  readonly label: string;
  readonly skill: string;
  readonly file: string;
  readonly text: string;
  /** Material the child judges, such as a skill reflect proposes to edit. Never instructions it follows. */
  readonly data?: true;
}

export interface Brief {
  readonly id: string;
  readonly role: string;
  readonly kind: "leaf" | "template";
  readonly parentWritten: string;
  readonly parts: readonly Part[];
  readonly parentKeeps: readonly string[];
}

export interface Audit {
  readonly id: string;
  readonly bytes: number;
  readonly pasted: readonly string[];
  readonly keptByParent: readonly string[];
  readonly missing: readonly string[];
  readonly unavailableReads: readonly string[];
}

const partId = (part: Part) => (part.file === "SKILL.md" ? part.skill : `${part.skill}/${part.file}`);

export const auditBrief = (brief: Brief, skills: Skills): Audit => {
  const owned = parentOwned(skills);
  const pasted = new Set(brief.parts.map(partId));
  const keptByParent = new Set<string>();
  const missing = new Set<string>();
  const unavailableReads: string[] = [];
  const texts = [
    { owner: "", text: brief.parentWritten },
    ...brief.parts.filter((part) => part.data !== true).map((part) => ({ owner: part.skill, text: part.text })),
  ];
  for (const { owner, text } of texts) {
    for (const ref of references(text, owner, skills)) {
      const id = refId(ref);
      if (pasted.has(id)) continue;
      if (ref.kind === "skill" && owned.has(ref.name)) keptByParent.add(id);
      else if (ref.kind === "file" && owned.has(ref.skill) && !pasted.has(ref.skill) && owner !== ref.skill) keptByParent.add(id);
      else missing.add(id);
    }
    for (const sentence of instructions(text)) {
      const lacking = references(sentence, owner, skills).filter((ref) => !pasted.has(refId(ref)));
      const usesExecutor = /\b(?:read|call|use|load)\b[^.]*\bExecutor\b/i.test(sentence) && !/\bno Executor\b/i.test(sentence);
      if (lacking.length > 0 || usesExecutor) unavailableReads.push(sentence.trim());
    }
  }
  return {
    id: brief.id,
    bytes: Buffer.byteLength(brief.parentWritten + brief.parts.map((part) => part.text).join("\n\n")),
    pasted: [...pasted],
    keptByParent: [...keptByParent].sort(),
    missing: [...missing].sort(),
    unavailableReads,
  };
};

/** p3-mode's leaf recipe: the seeds, then every skill and file the pasted text names, transitively, except what the parent keeps. */
export const leafParts = (skills: Skills, seeds: readonly { skill: string; file?: string }[]): Part[] => {
  const owned = parentOwned(skills);
  const parts: Part[] = [];
  const queue = seeds.map((seed) => ({ skill: seed.skill, file: seed.file ?? "SKILL.md", label: "seed" }));
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (parts.some((part) => part.skill === next.skill && part.file === next.file)) continue;
    const raw = fileText(skills, next.skill, next.file);
    const text = next.file === "SKILL.md" ? withoutFrontmatter(raw) : raw;
    parts.push({ label: next.label, skill: next.skill, file: next.file, text });
    for (const ref of references(text, next.skill, skills)) {
      if (ref.kind === "skill" && !owned.has(ref.name)) queue.push({ skill: ref.name, file: "SKILL.md", label: `named by ${partId(parts.at(-1)!)}` });
      if (ref.kind === "file" && !owned.has(ref.skill)) queue.push({ skill: ref.skill, file: ref.path, label: `named by ${partId(parts.at(-1)!)}` });
    }
  }
  return parts;
};

const attach = (skills: Skills, skill: string, file: string, label: string): Part => ({
  label,
  skill,
  file,
  text: file === "SKILL.md" ? withoutFrontmatter(fileText(skills, skill, file)) : fileText(skills, skill, file),
});

const template = (skills: Skills, skill: string, file: string): Part => ({
  label: "template brief text",
  skill,
  file,
  text: templateBody(fileText(skills, skill, file)),
});

/** The briefs a parent sends: one realistic code worker, and every template path in the bundle. */
export const walkthroughBriefs = (skills: Skills): Brief[] => {
  const owned = parentOwned(skills);
  const runner = template(skills, "architect", "references/runner-prompt.md");
  const runnerPrinciples = leafParts(
    skills,
    references(runner.text, "architect", skills)
      .filter((ref): ref is Extract<Ref, { kind: "skill" }> => ref.kind === "skill" && ref.name.startsWith("principle-"))
      .map((ref) => ({ skill: ref.name })),
  ).map((part) => ({ ...part, label: part.label === "seed" ? "principle the runner prompt names" : part.label }));
  const reflectTarget: Part = { ...attach(skills, "swarm", "SKILL.md", "target skill text a reviewer routed to, as data"), data: true };
  const briefs: Brief[] = [
    {
      id: "code-worker",
      role: "bug-fix code worker on claudeAgent/claude-opus-5-5, no Executor tools",
      kind: "leaf",
      parentWritten: [
        "Role. You are the `bug-fix` code worker. Your task: make `parseDuration(\"1h30m\")` in `src/time/duration.ts` return 5400 seconds; it returns 90 because unit suffixes after the first are ignored. The parent reproduced it and traced the root cause to the tokenizer loop.",
        "Workspace. Repository /Users/me/src/app. Run `git worktree add -b fix/parse-duration /Users/me/src/app-wt/parse-duration origin/main` and write only under that path.",
        "Done check. `npm test -- duration` passes, including a new test for `1h30m` and `2m5s`.",
        "Report. The fields the p3-agent contract lists, plus the failing-then-passing test output.",
        "The parent keeps. Reviewing your diff, the unslop pass and comment pass before commit, verifying on the CLI surface, and opening the PR.",
      ].join("\n\n"),
      parts: leafParts(skills, [
        { skill: "p3-agent" },
        { skill: "principle-fix-root-causes" },
        { skill: "principle-test-behavior-not-implementation" },
        { skill: "principle-prove-it-works" },
        { skill: "principle-model-the-domain" },
        { skill: "typescript-best-practices" },
        { skill: "tdd" },
      ]),
      parentKeeps: ["diff review", "unslop", "no-comments", "surface verification", "opening a PR"],
    },
    {
      id: "architect-runner",
      role: "architect runners panel seat on claudeAgent/claude-opus-5-5, no Executor tools",
      kind: "template",
      parentWritten: [
        "Task. Sketch the module that schedules retries for outbound webhooks: per-endpoint backoff, a dead-letter state, and idempotent redelivery.",
        "Grounding. The how explanation of `src/webhooks/` from Phase A, pasted below the line.",
        "Working directory. /tmp/arena-webhook-retries/candidate-2/. Write the sketch to `sketch.ts` and the rationale to `rationale.md` there.",
      ].join("\n\n"),
      parts: [runner, attach(skills, "architect", "references/rationale-template.md", "runner prompt header"), ...runnerPrinciples],
      parentKeeps: ["grounding (how, why)", "other runners", "red-flag screening", "arena synthesis", "implementation"],
    },
    {
      id: "how-explorer",
      role: "how explorer",
      kind: "template",
      parentWritten: "Question and exploration angle filled into the template's placeholders.",
      parts: [template(skills, "how", "references/explorer-prompt.md")],
      parentKeeps: ["angles", "explainer"],
    },
    {
      id: "how-explainer",
      role: "how explainer",
      kind: "template",
      parentWritten: "Question and every explorer's findings filled into the template's placeholders.",
      parts: [template(skills, "how", "references/explainer-prompt.md")],
      parentKeeps: ["presentation"],
    },
    {
      id: "why-investigator",
      role: "why investigators (source control)",
      kind: "template",
      parentWritten: "Question and code anchor filled into the template's placeholders.",
      parts: [
        template(skills, "why", "references/investigator-prompt.md"),
        attach(skills, "why", "references/sources/code-archaeology.md", "category playbook the header names"),
        attach(skills, "why", "references/sources/incident-postmortem.md", "defensive-code playbook the header names"),
      ],
      parentKeeps: ["coverage map", "synthesizer"],
    },
    {
      id: "why-synthesizer",
      role: "why synthesizer",
      kind: "template",
      parentWritten: "Question, code anchor, findings, and skipped sources filled into the template's placeholders.",
      parts: [template(skills, "why", "references/synthesizer-prompt.md"), attach(skills, "why", "references/epistemics.md", "framework the header names")],
      parentKeeps: ["presentation"],
    },
    {
      id: "interrogate-reviewer",
      role: "interrogate reviewers panel seat",
      kind: "template",
      parentWritten: "Intent and diff filled into the template's placeholders.",
      parts: [
        template(skills, "interrogate", "references/reviewer-prompt.md"),
        attach(skills, "interrogate", "references/rubric.md", "rubric the header names"),
        attach(skills, "interrogate", "references/code-quality-review.md", "lens the header names"),
      ],
      parentKeeps: ["synthesis", "lead judgment"],
    },
    ...(["judgment-reviewer", "tooling-reviewer", "divergent-reviewer"] as const).map(
      (name): Brief => ({
        id: `reflect-${name}`,
        role: name.startsWith("tooling") ? "reflect tooling" : "reflect judgment, divergent, synthesizer",
        kind: "template",
        parentWritten: "Thread id substituted where marked.",
        parts: [template(skills, "reflect", `references/${name}.md`)],
        parentKeeps: ["synthesis", "applying edits"],
      }),
    ),
    {
      id: "reflect-synthesizer",
      role: "reflect judgment, divergent, synthesizer",
      kind: "template",
      parentWritten: "Each reviewer's output inlined where marked.",
      parts: [template(skills, "reflect", "references/synthesizer.md"), reflectTarget],
      parentKeeps: ["structural check", "user approval", "applying edits"],
    },
    {
      id: "comment-sicko",
      role: "judgment and prose (no-comments)",
      kind: "template",
      parentWritten: "Scope: the diff of fix/parse-duration against main.",
      parts: [template(skills, "no-comments", "references/comment-sicko.md")],
      parentKeeps: ["deletions", "how/why on P3_NEEDS symbols", "fixes"],
    },
  ];
  for (const brief of briefs) {
    const leaked = brief.parts.filter((part) => part.data !== true && owned.has(part.skill) && part.file === "SKILL.md");
    if (leaked.length > 0) throw new Error(`${brief.id} pastes a parent-owned skill: ${leaked.map(partId).join(", ")}`);
  }
  return briefs;
};

const render = (brief: Brief, audit: Audit): string =>
  [
    `# ${brief.id}`,
    "",
    `Recipient: ${brief.role}. Kind: ${brief.kind} brief. ${audit.bytes} bytes.`,
    "",
    "## Parts, in order",
    "",
    "| Part | Why it is in the brief | Bytes |",
    "|---|---|---|",
    "| parent-written task section | role, task, workspace, done check, report, steps the parent keeps | " + Buffer.byteLength(brief.parentWritten) + " |",
    ...brief.parts.map((part) => `| ${partId(part)} | ${part.label} | ${Buffer.byteLength(part.text)} |`),
    "",
    `Kept by the parent (named in the text, not pasted, never fetched by the child): ${audit.keptByParent.join(", ") || "none"}.`,
    `Parent-retained steps: ${brief.parentKeeps.join(", ")}.`,
    `Missing: ${audit.missing.join(", ") || "none"}. Reads the child cannot do: ${audit.unavailableReads.length === 0 ? "none" : audit.unavailableReads.join(" | ")}.`,
    "",
    "## Exact brief text",
    "",
    "````markdown",
    [brief.parentWritten, ...brief.parts.map((part) => part.text.trim())].join("\n\n---\n\n"),
    "````",
    "",
  ].join("\n");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const skills = await loadSkills();
  const out = process.argv.indexOf("--write") === -1 ? undefined : process.argv[process.argv.indexOf("--write") + 1];
  if (out !== undefined) mkdirSync(out, { recursive: true });
  const rows = walkthroughBriefs(skills).map((brief) => {
    const audit = auditBrief(brief, skills);
    if (out !== undefined) writeFileSync(join(out, `${brief.id}.md`), render(brief, audit));
    return {
      brief: brief.id,
      bytes: audit.bytes,
      parts: brief.parts.length,
      keptByParent: audit.keptByParent.join(" "),
      missing: audit.missing.length,
      unavailableReads: audit.unavailableReads.length,
    };
  });
  console.table(rows);
  if (rows.some((row) => row.missing > 0 || row.unavailableReads > 0)) process.exitCode = 1;
}
