### Authoring or modifying a skill

**You own the skill's voice.**

1. Write `SKILL.md` with `name` and `description` frontmatter. Keep it thin, follow the repo's AGENTS.md conventions, test the description trigger, and reference other skills by path, or by name for skills that load through Executor, such as p3's.
2. Validate the skill: frontmatter has `name` and `description`, referenced files exist, cross-skill links resolve.
3. Test cases if structural. Skip if subjective.
4. Run **Opening a PR**.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path or Executor name. Don't restate. A p3 skill changes in the p3 Executor app's source, and its deployment waits for the user. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
