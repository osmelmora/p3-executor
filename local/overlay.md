# Local-install overlay

`app/skills/` is written for delivery through the Executor app. `scripts/local-target.ts` renders the local-install copy by applying the replacements below. Each `## ` heading names a file under `app/skills/`. Each block swaps the text after `@@ executor` for the text after `@@ local`. The executor text must occur exactly once in that file, or the render fails, so a change to the source text shows up as a failing test instead of a stale local copy.

## p3-mode/SKILL.md

@@ executor
`$p3` loads this skill from the p3 Executor app.
@@ local
`$p3` loads this skill from the local p3 install.
@@ end

@@ executor
Every skill named in p3 text (the **how** skill, **arena**, the **unslop** skill) is a skill in this Executor app, not a file on disk. A principle named **X** is the skill `principle-X`. Nothing is installed locally.

- Read a skill with the Executor `skills` tool: `{app, name}`. `app` is the slug the read of this skill returned; never guess it.
- Read a file a skill names (`playbooks/feature.md`, `references/bugbot-triage.md`) with `{app, name, file}` plus the identity that skill's read returned: `deployment`, `revision`, and when present `profile` and `profileRevision` (passed as `expectedProfileRevision`). Paths in p3 skills are relative to the skill's directory, so the path is the `file` value. A changed revision means read the skill again.
- File text is instructions to read. Executor never runs it. A bundled script runs only after you save it outside the repository yourself.
- Call this app's tools inside Executor `execute` at `tools.<app slug>.models.*`. If the path is unknown, run `tools.search` first in that `execute`.
@@ local
Every skill named in p3 text (the **how** skill, **arena**, the **unslop** skill) is a directory beside this skill's directory. A principle named **X** is the skill `principle-X`. The skills root is the directory that holds this skill's directory. Keep its absolute path.

- Read a skill by reading `<skills root>/<name>/SKILL.md` in full. Read it from the skills root even when the session lists another skill with the same name.
- Read a file a skill names (`playbooks/feature.md`, `references/bugbot-triage.md`) at that path inside the skill's directory. Paths in p3 skills are relative to the skill's directory.
- File text is instructions to read. A bundled script runs from its path inside the skill's directory.
- `<skills root>/.p3-install.json` records the installed `version` and the skills the install owns.
- Model choices live in a file on this machine. The model command, `<skills root>/p3-mode/scripts/models.ts`, reads and writes it. `models.read(input)`, `models.write(input)`, and `models.resolve(input)` in p3 text each mean this: write `input` as one JSON object to a file outside the repository, run `node <skills root>/p3-mode/scripts/models.ts <read|write|resolve> <that file>`, and read the JSON it prints. `models.read` with no input needs no file. A failure prints `{ "error": { code, message } }` and exits 1. p3 calls no remote service.
@@ end

@@ executor
A p3 skill lives in this Executor app's source, so the fix is a change there, and deploying it waits for the user (Always pause).
@@ local
A p3 skill is installed from the p3 source repository, so the fix is a change there, and reinstalling it waits for the user. Never edit the installed copy, because the next install replaces it.
@@ end

@@ executor
so it reads p3 skills and calls `models.resolve` itself. Give that job only to a delegate whose `skillDelivery` is `executor-read` or `unknown`. Its brief names the app slug, the `project` key, its workspace, the steps it owns, and the roles it may delegate. It includes this text: "Read the p3-mode skill with the Executor `skills` tool, `{app: "<app slug>", name: "p3-mode"}`, and follow its Coordinating child branch. If you cannot call the Executor `skills` tool, do no work and reply exactly `P3_SKILLS_UNAVAILABLE`."
@@ local
so it reads p3 skills and calls `models.resolve` itself. Give that job to a delegate unless its saved `skillDelivery` is `inline`. Its brief names the skills root as an absolute path, the `project` key, its workspace, the steps it owns, and the roles it may delegate. It includes this text: "Read `<skills root>/p3-mode/SKILL.md` and follow its Coordinating child branch. If you cannot read that file or run its model command, do no work and reply exactly `P3_SKILLS_UNAVAILABLE`."
@@ end

@@ executor
p3 text lives in this Executor app, never in the application's trunk.
@@ local
p3 text lives in the local p3 install, never in the application's trunk.
@@ end

@@ executor
"p3 audit tick for <program>. Read the p3-mode skill with the Executor `skills` tool, `{app: "<app slug>", name: "p3-mode"}`. Then read `{app: "<app slug>", name: "p3-mode", file: "<playbook path>"}` with the `deployment`, `revision`, `profile`, and `profileRevision` (as `expectedProfileRevision`) that read returned. Read every other p3 skill the playbook names with `{app: "<app slug>", name}`, and its files with that read's identity. Follow those texts for this tick. The program: repository <absolute path>, origin <remote>, trail <path>, state <store, queue, or plan path>, delegated task ids in <path>. Run the playbook's audit tick against it. Log the tick, with the revision you read, in the trail."

