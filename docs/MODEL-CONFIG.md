# Model configuration and child delivery

Reference for the app's three model tools and for how p3 briefs child agents. To change your choices, run `$p3 configure models` instead of calling these tools by hand.

## Model tools

The app has three tools, called inside Executor `execute` at `tools.<app slug>.models.*`.

| Tool | Kind | Does |
|---|---|---|
| `models.read({ project? })` | query | Saved global choices and one project's overrides, the role list, and the reasoning presets. No catalog needed. |
| `models.write({ catalog, project?, expectedRevision?, budget?, set?, unset?, reset?, skillDelivery? })` | mutation | Patches one scope. Every entry it writes is checked against `catalog`; any problem rejects the whole write. |
| `models.resolve({ catalog, project?, roles? })` | query | Turns roles into `delegate_task` targets for this session. |

`catalog` is the `orchestrator_capabilities` result, passed as returned. Executor cannot see the T3 catalog itself.

- **Roles.** The 17 upstream role names, such as `bug-fix` and `judgment and prose`. Four are panels (`arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers`) and take 1 to 16 entries. `models.resolve` returns one delegate per entry. The runner and reviewer panels run every delegate, and Arena picks one judge from `arena cross-judge pool`.
- **Entries.** `{ use: "model", providerInstanceId, model, options?, presetKeys? }` or `{ use: "inherit-parent" }`. An inherited delegate resolves to no `target`, so the child inherits the parent's provider, model, and options. A model entry without options sends no `options`, so T3 decides what the child inherits; save options to pin them.
- **Options.** Keys and values must match the model's catalog entry exactly. `select` options take one of their value ids, values beyond max included, and `boolean` options take `true` or `false`. Any other option type is rejected because the app cannot validate it.
- **Validation.** The provider instance must have `canRunChildTask`. When the catalog names the parent's provider, a different provider must not report `canRunCrossProviderChildTask: false`.
- **Precedence.** A project scope overrides global role by role. Roles it does not set fall through to global.
- **Project keys.** `project` is the repository's `origin` remote. Every key the app returns (`project`, `scope.project`) can be passed back as `project` and names the same scope.
  - URL forms over `https`, `http`, `ssh`, `git`, and `git+ssh`, and git's scp form `user@host:path`, share one key when they reach the same host, port, and path. On the scheme's default port (443, 80, 22, 9418) the key is `host/path`: `git@github.com:Acme/Web.git` and `https://github.com/acme/web` are both `github.com/acme/web`.
  - On any other port the key is `//host:port/path`: `ssh://git@git.example.com:2222/team/repo.git` is `//git.example.com:2222/team/repo`, separate from port 2223. The leading `//` matters. Git reads `git.example.com:2222/team/repo` as its scp form, the path `2222/team/repo` on the default port, so that value and `https://git.example.com/2222/team/repo` are both `git.example.com/2222/team/repo`, a different project.
  - The user, password or token, query, and fragment are never stored. A leading `/` and any trailing run of `/` and `.git` are dropped. The host is lowercased. IPv6 hosts keep their brackets (`//[2001:db8::1]:2222/team/repo`).
  - Path case is kept, because self-hosted servers can be case-sensitive, so a `Repo.GIT` there keeps its `.GIT`. Only `github.com` paths are lowercased, before the `.git` trim: `ssh://git@github.com:2222/Acme/Web.GIT` is `//github.com:2222/acme/web`.
  - Another scheme keeps its scheme (`file:///srv/repo`). A value that is neither a URL, a `//` key, nor the scp form, such as a local path, is kept as written without trailing slashes.
  - Rejected with `project-invalid`: a port that is not a number from 1 to 65535, a URL with no host, and a value whose key would change when passed back, such as a path that ends in a space once `/` and `.git` are dropped.
- **Revisions.** Every saved scope has a revision drawn from one counter for the whole database (`migrations/0002_revision_clock.sql`), so a revision is never reused, even after a scope is deleted and created again. `expectedRevision: 0` means the scope must not exist; a deleted scope reads as absent. A write whose `expectedRevision` is stale fails with `revision-conflict` and saves nothing.
- **Stale settings.** `resolve` marks a role `invalid` when its provider, model, or option left the catalog, and returns no target for it. Nothing is substituted.
- **Reasoning presets** (`provider-default`, `small`, `medium`, `large`, `unlimited`, `custom`) are labels for what setup proposes, not spending caps. The app stores the label and never maps it to option values. `presetKeys` records which options came from a preset, so a re-run changes those and keeps the user's explicit ones.
- **Skill delivery.** `skillDelivery` records per provider instance whether its children can read skills through Executor (`executor-read`) or not (`inline`). Only coordinating children (Autopilot owners, Orchestrate sub-coordinators) depend on it; an unknown provider gets a fail-fast brief line (`P3_SKILLS_UNAVAILABLE`), and an `inline` one leaves the coordination with the parent.


Storage is the app's SQLite database (`migrations/0001_model_config.sql`), shared by everyone who can use the app. Keep the app's audience at "Only me" so the choices stay one person's.

## Child delivery

T3 runs every child, and a child may have no Executor tools. p3-mode's Skill delivery makes every brief closed:

- **Leaf briefs**, the default, open with the `p3-agent` leaf contract. The parent pastes the text of each skill and file the task needs, plus whatever that text names, transitively. Workflow skills that delegate (how, why, architect, arena, swarm, interrogate, reflect, no-comments, show-me-your-work, and the rest) stay with the parent, which runs any review, design, or verification itself on configured roles. The child runs only pasted text, delegates nothing, and returns `P3_NEEDS` requests for anything missing.
- **Template briefs** (the how, why, interrogate, and reflect prompts, architect runners, Comment Sicko) paste the files their headers list and are closed the same way.
- **Coordinating children** read this app themselves and resolve their own roles, so they go only to providers whose children have Executor.

`node --import tsx scripts/child-briefs.ts --write .dev/walkthroughs` assembles the exact text of a realistic code-worker brief and every template brief from the bundled skills, and reports what each pastes, what the parent keeps, and anything missing. `test/child-briefs.test.ts` fails if any brief names something it neither pastes nor leaves to the parent, or asks the child to read something it lacks.
