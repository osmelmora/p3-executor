---
name: p3-help
description: Guides users through p3-stack setup, $p3, and picking the skill, playbook, or principle for a task. Use when the user asks how to set up or use p3-stack, or which p3-stack skill fits. Not for requests to do work, even ones that name p3-stack.
---

# P3 help

Answer the user's question about p3-stack, hand them a prompt they can send, and name the skill the answer came from. For a help question, don't start the work. The user asked how, and a p3-stack run spends real tokens, so let them send the prompt.

A message that asks for work, such as "use p3-stack to fix this bug", is not a help question. Read the **p3-mode** skill, do the work under it, and mention once that starting a task with `$p3` keeps the work in this style.

This file maps questions to the skills and playbooks that hold the answers. Those skills own the details. Read the skill you route to before you quote it, and trust it when it disagrees with this map. Every skill named here lives in the p3 Executor app; p3-mode's Loading p3 skills section says how to read one. Point the user at a skill by name. Its text in this app is adapted from upstream p3-stack, so an upstream GitHub copy can differ.

## Find out what they need

Infer the need from the message and the conversation. A named situation, such as "which skill reviews a PR?", goes straight to its section. If the need is still unclear, ask one multiple-choice question with these options, then answer only the section they pick: get set up, start a task with `$p3`, pick a skill for a situation, fix a run that went wrong, or make p3-stack my own.

Check the state that changes the answer, and mention it only when it does. `models.read` returning `configured: false` means setup hasn't run, so the next `$p3` task starts with it. No `verify-*` skill or other app harness in the project means agents have no scripted way to drive the app; mention the **create-verification-skill** skill when the question is about proving a change works.

## Get set up

1. p3-stack runs from the p3 Executor app. The only local file is the tiny `p3` wrapper skill, which holds no workflow text. In T3 the user starts it with `$p3`. T3 has no `/p3` command, and its `/` menu lists the skill as `/skill:P3`, which inserts `$p3`. Install the same `SKILL.md` in `~/.agents/skills/p3/` and `~/.claude/skills/p3/` (a copy or a symlink), then restart the agent session from T3's command palette, between tasks rather than during running work, so it shows up. No other p3 skill is copied into the home directory or the repository. The user also needs Executor connected over MCP in each provider they start p3 threads from, because Claude and Codex keep separate MCP configurations, and a session restart after connecting it. Deploying the app is a one-time step in its source repository's README.
2. Choose models with the **setup-p3** skill ("$p3 configure models"). It asks for a reasoning preset, maps a provider and model to each role, and saves the choices in the app, globally or for one repository. The first `$p3` task runs it when nothing is saved. Choices apply from the next resolution, in this conversation and new ones.
3. Start a real task with `$p3`, a goal, and a check that can pass or fail.

Offer to word their first prompt with them.

If cost is the worry, say where the tokens go and how to spend fewer. p3-stack spends extra tokens on subagents and review panels. Rerun **setup-p3** and pick a lower reasoning preset or cheaper models. A role set to `inherit-parent` runs on this conversation's model and options, which saves tokens when that model is cheaper. A shorter panel list runs fewer subagents, one for each entry. Save `$p3` for work that needs rigor.

## Start a task with `$p3`

`$p3` loads p3-mode, which matches the task to a playbook, copies the playbook's steps into the todo list, and runs the other skills as the steps need them. A step it skips stays in the list as `skip: <reason>`. A good prompt states the goal and how to tell it's done. It doesn't list skills, because a hand-written sequence tends to drop or reorder steps the playbook would keep.

There are no mode toggles, so start each new task with `$p3`. Mid-chat, "new task" makes the mode match a fresh playbook. p3-mode already opens the briefs its playbook steps spawn with the **p3-agent** skill. To get the same style from a delegate of your own, open its brief with that skill, delivered as p3-mode's Skill delivery rules say.

## Pick a skill

The default answer is `$p3`, which runs most of the others when its steps need them. Name a skill directly when the user wants more or less of something than the playbook gives; the user asks for it by name, as in "$p3 run interrogate on this diff". Read the skill before you recommend it, and give one example prompt.

| The user wants to | Skill |
|---|---|
| Do any non-trivial task with rigor | `$p3` (**p3-mode**) |
| Know how code works now, or where new code should live | **how** |
| Know why code is shaped this way, or where a number came from | **why** |
| Understand a change or subsystem, explained plainly | **teach** |
| Catch up on their own recent work on a topic | **recall** |
| Know what a small diff could break outside itself | **blast-radius** |
| Settle types and module shape before code that crosses a function boundary | **architect** |
| Get several attempts at one brief, merged into the best one | **arena** |
| Run parallel checks over slices, or race workers, as delegated child tasks | **swarm** |
| Have several models review a diff and try to break it | **interrogate** |
| Fix a bug test-first when a cheap local test exists | **tdd** |
| Apply TypeScript rules to `.ts` or `.tsx` work | **typescript-best-practices** |
| Strip comments before review, using a reviewer that didn't write them | **no-comments** |
| Clean AI tells out of prose | **unslop** |
| Write docs, an RFC, a README, a PR description, or a commit message to a standard | **technical-writing** |
| Hear the last reply again in plain words | **bro** |
| Give agents a scripted way to drive the app and prove behavior | **create-verification-skill** |
| Bring a verification skill and its feature map back in line with the app | **maintain-verification-skill** |
| Vet a performance number before reporting or acting on it | **benchmark-checklist** |
| Run a large or cross-cutting change, or one to review after stepping away | **figure-it-out** |
| Keep a decision log during a run, and review it afterward | **show-me-your-work** |
| Pick a model for each role, a reasoning preset, or a project override | **setup-p3** |
| Turn their own working habits into a personal mode skill | **automate-me** |
| Turn what a finished task taught into skill edits | **reflect** |
| Stop agents from repeating the same mistakes in this repo | **correct** |
| Build a page whose buttons wake a bot over a webhook | **make-bot-ui** |
| Find their way around p3-stack | **p3-help** |

