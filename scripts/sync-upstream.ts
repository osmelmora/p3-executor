/**
 * Port upstream p3-stack changes into the adapted copy with per-file three-way merges:
 * base = upstream at the pinned commit, ours = app/, theirs = upstream at the target commit.
 *
 *   node --import tsx scripts/sync-upstream.ts <commit-or-ref> [--dry-run]
 *   node --import tsx scripts/sync-upstream.ts <commit> --record   # pin after resolving conflicts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { root } from "./bundle.ts";

type Upstream = {
  repository: string;
  commit: string;
  commitDate: string;
  commitSubject: string;
  pathMap: Record<string, string>;
  notShipped: string[];
  [key: string]: unknown;
};

const pinFile = join(root, "UPSTREAM.json");
const pin = JSON.parse(readFileSync(pinFile, "utf8")) as Upstream;
const checkout = join(root, ".dev", "upstream", "p3-stack");
const [target, ...flags] = process.argv.slice(2);
if (target === undefined) {
  console.error("usage: sync-upstream.ts <commit-or-ref> [--dry-run | --record]");
  process.exit(2);
}
const dryRun = flags.includes("--dry-run");
const recordOnly = flags.includes("--record");

const git = (...args: string[]) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
if (!existsSync(join(checkout, ".git"))) {
  mkdirSync(dirname(checkout), { recursive: true });
  execFileSync("git", ["clone", "--quiet", pin.repository, checkout]);
}
git("fetch", "--quiet", "origin");
const to = git("rev-parse", `${target}^{commit}`);

const record = () => {
  const next: Upstream = {
    ...pin,
    commit: to,
    commitDate: git("show", "-s", "--format=%cI", to),
    commitSubject: git("show", "-s", "--format=%s", to),
  };
  writeFileSync(pinFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`pinned ${to}`);
};
if (recordOnly) {
  record();
  process.exit(0);
}
if (to === pin.commit) {
  console.log(`already at ${to}; nothing to merge`);
  process.exit(0);
}

const show = (commit: string, path: string): string | undefined => {
  const result = spawnSync("git", ["-C", checkout, "show", `${commit}:${path}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : undefined;
};
const listed = (commit: string) => git("ls-tree", "-r", "--name-only", commit).split("\n").filter(Boolean);
const mapPath = (path: string): string | undefined => {
  for (const [from, into] of Object.entries(pin.pathMap)) {
    if (from.endsWith("/") ? path.startsWith(from) : path === from) {
      return join(root, from.endsWith("/") ? into + path.slice(from.length) : into);
    }
  }
  return undefined;
};

const paths = [...new Set([...listed(pin.commit), ...listed(to)])].sort();
const scratch = mkdtempSync(join(tmpdir(), "p3-sync-"));
const report = { merged: [] as string[], conflicted: [] as string[], added: [] as string[], removedUpstream: [] as string[], unmapped: [] as string[] };

for (const path of paths) {
  const base = show(pin.commit, path);
  const theirs = show(to, path);
  if (base === theirs) continue;
  const ours = mapPath(path);
  if (ours === undefined) {
    if (!pin.notShipped.includes(path)) report.unmapped.push(path);
    continue;
  }
  if (theirs === undefined) {
    report.removedUpstream.push(`${path} -> ${ours}`);
    continue;
  }
  if (base === undefined || !existsSync(ours)) {
    report.added.push(ours);
    if (!dryRun) {
      mkdirSync(dirname(ours), { recursive: true });
      writeFileSync(ours, theirs);
    }
    continue;
  }
  const files = ["base", "theirs"].map((name) => join(scratch, `${name}-${report.merged.length}-${report.conflicted.length}`));
  writeFileSync(files[0]!, base);
  writeFileSync(files[1]!, theirs);
  const merge = spawnSync("git", ["merge-file", "-p", "-L", "ours (adapted)", "-L", `upstream ${pin.commit.slice(0, 12)}`, "-L", `upstream ${to.slice(0, 12)}`, ours, files[0]!, files[1]!], { encoding: "utf8" });
  if (merge.status === null || merge.status < 0) throw new Error(`git merge-file failed on ${ours}`);
  (merge.status === 0 ? report.merged : report.conflicted).push(ours);
  if (!dryRun) writeFileSync(ours, merge.stdout);
}

for (const [label, list] of Object.entries(report)) {
  if (list.length > 0) console.log(`${label}:\n  ${list.join("\n  ")}`);
}
console.log(
  [
    "",
    "Next: audit every merged and added file for local-install assumptions (README Maintaining section), then run pnpm verify.",
    report.conflicted.length > 0
      ? `Resolve the conflict markers, then record the pin with: node --import tsx scripts/sync-upstream.ts ${to} --record`
      : dryRun
        ? "Dry run: nothing written."
        : "",
  ].join("\n"),
);
if (!dryRun && report.conflicted.length === 0) record();
