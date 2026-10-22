---
name: swarm
description: "Fan out N parallel workers, collect their results, and return one report. Use for 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Pick the worker model from the `swarm workers` role, resolved through `models.resolve` (p3-mode's Model configuration). An unset role runs on the parent model. For an `inheritParent` delegate, omit `target` so the workers run on the parent model. An invalid role, or a target `delegate_task` rejects, gets no substitute. Follow p3-mode's Model configuration step 6. For a model race, name each arm's model up front.
4. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one turn with `delegate_task`, `mode: "async"`, and the step 3 target, left unset for an `inheritParent` delegate. A worker that writes gets its own git worktree, named in its brief (p3-mode's Subagents section). One writer per worktree.

Every brief stands alone as a leaf brief (p3-mode's Skill delivery). Child agents get only the brief, never the parent's context. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Collect each worker's result per p3-mode's Waiting on delegates. Aggregate once every worker is terminal. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
