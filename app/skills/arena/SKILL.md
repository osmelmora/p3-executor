---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Fan out N parallel attempts at the same task. Read every candidate end to end. Pick the strongest as the base. Graft the best ideas from the others into it. Verify the synthesized result.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Cross-judge
4. Pick
5. Graft
6. Verify

## Phase A: Frame

The N candidates will receive the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric. State what success looks like for *this* task, then turn it into 3-6 concrete gradeable criteria. The rubric is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Use the `arena runners` role, resolved through this app's `models.resolve` (p3-mode's Model configuration): one runner per delegate. If the role is unset, run **setup-p3** for it first, as **architect** and **interrogate** do. Never fill an unset seat with a model the user did not choose. An `inheritParent` delegate in this role or the cross-judge pool means the parent model, so omit `target` for it. An invalid role, or a seat whose target `delegate_task` rejects, gets no substitute: follow p3-mode's Model configuration step 6. Spawn more, reusing the role's own delegates, when the arena covers multiple design directions. Run one configured delegate N times when the work is generation-bound rather than judgment-sensitive.
4. Assign output paths. Each candidate writes to its own location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill. A candidate that needs its own worktree creates it with `git worktree add` at the path its brief names (p3-mode's Subagents section). One writer per worktree.

## Phase B: Fan out

Spawn all N candidates in one turn with `delegate_task`, one per runner entry, each with `mode: "async"`. T3 child agents get only the brief, never the parent's context, so every brief stands alone: the task, the path to the shared grounding, its own output path, and instructions to produce both the artifact and a short rationale. Each is a leaf brief per p3-mode's Skill delivery, or the closed template brief a caller supplies, such as **architect** runners.

Each rationale names the alternatives the candidate considered and what it rejected.

Collect the candidates on T3's completion wakes (p3-mode's Waiting on delegates). If a candidate fails to produce output, proceed with N-1 and note the dropout in the synthesis record.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one delegate from the resolved `arena cross-judge pool` role. Prefer one whose `runsOn` provider differs from the parent's. Spawn one judge with `delegate_task` on that model. The brief says read-only: inspect only, no writes. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves. Don't spawn the judge while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking.

Score each candidate against the rubric criterion by criterion, not on holistic feel. Compare against the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base on which candidate a future maintainer can extend most easily without breaking invariants. Prefer the cleaner boundary or smaller API when two feel tied, per the Laziness Protocol.

Record the pick and the reason in a short synthesis note alongside the base artifact, including the cross-judge's verdict.

## Phase E: Graft

Walk each losing candidate once more and identify what is worth porting into the base. The signal is usually one or two things per candidate, not most of it.

Fold each graft in by hand, per the **redesign-from-first-principles** principle skill. Don't paste mechanically. The result has to remain coherent under one mental model.

Record what was grafted, from which candidate, and what was rejected and why.

When N candidates converge on the same shape, that is a strong agreement signal. Note the convergence in the record and ship the consensus shape. No graft is needed. When N candidates wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

The synthesized artifact has to hold up under the same scrutiny as any other output, per the **prove-it-works** principle skill.

If verification surfaces a problem the arena did not catch, either Phase A was wrong (re-frame and re-run) or one candidate caught it and you missed the graft (go back to Phase E). Don't paper over.

## Outputs

One synthesized artifact. One short synthesis note alongside, naming the base, the grafts (with source candidate), the rejections, the dropouts if any, and the verification result.
