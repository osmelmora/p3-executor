---
name: setup-p3
description: Choose which T3 provider and model each p3 role delegates to, with a reasoning preset, panels, and optional project overrides, and save the choices in this Executor app. Use for $p3 setup, "configure p3 models", "p3 budget", changing a role's model, or first use when nothing is saved.
disable-model-invocation: true
---

# Setup p3

Save the user's model choice for each p3 role in this app. The choices pick `delegate_task` targets for child agents only. The model running this conversation never changes.

Propose only from the catalog and the user's answers. The model running this conversation, and any model a brief or an earlier task used, is not the user's preference until they choose it here.

Call the app's tools inside Executor `execute` at `tools.<app slug>.models.*`; p3-mode's Loading p3 skills section has the slug rule. Pass the catalog as JSON data in the program.

## Steps

### 1. Detect what can run

Call `orchestrator_capabilities`. Its result is the catalog, the only source of providers, models, and options. A provider instance whose `canRunChildTask` is false cannot run a delegate; list it with its `constraints` and never offer it. If no provider instance can run one, stop and tell the user. `inherit-parent` is always offered: the role runs on this conversation's provider, model, and options, so its cost follows whatever this conversation runs on.

### 2. Load what is saved

Call `models.read({ project })`. `project` is the repository's `origin` remote (`git remote get-url origin`). Omit it outside a repository. The result has the `global` scope, any `projectScope`, every role in `roleCatalog`, and the `budgetPresets`. When something is saved, also call `models.resolve({ catalog, project })` and keep each `invalid` role's problems for step 5.

Ask which scope to change. Global is the default. A project scope overrides only the roles it sets; every other role falls through to global. Offer the project scope only when there is a remote.

### 3. Ask for a reasoning preset

Ask plainly in the thread. A preset says how much reasoning setup proposes for each chosen model. It is not a spending cap. Offer the presets `models.read` returned, with their `proposal` text, and name the scope's current one. Recommend `provider-default` when the user has no preference.

### 4. Choose models

On a fresh scope, offer three ways to choose:

- **This conversation's model everywhere.** Every role is `inherit-parent`. Panels get one `inherit-parent` entry. Cheapest to set up; panels and the decision-trail review lose cross-model review, and p3 says so when it happens.
- **By group.** One choice per group, then edits to single roles. Code: `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `swarm workers`. Judgment: `judgment and prose`, `how explainer`, `why synthesizer`, `reflect tooling`, `reflect judgment, divergent, synthesizer`. Hardest: `hardest tasks`. Explorers: `how explorer`, `why investigators`. Panels: `arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers`.
- **Role by role.**

Each answer is `inherit-parent` or a `providerInstanceId` and model id from the catalog. A panel is a list. Each entry runs one delegate, `inherit-parent` entries included, so the list length is the fan-out. Suggest one entry per usable provider instance for panels, since review signal comes from model diversity, and let the user pick each model. `arena cross-judge pool` is the list Arena picks one judge from, preferring a provider other than the parent's.

On a re-run, start from the saved scope and keep every role the user does not change.

### 5. Fill options from the preset

Options are per model. Read each chosen model's own `options` in the catalog. Keys and values differ by model (`reasoningEffort` on one, `effort` on another), so never assume a ladder.

- `provider-default` and `custom` propose nothing.
- Otherwise find the model's reasoning option: a `select` option whose label or id says reasoning or effort. Propose the value the preset names only when that exact id is offered, and record that key in the entry's `presetKeys`. If no option matches, or the value is not offered, propose nothing for that model and say so.
- Never propose a value the preset does not name, including values beyond max (`ultra`, `ultracode`, `ultrathink`) and cost options such as a priority service tier or a fast mode. The user may choose any offered value or boolean explicitly. Copy the catalog's `description` for such a value when it has one.
- An explicit option the user chose is never in `presetKeys`. On a re-run with a new preset, recompute only `presetKeys` options and keep every explicit one.

### 6. Show and confirm

Show every role in the scope: its entries, each entry's options with preset ones marked, and the source scope. Mark each step 2 `invalid` role with its problems, each role the scope leaves unset (it keeps the routed skill's default, or the global choice inside a project scope), and every provider instance step 1 excluded. Ask whether to save as shown or change specific roles. Only the user's confirmed answers are saved.

### 7. Save

Call `orchestrator_capabilities` again right before saving, because the user's answers can take a while and the app checks only the catalog it receives. Then call `models.write` once for the scope with that catalog:

```js
const app = tools["<app slug>"];
return await app.models.write({
  catalog,                       // the orchestrator_capabilities result
  project,                       // omit for the global scope
  expectedRevision,              // the scope's revision from step 2, or 0 when it had none
  budget: "medium",
  set: [
    { role: "bug-fix", entries: [{ use: "model", providerInstanceId: "<id>", model: "<id>", options: { "<option id>": "<value id>" }, presetKeys: ["<option id>"] }] },
    { role: "interrogate reviewers", entries: [{ use: "inherit-parent" }, { use: "model", providerInstanceId: "<id>", model: "<id>" }] },
  ],
  unset: [],                     // roles to clear from this scope
});
```

The app checks every entry against the catalog: the provider instance can run a child, the model is offered, and each option id and value is offered exactly as spelled, with booleans for boolean options. Any problem rejects the whole write and names each one. Fix the named entries with the user and save again. `revision-conflict` means another session saved first: read again, show the difference, and confirm before saving. `staleInScope` in a successful result lists saved roles the catalog no longer supports; offer to fix them.

`reset: true` clears the scope before `set`, and a project scope left empty is deleted. `budget: "unset"` clears the preset label.

### 8. Skill delivery (optional)

A child can read p3 skills through the Executor `skills` tool only when its provider gives it Executor tools. Leaf briefs always carry pasted text, so this setting matters only for coordinating children, such as Autopilot owners and Orchestrate sub-coordinators. If the user knows which provider instances give children Executor tools, save `skillDelivery` entries (`executor-read` or `inline`) with `models.write`. Unknown is fine: p3-mode's Skill delivery detects it on first use and saves it then.

### 9. Confirm

Tell the user what was saved, in which scope, and its revision. Choices take effect on the next `models.resolve`, in this conversation and new ones. Re-running this skill edits them.

### 10. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with the create-verification-skill skill." On yes, run the **create-verification-skill** skill. On no, move on without pushing.
