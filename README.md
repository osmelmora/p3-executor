# p3-stack on Executor

Run [p3-stack](https://github.com/uzairansaruzi/p3-stack) in T3 Code from one Executor app instead of installing its skills locally. You install one small wrapper skill. Every p3 skill, playbook, and principle, and your model choice for each p3 role, lives in an app in your Executor organization. An update is one redeploy, and every machine you connect gets the same p3.

p3-stack is Uzair Ansar's T3 Code port of [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan. This repository changes how the skills load, adds tools that store model choices, and syncs later pstack changes directly. See [Credit](#credit).

## How it works

- The `p3` wrapper skill is the only local file. It tells the agent to read the `p3-mode` skill from the `p3` app through Executor's MCP `skills` tool.
- `p3-mode` matches the request to a playbook and reads every other skill from the same app when a step needs it.
- When a step delegates, the agent asks the app which T3 provider and model the step's role uses, and T3 runs the child agent. Executor never runs a model. The model of your own conversation never changes.
- The app stores your model choices in its Executor database. There is no local config file.

## Requirements

- T3 Code with the Claude provider, the Codex provider, or both.
- An account on hosted Executor at [app.executor.sh](https://app.executor.sh). This guide uses hosted Executor.
- To deploy the app from this repository, git, Node.js 24.14.0 or newer, and `jq`.

## Install

Each person does steps 1 to 5 once. Repeat steps 1, 3, and 4 on every other machine you use.

### 1. Connect Executor to each provider

Claude and Codex keep separate MCP configurations, and T3 does not share servers between them. Connect Executor in every provider you start p3 threads from. A provider that only runs p3's child agents does not need it.

For Claude, add the server for all projects:

```sh
claude mcp add --transport http --scope user executor 'https://mcp.executor.sh/mcp'
```

Then start `claude` in a terminal and run `/mcp`. Choose `executor`, sign in through the browser, choose your organization, and approve the connection. Approve the same organization for every provider, and deploy the p3 app in that organization in step 2. Each connection reaches only the organization it was approved for. To check, run `claude mcp get executor`. It prints `Status: ✔ Connected`.

For Codex, add the server and sign in:

```sh
codex mcp add executor --url 'https://mcp.executor.sh/mcp'
codex mcp login executor
```

To check, run `codex mcp get executor`. It prints `enabled: true` and the URL.

### 2. Deploy the p3 app

Each person deploys their own copy. The app keeps one set of model choices for everyone who can use it, so two people on one copy share one setup. A new app's audience is **Only me**. Keep it that way.

From a clone of this repository, install the Executor CLI and sign in. The login prints a link and a code. Open the link and approve the code.

```sh
npm i -g executor@beta --include=optional
executor apps login --host https://api.executor.sh
```

Create the app from `app/`. The command prints the new app, including its `id`:

```sh
executor apps create --host https://api.executor.sh --name p3 --files ./app
```

Deploy its first commit. Replace `<app-id>` with that `id`:

```sh
commit=$(executor apps source --host https://api.executor.sh --app <app-id> | jq -r .revision.commit)
executor apps deploy --host https://api.executor.sh --app <app-id> --commit "$commit"
```

Name the app `p3`, because the wrapper reads the `p3` app first. If Executor rejects the name because it already exists in your organization, choose another name. If someone shares an app named `p3` with you, the wrapper reads theirs first, so ask them to keep it **Only me**. With any other name, the wrapper looks for the app that provides `p3-mode`, and asks you to choose if it finds more than one.

To deploy without installing the Executor CLI, ask an agent that has Executor connected and a shell in this repository to follow [Deploy through Executor MCP](docs/MAINTAINING.md#deploy-through-executor-mcp).

### 3. Install the wrapper skill

Codex reads skills from `~/.agents/skills`, and Claude reads them from `~/.claude/skills`. Copy the wrapper for each provider you use:

```sh
mkdir -p ~/.agents/skills/p3 ~/.claude/skills/p3
cp wrapper/p3/SKILL.md ~/.agents/skills/p3/SKILL.md   # Codex
cp wrapper/p3/SKILL.md ~/.claude/skills/p3/SKILL.md   # Claude
```

Install no other p3 skill locally. Upstream p3-stack's `install.sh` links every p3 skill into `~/.agents/skills`, or into a project's `.agents/skills`. If you ran it before, remove those links so agents load p3 only from Executor. `ls -l ~/.agents/skills` shows them as links into your p3-stack checkout.

### 4. Restart the agent session

An agent session loads MCP servers and skills only when it starts. A thread that was running before steps 1 and 3 cannot see Executor or `$p3`, even after a successful sign-in. In T3, open the command palette and run **Restart agent session**, or start a new thread.

### 5. Choose your models

In a new thread, send:

```text
$p3 configure models
```

The agent reads `p3-mode` from Executor and runs the `setup-p3` skill. It lists the providers and models your T3 offers, asks for a reasoning preset, and asks which model each role uses. You can choose by group, role by role, or this conversation's model everywhere. The choices save globally or for one repository. If you skip this step, your first p3 task runs setup first.

## Use p3

Start each task with `$p3` and the task. T3 has no `/p3` command. Typing `$` in the composer lists skills, and by default the `/` menu also lists this one as `/skill:P3`. Choosing it from either list inserts `$p3`.

| To | Send |
|---|---|
| Run a task | `$p3 fix the flaky login test and show the passing run` |
| See your model choices | `$p3 show my model setup` |
| Change model choices | `$p3 configure models`, or `$p3 set how explainer to Opus 5.5 at xhigh` |
| Ask which skill fits | `$p3 which skill reviews a PR?` |
| Ask for a skill by name | `$p3 run interrogate on this diff` |

There are no mode toggles. Start each new task with `$p3`.

### Where your choices are saved

p3 writes no local file. The app stores your choices in its Executor database, in one global scope and in optional overrides for single repositories. An override is keyed by the repository's `origin` remote and replaces only the roles it sets. Redeploying the app keeps the database. `$p3 show my model setup` reads the saved choices back. [Model configuration and child delivery](docs/MODEL-CONFIG.md) documents the tools behind it.

### Roles

Setup asks for a model for each of these 17 roles. A panel role takes a list of 1 to 16 models. The runner and reviewer panels run one agent per entry, and `arena cross-judge pool` supplies the candidates for one judge. Setup suggests one panel entry per provider, because reviewers from different model families catch different problems.

| Role | Used for |
|---|---|
| `feature, refactoring` | Code changes in the Feature and Refactoring playbooks |
| `bug-fix` | Code changes in the Bug fix playbook |
| `perf-issue` | Code changes in the Perf issue playbook |
| `hillclimb` | Code changes in the Hillclimb playbook |
| `hardest tasks` | The hardest code changes in any playbook, such as cross-cutting design, concurrency, and subtle algorithms |
| `swarm workers` | Parallel workers in `swarm` and in the Shipping, Orchestrate, and multi-phase plan checks |
| `judgment and prose` | Delegated writing and judgment calls that produce no code, such as the decision-trail review |
| `how explorer`, `how explainer` | In `how`, the explorers read the code in parallel and the explainer writes the answer |
| `why investigators`, `why synthesizer` | In `why`, the investigators collect the history of a decision and the synthesizer writes the answer |
| `reflect tooling`, `reflect judgment, divergent, synthesizer` | The reviewers in `reflect`, which turns a thread's lessons into skill edits |
| `arena runners` (panel) | The competing attempts in `arena` and in the Eval playbook |
| `arena cross-judge pool` (panel) | The models `arena` picks its judge from, preferring a provider other than yours |
| `architect runners` (panel) | The parallel design sketches in `architect` |
| `interrogate reviewers` (panel) | The adversarial multi-model review in `interrogate` |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `$p3` says Executor's `skills` tool is unavailable and stops | Executor is not connected for this thread's provider, or the session started before you connected it | Do Install step 1 for that provider, then step 4 |
| `claude mcp get executor` or `codex mcp get executor` shows Executor, but the thread still cannot see it | The session started before you added the server | Run **Restart agent session**, or start a new thread |
| Typing `$` does not list `p3` | The wrapper is not in that provider's skills folder, or the session started before you copied it | Do Install step 3, then step 4 |
| The agent cannot find the `p3` app, or asks which copy to use | The app is not deployed, this provider's connection was approved for another organization, or more than one app provides `p3-mode` | Deploy the app in the organization this provider's connection uses. If several copies match, choose yours |
| A role shows as `invalid` | Its provider, model, or option left T3's catalog | Run `$p3 configure models` and choose a replacement. p3 never substitutes a model on its own |
| A child agent replies `P3_SKILLS_UNAVAILABLE` | That provider's child agents cannot read skills from Executor | No action. p3 records this and keeps that coordination in your thread |
| A deploy fails and names the `apps` version | Executor no longer builds the version pinned in `app/package.json` | Follow [Upgrade the `apps` framework](docs/MAINTAINING.md#upgrade-the-apps-framework) |

## Update

To install a newer version of this repository, pull it and redeploy the same app. The app keeps its id and your saved choices. `executor apps list --host https://api.executor.sh` shows your app ids.

```sh
git pull
expected=$(executor apps source --host https://api.executor.sh --app <app-id> | jq -r .revision.commit)
executor apps commit --host https://api.executor.sh --app <app-id> --files ./app --expected "$expected" --message "Update p3" > /tmp/p3-commit.json
jq .removed /tmp/p3-commit.json    # files this save deleted, expect a count of 0
commit=$(jq -r .revision.commit /tmp/p3-commit.json)
executor apps deploy --host https://api.executor.sh --app <app-id> --commit "$commit"
```

If `wrapper/p3/SKILL.md` changed, copy it again (Install step 3) and restart the agent session.

## Develop

`mise.toml` pins Node.js and pnpm. Run `mise install` once, then:

```sh
pnpm install
pnpm verify         # typecheck app (Executor's command), typecheck all, tests, bundle audit
pnpm test
pnpm check:bundle --list
```

The tests load `app/index.ts` through `apps/host`'s `createAppHandler`, the same entry point the Executor host uses. They back `ctx.sql` with `node:sqlite` after applying `app/migrations/`, and read skills with the framework's packaged-skill loader. `test/fixtures/live-capabilities.json` is an unmodified `orchestrator_capabilities` result captured on 2026-10-10, with only its thread id replaced. The wrapper is parsed with the framework's `fileSkill`. No test delegates a task or calls a model.

[docs/MAINTAINING.md](docs/MAINTAINING.md) covers upstream syncs, framework upgrades, schema changes, and the pre-deploy checklist.

| Path | Ships | What it holds |
|---|---|---|
| `app/` | yes | The deployable app: `index.ts`, `lib/`, `migrations/`, `skills/`, `package.json`, `LICENSE`, `NOTICE.md`. |
| `wrapper/p3/SKILL.md` | no | The local `p3` wrapper skill. It holds no workflow text. |
| `UPSTREAM.json` | no | The pinned pstack commit, and the path map and name rewrites the sync script uses. |
| `test/` | no | Behavioral tests that run the real app module through the `apps` framework handler on SQLite. |
| `scripts/` | no | Bundle audit, deploy payload, upstream sync, and the child-brief walkthrough (`child-briefs.ts`). |
| `docs/` | no | Maintenance steps and the model-configuration reference. |
| `.dev/` | no | Ignored scratch, such as the upstream checkout and deploy chunks. |

Pins: upstream `cursor/plugins@9b93e81fb2921b9263d9463c15bafeabfe3903aa` (`pstack/`), framework `apps@0.0.1-beta.76`.

## Credit

p3-stack is Uzair Ansar's T3 Code adaptation of [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan. MIT. See [LICENSE](LICENSE), `app/LICENSE`, and `app/NOTICE.md`.
