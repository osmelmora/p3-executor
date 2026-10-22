---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Use the `arena runners` role, resolved through `models.resolve` (p3-mode's Model configuration), one runner per delegate. If the role is unset, run **setup-p3** for it first, as **architect** and **interrogate** do. Never fill an unset seat with a model the user did not choose. An `inheritParent` delegate in this role or the cross-judge pool means the parent model, so omit `target` for it. An invalid role, or a seat whose target `delegate_task` rejects, gets no substitute. Follow p3-mode's Model configuration step 6. Spawn more runners, reusing the role's own delegates, when the arena covers multiple design directions. Run one configured delegate N times when the work is generation-bound rather than judgment-sensitive.
4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill. A candidate that needs its own worktree creates it with `git worktree add` at the path its brief names (p3-mode's Subagents section). One writer per worktree.

## Phase B: Fan out

Spawn all N candidates in one turn with `delegate_task`, one per runner entry, each with `mode: "async"`. T3 child agents get only the brief, never the parent's context, so every brief stands alone. It carries the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected. Each is a leaf brief per p3-mode's Skill delivery, or the closed template brief a caller supplies, such as **architect** runners.

Collect the candidates per p3-mode's Waiting on delegates. If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one delegate from the resolved `arena cross-judge pool` role. Prefer one whose `runsOn` provider differs from the parent's. Spawn one judge with `delegate_task` on that model. Its brief says read-only. Inspect only, no writes. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with your reading in Phase D. Don't spawn it while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
