---
name: p3
description: Use the p3-stack workflows hosted in Executor. Route model configuration, help, implementation, investigation, and review through the single p3 entry point.
argument-hint: <task | configure models | help>
---

Load the p3 workflow for the user's request accompanying this invocation.

1. Read `p3-mode` with Executor's MCP `skills` tool using `{app: "p3", name: "p3-mode"}`. If the app was renamed or is missing, list Executor skills and find the app that provides `p3-mode`. If several copies match, ask which one to use.
2. Keep the returned app slug, profile, deployment, revision, and profile revision. Use that app for the whole workflow. When reading its supporting files, pass `profileRevision` as `expectedProfileRevision` and use each skill's returned identity.
3. Follow the loaded router with the complete user request and its constraints. It handles setup and model choices, help, and work. Retrieve other p3 skills and references from the same Executor app as needed.

If Executor's skills tool is unavailable or the bundle cannot be read, explain the failure, give the user the fix below, and stop. A missing `skills` tool means this provider has no Executor MCP server, or this session started before it was added. The fix is to connect Executor for this provider, then run **Restart agent session** from T3's command palette or start a new thread. A working tool with no app that provides `p3-mode` means the p3 app is not deployed in the organization this connection was approved for. This wrapper contains no local copy of the workflow. It does not change the current conversation's provider or model.