If a skill in this app is missing from the table, list the app's skills with the Executor `skills` tool and route by its description. The `principle-*` skills are covered under principles below. **p3-agent** is the brief preamble for delegates, not a user-facing skill.

Close calls:

- **how** explains what the code does. **why** explains the reasons. **teach** runs one or both and explains the result plainly.
- **arena** gives every worker the same brief and merges the best parts. **swarm** splits work into slices or a race and returns one report.
- **architect** implements right after it settles the design. Add "with checkpoint" to review the design before it writes code.
- **interrogate** reviews the diff. **blast-radius** looks for breakage outside the diff and proves the one fact that makes the change safe.
- **recall** rebuilds context across recent threads. Resuming one specific thread, delegated task, or branch is the Session pickup playbook.
- **figure-it-out** designs one rigorous run. The Orchestrate playbook runs a program that spans days and many PRs. The Autonomous run playbook drives one task to a finish condition.

**Not in p3-stack:** p3-stack has no orchestrate skill. Orchestrate is a p3-mode playbook.

## Playbooks and principles

Playbooks are step lists inside p3-mode, not skills, so they aren't invoked by name. Inside `$p3`, describing the task picks one, and these phrases name one directly; the Playbooks section of the **p3-mode** skill lists every playbook and when it applies:

- "babysit this pr" or "check on pr 123" runs Babysit. It drives the PR to merge-ready and stops there. It doesn't merge unless the user asks to merge, land, or ship.
- "land the stack" runs Shipping. "take over this branch" runs Session pickup. "pause safely" runs Pause safely. "run the eval playbook" runs Eval.
- "full autopilot on this queue" runs Autopilot-full. "stack them, don't ship" runs Autopilot-stack.

p3-stack has no planning skill. For work that spans phases or stacked PRs, asking `$p3` for a plan runs p3-mode's Multi-phase plan playbook, which writes the plan and doesn't implement it. For a design question, the Prototype playbook or **architect** settles it in code first.

Principles are one-rule skills that p3-mode reads and cites in its replies. The user rarely invokes one. They steer with the names instead, as in "apply prove it works. show me the real output." Asking for `principle-<name>` by name still loads one on demand.

## Fix a run that went wrong

| Symptom | Fix |
|---|---|
| The mode stopped applying after a few turns | Start each new task with `$p3`; there's no mode to toggle on. |
| A question got treated as the next step of the last task | Say "new task", or say the turn doesn't need the mode. |
| A new model choice had no effect | Choices apply at the next `models.resolve`. Check the scope: a project override wins over global for the roles it sets. |
| A role reports `invalid` | The catalog no longer offers its provider, model, or option. Rerun **setup-p3** for that role, or name a replacement for this run. p3 never swaps in another model, even under full autonomy. |
| A coordinating delegate replied `P3_SKILLS_UNAVAILABLE` | Its provider gives children no Executor tools. p3-mode saves `inline` delivery for that provider, keeps the coordination in the parent, and sends leaf briefs with the skill text pasted. |
| A delegate's report lists `P3_NEEDS` | Its brief lacked text or nested work it needed. p3-mode supplies the text or runs that work on configured roles, then sends a fresh brief. |
| Runs cost more than expected | See the cost paragraph under Get set up. |
| A skill didn't load on its own | p3 skills load when the user names them in a `$p3` task or when p3-mode runs them, and it doesn't run every skill. |
| Parallel agents overwrote each other | Give each worker its own git worktree, named in its brief, and keep one writer per worktree (p3-mode's Subagents section). |
| An overnight run moved but finished nothing | It needs a check that can pass or fail, not a duration. |
| The reply claims success from a green build | Ask for the real command, flow, stored value, or profile. That's the prove-it-works principle. |

## Make p3-stack my own

- **automate-me** drafts a personal mode skill from the user's own history, to use alongside `$p3`. **reflect** after a session turns its lessons into skill edits the user approves. `$p3 write a skill for <workflow>` runs the authoring playbook, and the eval playbook tests a skill change blind.
- Fix a misbehaving skill in its own PR, not inside the feature work where it went wrong. p3's own skills change in this Executor app's source and take effect after a deployment the user approves.

## Reply

Lead with the answer. Give at most one example prompt in a code block, then the skill it came from. Keep it short unless the user asked for the whole map.