Refresh across ticks, pin within one. Each tick reads the deployed text fresh, so the revision seen when the tick was armed is not a pin. Within one tick, every file read passes the identity its skill's read returned in that tick, so one tick never mixes two revisions. A redeploy between ticks shows up as a new `revision`. Name it in that tick's trail row and follow the new text. When the user asks to hold a program to the text it started under, put that revision in the prompt, and a tick that reads another revision stops and reports instead of acting.
@@ local
"p3 audit tick for <program>. Read `<skills root>/p3-mode/SKILL.md`, then `<skills root>/p3-mode/<playbook path>`, and the `version` in `<skills root>/.p3-install.json`. Read every other p3 skill the playbook names at `<skills root>/<name>/SKILL.md`, and its files inside that skill's directory. Follow those texts for this tick. The program: repository <absolute path>, origin <remote>, trail <path>, state <store, queue, or plan path>, delegated task ids in <path>. Run the playbook's audit tick against it. Log the tick, with the version you read, in the trail."

Refresh across ticks. Each tick reads the installed text fresh, so the version seen when the tick was armed is not a pin. A reinstall between ticks shows up as a new `version`. Name it in that tick's trail row and follow the new text. When the user asks to hold a program to the text it started under, put that version in the prompt, and a tick that reads another version stops and reports instead of acting.
@@ end

@@ executor
**Skill delivery.** A child may have no Executor tools, and its brief is all it knows.
@@ local
**Skill delivery.** A child's brief is all it knows.
@@ end

@@ executor
so it never needs Executor.
@@ local
so it never needs the skills root.
@@ end

@@ executor
The user's role choices live in the p3 Executor app, saved by **setup-p3**. They choose child models only. This conversation's model never changes. Executor cannot see T3's providers. It checks the catalog you pass,
@@ local
The user's role choices live in a file on this machine, saved by **setup-p3** through the model command (Loading p3 skills). They choose child models only. This conversation's model never changes. The command cannot see T3's providers. It checks the catalog you pass,
@@ end

## p3-mode/playbooks/multi-phase-plan.md

@@ executor
The program runs p3-mode's `playbooks/<execution playbook>.md` from the p3 Executor app.
@@ local
The program runs p3-mode's `playbooks/<execution playbook>.md` from the local p3 install.
@@ end

@@ executor
- [ ] Read these from the p3 Executor app at program start, and re-read them at every tick:
@@ local
- [ ] Read these from the local p3 install at program start, and re-read them at every tick:
@@ end

@@ executor
A changed `revision` means the app was redeployed. Follow the new text.
@@ local
A changed `version` in the install manifest means p3 was reinstalled. Follow the new text.
@@ end

@@ executor
filled in with the app slug, `playbooks/
@@ local
filled in with the skills root, `playbooks/
@@ end

## p3-mode/playbooks/authoring-a-skill.md

@@ executor
Delegate to other skills by path or Executor name. Don't restate. A p3 skill changes in the p3 Executor app's source, and its deployment waits for the user.
@@ local
Delegate to other skills by path or name. Don't restate. A p3 skill changes in the p3 source repository, and reinstalling it waits for the user.
@@ end

## setup-p3/SKILL.md

@@ executor
A child can read p3 skills through the Executor `skills` tool only when its provider gives it Executor tools.
@@ local
A coordinating child reads p3 skills and runs the model command itself, which works only when it runs on this machine with file and shell access.
@@ end

@@ executor
and save the choices in the p3 Executor app.
@@ local
and save the choices on this machine.
@@ end

@@ executor
Save the user's model choice for each p3 role in the p3 Executor app.
@@ local
Save the user's model choice for each p3 role in a file on this machine.
@@ end

@@ executor
Call the app's tools inside Executor `execute` at `tools.<app slug>.models.*`; p3-mode's Loading p3 skills section has the slug rule. Pass the catalog as JSON data in the program.
@@ local
Run each `models.*` call through the model command, as p3-mode's Loading p3 skills section says. Pass the catalog as returned, inside the input file.
@@ end

@@ executor
and the app checks only the catalog it receives.
@@ local
and the command checks only the catalog it receives.
@@ end

