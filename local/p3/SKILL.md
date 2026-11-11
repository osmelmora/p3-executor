---
name: p3
description: Use the p3-stack workflows installed on this machine. Route model configuration, help, implementation, investigation, and review through the single p3 entry point.
argument-hint: <task | configure models | help>
---

Load the p3 workflow for the user's request accompanying this invocation.

1. Read `p3-mode/SKILL.md` in the directory that holds this skill's directory. That directory is the skills root. Keep its absolute path for the whole workflow.
2. Follow the loaded router with the complete user request and its constraints. It handles setup and model choices, help, and work. Read other p3 skills and references from the same skills root as needed.

If `p3-mode/SKILL.md` is missing there, explain that the local p3 install is incomplete, tell the user to run the installer again from the p3 source repository, and stop. This entry point contains no workflow text. It does not change the current conversation's provider or model.
