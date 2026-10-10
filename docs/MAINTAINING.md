# Maintaining the p3 Executor app

Every change ends with `pnpm verify` green and a redeploy (README, Update). A deploy is the user's call.

## Pull in upstream p3-stack changes

The adapted skills are a fork of upstream at the commit in `UPSTREAM.json`. The sync script merges each changed upstream file three ways: the pinned commit is the base, `app/` is ours, the new commit is theirs.

```sh
node --import tsx scripts/sync-upstream.ts origin/main --dry-run   # list what would merge, conflict, or appear
node --import tsx scripts/sync-upstream.ts origin/main             # merge in place; pins the commit when clean
# after resolving conflict markers by hand:
node --import tsx scripts/sync-upstream.ts <commit> --record
```

`pathMap` in `UPSTREAM.json` routes `agents/p3-agent.md` to the `p3-agent` skill and `agents/comment-sicko.md` to `no-comments/references/comment-sicko.md`. The script reports files upstream removed and upstream files with no mapping; handle those by hand.

Then audit every merged or added file. `pnpm test` fails on the mechanical cases, and the rest needs reading.

| Upstream text | Executor version |
|---|---|
| `/skill-name` invocations | "the **skill-name** skill" |
| `../other/SKILL.md` links | the skill's name in bold |
| `references/x.md` from a file inside `references/` or `playbooks/` | the path from the skill's directory, which is the Executor `file` value |
| `p3-models.md`, "the `<role>` line" | "the `<role>` role, resolved through `models.resolve` (p3-mode's Model configuration)" |
| `agents/p3-agent.md` | the **p3-agent** leaf contract, pasted at the top of leaf briefs per p3-mode's Skill delivery |
| `t3_thread_launch` to give a worker a worktree | the worker creates its own worktree (p3-mode's Subagents section) |
| "fall back to the closest valid model", "a different model family", "one model per provider" | a configured role, honored exactly; no substitute (p3-mode's Model configuration step 6) |
| "drain with `task_status`", poll loops | collect results per p3-mode's Waiting on delegates |
| "re-read this playbook from trunk" | p3-mode's Scheduled ticks prompt, which reads from this app |
| A brief that tells a child to read a skill | a leaf brief pastes the text; a template's header lists the files and skills to paste; only coordinating children read this app |
| `auto` as a role value | `inherit-parent` |
| A bundled script the agent runs | Executor returns it as text; save it outside the repository first |

Run `node --import tsx scripts/child-briefs.ts` after every merge. A brief that names something it neither pastes nor leaves to the parent, or asks the child to read what it lacks, fails `test/child-briefs.test.ts`. A new upstream skill whose steps call `delegate_task` joins the parent-owned list pinned in that test, and leaf briefs never paste it. A new template adds its brief to `walkthroughBriefs` in the script.

A new upstream role needs four edits: `roleKinds` in `app/lib/model-config.ts`, the setup groups in `skills/setup-p3/SKILL.md`, the role count in `test/model-config.test.ts`, and the role table in README.

## Upgrade the `apps` framework

Do this when Executor's `framework.release` (or `executor apps framework`) returns a version other than the pin.

1. Set the exact version in both `app/package.json` `dependencies.apps` and the root `package.json` `devDependencies.apps`. The bundle audit fails when they differ.
2. `pnpm install`, then read the release's notes in the Executor `app-authoring` skill (`upgrades/<version>.md`, when one exists).
3. `pnpm verify`. The tests drive the app through the new framework's own handler, so changed contracts fail there. `test/bundle.test.ts` also fails when `node_modules` holds a different `apps` than the pin.
4. Regenerate the MCP payload (`node --import tsx scripts/deploy-payload.ts`) so no chunk carries the old pin, then redeploy. Stored configuration survives, because a deploy keeps the app's database.

## Deploy through Executor MCP

Use this path when you have a shell in this repository but not the Executor CLI (README, Install step 2). An agent with Executor connected makes the management calls. Run `pnpm install` at the repository root first, because the payload script runs through `tsx`.

`node --import tsx scripts/deploy-payload.ts` writes `.dev/deploy/chunk-NN.json` (each under 60,000 characters, so it fits one `execute` program) and `manifest.json`. It replaces the whole directory, so run it after every change to `app/`, a framework bump included.

1. In `execute`, discover the management app with `tools.search`, call `context.get({})` for the organization, and check that `framework.release` returns the pinned `apps` version, the same one as `appsVersion` in `manifest.json`. A different version means bumping it first (Upgrade the `apps` framework).
2. Create the app from chunk 1: `appManagement.create({ path: { organization }, body: { name: "p3", files: <chunk-01> } })`. Chunk 1 holds `index.ts`, `package.json`, `lib/`, and `migrations/`.
3. For each later chunk, one `execute`: read `appManagement.source`, then `appManagement.commit` with `expected: source.revision.commit` and the source files plus the chunk. A commit replaces the whole file list, so always include the files already saved.
4. Read the source once more and compare it with `manifest.json`: every path present, each `content.length` equal to its `chars`. Then `appManagement.deploy({ path: { organization, app }, body: { commit } })`.

Deploying applies `migrations/0001_model_config.sql` and `migrations/0002_revision_clock.sql` in order.

**Check the deployment** in a new `execute`, with no delegation:

- `tools.p3.models.read({})` returns `configured: false` and 17 roles on a new app.
- `skills({ app: "p3" })` lists 52 skills.
- `skills({ app: "p3", name: "p3-mode" })` reads the router.

## Change stored configuration

- Applied migrations never change. Add the next numbered file, such as `app/migrations/0003_<name>.sql`, for a schema change.
- Revisions come from the single-row `model_config_clock` table (`0002_revision_clock.sql`), so they never repeat across a scope's deletion and recreation. Keep every write that saves a scope on `nextRevision` in `app/lib/store.ts`.
- The JSON document in `model_config_scopes.document` carries `version: 1`. A shape change bumps the version and teaches `parseScope` to read the old one, or the first read fails with `stored-config-corrupt`.
- Tool input changes must stay readable by older agent text in `skills/`. Rename a field in both places in one change.

## Check before deploying

- `pnpm verify` is green.
- `pnpm check:bundle --list` shows only `app/` source, skills, migrations, `LICENSE`, and `NOTICE.md`.
- `NOTICE.md` names the pinned upstream commit, and `LICENSE` matches upstream.
- `wrapper/p3/SKILL.md` still parses as skill `p3` and reads `{app: "p3", name: "p3-mode"}`. Installing it is a copy into `~/.agents/skills/p3/` and `~/.claude/skills/p3/` (README, Install step 3).