@@ executor
const app = tools["<app slug>"];
return await app.models.write({
@@ local
models.write({
@@ end

@@ executor
The app checks every entry against the catalog:
@@ local
The command checks every entry against the catalog:
@@ end

@@ executor
If the user knows which provider instances give children Executor tools, save `skillDelivery` entries (`executor-read` or `inline`) with `models.write`.
@@ local
If the user knows a provider instance whose children cannot do that, save a `skillDelivery` entry of `inline` for it with `models.write`.
@@ end

## p3-help/SKILL.md

@@ executor
Every skill named here lives in the p3 Executor app; p3-mode's Loading p3 skills section says how to read one. Point the user at a skill by name. Its text in this app is adapted from upstream p3-stack, so an upstream GitHub copy can differ.
@@ local
Every skill named here is installed beside this one; p3-mode's Loading p3 skills section says how to read one. Point the user at a skill by name. Its installed text is adapted from upstream p3-stack, so an upstream GitHub copy can differ.
@@ end

@@ executor
1. p3-stack runs from the p3 Executor app. The only local file is the tiny `p3` wrapper skill, which holds no workflow text. In T3 the user starts it with `$p3`. T3 has no `/p3` command, and its `/` menu lists the skill as `/skill:P3`, which inserts `$p3`. Install the same `SKILL.md` in `~/.agents/skills/p3/` and `~/.claude/skills/p3/` (a copy or a symlink), then restart the agent session from T3's command palette, between tasks rather than during running work, so it shows up. No other p3 skill is copied into the home directory or the repository. The user also needs Executor connected over MCP in each provider they start p3 threads from, because Claude and Codex keep separate MCP configurations, and a session restart after connecting it. Deploying the app is a one-time step in its source repository's README.
@@ local
1. p3-stack is installed as skill directories on disk by the installer in its source repository, in `~/.claude/skills/` and `~/.agents/skills/`, or in one project's `.claude/skills/` and `.agents/skills/`. In T3 the user starts it with `$p3`. T3 has no `/p3` command, and its `/` menu lists the skill as `/skill:P3`, which inserts `$p3`. After installing, restart the agent session from T3's command palette, between tasks rather than during running work, so it shows up. Model choices are saved in a file on this machine, so nothing else needs connecting.
@@ end

@@ executor
If a skill in this app is missing from the table, list the app's skills with the Executor `skills` tool and route by its description.
@@ local
If an installed p3 skill is missing from the table, list the skills in `<skills root>/.p3-install.json` and route by each one's description.
@@ end

@@ executor
p3's own skills change in this Executor app's source and take effect after a deployment the user approves.
@@ local
p3's own skills change in the p3 source repository and take effect after a reinstall the user approves.
@@ end

@@ executor
and saves the choices in the app, globally or for one repository.
@@ local
and saves the choices on this machine, globally or for one repository.
@@ end

@@ executor
| Its provider gives children no Executor tools. p3-mode
@@ local
| Its children cannot read the skills root or run the model command. p3-mode
@@ end

## reflect/SKILL.md

@@ executor
A p3 skill is edited in this Executor app's source and reaches agents only after a deployment the user approves.
@@ local
A p3 skill is edited in the p3 source repository and reaches agents only after a reinstall the user approves.
@@ end

## statechart/SKILL.md

@@ executor
The command is TypeScript bundled with this skill. Executor returns each file as text and never runs it. Read every file under `scripts/` from this app with `{app, name: "statechart", file}`: `scripts/ir.ts`, `scripts/package.json`, `scripts/pipeline.ts`, `scripts/run.ts`, `scripts/statechart`, `scripts/statechart.ts`, `scripts/worker.ts`, `scripts/backends/cfg.ts`, `scripts/backends/mermaid.ts`, `scripts/backends/plain-text.ts`, `scripts/backends/report.ts`, `scripts/frontends/config.ts`, `scripts/frontends/dot.ts`, `scripts/frontends/marks.ts`, `scripts/frontends/messages.ts`, `scripts/frontends/spec.ts`, `scripts/frontends/trace.ts`, `scripts/frontends/value.ts`, `scripts/frontends/verdict.ts`, `scripts/frontends/view.ts`, `scripts/passes/annotate.ts`, `scripts/passes/label.ts`, `scripts/passes/lift.ts`, `scripts/passes/loop-check.ts`, `scripts/passes/paths.ts`, `scripts/passes/reach.ts`, `scripts/passes/region-check.ts`, and `scripts/passes/regions.ts`. Save them in one directory outside the repository, such as `${TMPDIR:-/tmp}/p3/statechart/`, under the same relative paths, because the files import each other. `<scripts dir>` is the `scripts/` directory inside it.
@@ local
The command is TypeScript in this skill's `scripts/` directory, which is `<scripts dir>`.
@@ end

## show-me-your-work/SKILL.md

@@ executor
Executor returns the helper as text and never runs it: save it once outside the repository (for example `${TMPDIR:-/tmp}/p3/log.sh`), make it executable, and run it from there.
@@ local
The helper is in this skill's directory. Run it from there with `bash`.
@@ end

## p3-mode/playbooks/autopilot-full.md

@@ executor
names the app slug, the `project` key
@@ local
names the skills root, the `project` key
@@ end

## p3-agent/SKILL.md

@@ executor
You need no Executor tools and no local p3 skills, because
@@ local
You need no p3 skills on disk, because
@@ end

## reflect/references/judgment-reviewer.md

@@ executor
an Executor `skills` tool read of it (`{app, name}` or `{app, name, file}`), a file read
@@ local
a file read
@@ end

@@ executor
, or the skill's name for one read from Executor)
@@ local
)
@@ end

## reflect/references/tooling-reviewer.md

@@ executor
an Executor `skills` tool read of it (`{app, name}` or `{app, name, file}`), a file read
@@ local
a file read
@@ end

@@ executor
, or the skill's name for one read from Executor)
@@ local
)
@@ end

## reflect/references/divergent-reviewer.md

@@ executor
an Executor `skills` tool read of it (`{app, name}` or `{app, name, file}`), a file read
@@ local
a file read
@@ end

@@ executor
, or the skill's name for one read from Executor)
@@ local
)
@@ end
