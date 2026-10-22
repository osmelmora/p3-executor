# Notice

This app bundles an adapted copy of pstack, by way of p3-stack.

- Source: [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan ([poteto](https://x.com/poteto)) at cursor/plugins commit `9b93e81fb2921b9263d9463c15bafeabfe3903aa` (2026-10-22). The skills, principles, and language are hers.
- The T3 Code rewiring is Uzair Ansar's [p3-stack](https://github.com/uzairansaruzi/p3-stack) at commit `09909ebb5c0125e27fad3e57d96b81e832696d69` (2026-10-05, "skills: port pstack to T3 Code"), which ported pstack `4e5b1cf2cc`. Later pstack changes are merged here directly.
- License: MIT. The upstream license is reproduced verbatim in `LICENSE`, and it covers the adapted skills in `skills/`.

## Changes in this copy

- Skills load through Executor's `skills` tool from this app. Nothing is installed in a home directory or a repository. Cross-skill links and slash commands name skills instead, and paths inside a skill are relative to that skill's directory.
- `agents/p3-agent.md` became the `p3-agent` skill, rewritten as a self-contained leaf-worker contract: the worker runs only the skill text its brief pastes, delegates nothing, and returns `P3_NEEDS` requests to its parent. `agents/comment-sicko.md` became `skills/no-comments/references/comment-sicko.md`, and it traces claims itself instead of running other skills.
- The `p3-models.md` file is replaced by this app's `models.read`, `models.write`, and `models.resolve` tools, backed by the app's SQLite storage and validated against the caller's `orchestrator_capabilities` catalog. `setup-p3` is rewritten around them. Reasoning presets no longer map to a fixed effort ladder. A role whose model left the catalog is reported invalid; upstream's fallback to the closest model is removed.
- `p3-mode` gains Loading, Routing, Model configuration, Skill delivery, Waiting on delegates, and Scheduled ticks sections. `$p3` is the single entry point. Child briefs are closed: leaf and template briefs carry the text they need, and only coordinating children read this app.
- Every "drain with `task_status`" became T3's completion-wake protocol. Cross-model review picks from configured roles, never from the raw catalog, and a full-autonomy grant never replaces an invalid role's model.
- Scheduled audit ticks read their playbook from this app with a cold-turn prompt instead of from the project's trunk.
- Concurrent writers create their own git worktree. `t3_thread_launch` is reserved for top-level threads the user asks for.
- `p3-help` setup guidance, `show-me-your-work` helper use, `reflect` skill edits, and the multi-phase plan's skill reads are adapted to the Executor app.
- pstack's per-spawn tuning of reasoning level and fast or standard speed is left out. A role runs on exactly the target the user configured.
- pstack's `poteto-mode/scripts/` (PR watcher, plan checker, orchestration store, worktree audit) are not shipped; T3 tools replace them. `statechart/scripts/` ships without its tests, and the agent copies it out of the app before running it.
- Frontmatter is otherwise unchanged. `disable-model-invocation` is inert metadata in Executor.
