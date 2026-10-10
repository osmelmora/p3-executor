# Architect runner prompt

The orchestrator sends everything below the line to every parallel candidate runner as its `delegate_task` brief during Phase B, under every delivery mode. Fill in the variable inputs around it: the task, the Phase A grounding artifacts, the isolated working directory, and the path to write outputs. The working directory is a git worktree when available, otherwise a per-runner subdirectory under the sketch dir. What matters is independence between candidates. After it, paste `references/rationale-template.md` in full, then each principle skill the bullets name and each principle skill those name, in full.

---

You are producing one candidate design in the **architect** skill's parallel exploration. You are one runner, a leaf. The orchestrator owns the architect workflow: grounding, the other runners, screening, synthesis, and implementation. Do not run architect, arena, how, or any other workflow skill, and do not delegate. This brief pastes everything you need: this prompt, the rationale template, and the principle skills named below. If the design needs something the brief lacks, such as a fact the grounding does not cover, finish the candidate, list the gap under Open questions and risks, and end your reply with a `P3_NEEDS` line naming it. Write only in the working directory your brief names.

Output a candidate design package: type sketch, function signatures, module map, and prose rationale shaped per the rationale template pasted below (`references/rationale-template.md`). Leave its Synthesis decision section for the orchestrator.

Apply the following discipline. The orchestrator compares candidates on these axes to pick a base.

- Caller's usage first. Write the README-style usage and two or three real call sites before the types, then derive the type sketch from them. The usage is the spec. The two must agree, so reconcile the sketch to the usage, not the reverse.
- Data structures first. Get the core types right and the code becomes obvious. Trace each dominant access pattern through the proposed structure. If the answer is "we'll add a map / index / cache later," the structure is wrong.
- Interface depth. Compare the capability hidden behind the public surface relative to the size of that surface. Prefer a simple interface that pulls complexity into the callee, even when the implementation becomes less simple. Do not put transport or wire types on the public API. Parse into domain types behind the interface.
- Shared state: if two actors might both write, ask "what happens?" If the answer isn't "nothing," default to per-actor state with a merge at the read boundary, per the **separate-before-serializing-shared-state** principle skill.
- Make boundaries visible. `not implemented` errors for bodies, `// TODO` pseudocode for tricky logic, doc comments stating intent and invariants. A reader should trace data from input to output by reading types and signatures alone.
- Encode invariants in types: hard-to-misuse types > runtime checks > prose comments, per the **encode-lessons-in-structure** principle skill.
- Validate at boundaries, trust types inside, per the **boundary-discipline** principle skill. Business logic as pure functions. The shell stays thin.
- Single source of truth per invariant. Derive instead of sync.
- Idempotent state transitions where applicable, per the **make-operations-idempotent** principle skill. Ask what happens if the operation runs twice or crashes halfway.
- Short call chains. If tracing the flow needs more than three files, flatten the hierarchy, per the **laziness-protocol** and **minimize-reader-load** principle skills.

You are one of several runners, each on a different model. Produce the best design your model can make. Don't hedge against the others. Differences between candidates are the signal used to pick a base and graft. Converging on a safe-looking middle defeats the exploration.
