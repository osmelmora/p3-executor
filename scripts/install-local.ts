/**
 * Installs p3 as skill directories on disk, instead of reading its skills from the Executor app.
 *
 *   node scripts/install-local.ts                       # every skill, into ~/.claude/skills and ~/.agents/skills
 *   node scripts/install-local.ts --standalone          # only the skills that need no router and no Executor
 *   node scripts/install-local.ts --project <repo>      # into <repo>/.claude/skills and <repo>/.agents/skills
 *   node scripts/install-local.ts --uninstall           # remove what an earlier install put there
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { install, manifestName, planInstall, readManifest, select, uninstall } from "./local-target.ts";

const usage = `Usage: node scripts/install-local.ts [options]

Where to install (default: your home directory, for both Claude and Codex)
  --project <dir>   install into <dir>/.claude/skills and <dir>/.agents/skills
  --claude          only the Claude skills directory (.claude/skills)
  --codex           only the Codex skills directory (.agents/skills)
  --dir <dir>       install into exactly this skills directory; repeatable

What to install (default: every p3 skill and the $p3 entry point)
  --standalone      only the skills that need no p3 router, no Executor, and no delegation

Other
  --force           replace skill directories that p3 did not install
  --uninstall       remove the skills an earlier install put there
  --dry-run         print what would change and write nothing
  --list            print the skills in the selection and exit
`;

const args = process.argv.slice(2);
const flags = new Set<string>();
const dirs: string[] = [];
let project: string | undefined;
for (let index = 0; index < args.length; index++) {
  const arg = args[index]!;
  if (arg === "--dir" || arg === "--project") {
    const value = args[++index];
    if (value === undefined) fail(`${arg} needs a directory`);
    if (arg === "--dir") dirs.push(resolve(value));
    else project = resolve(value);
  } else if (["--claude", "--codex", "--standalone", "--force", "--uninstall", "--dry-run", "--list", "--help"].includes(arg)) {
    flags.add(arg);
  } else fail(`unknown option ${arg}`);
}

function fail(message: string): never {
  console.error(`${message}\n\n${usage}`);
  process.exit(2);
}

if (flags.has("--help")) {
  console.log(usage);
  process.exit(0);
}

const base = project ?? homedir();
const providers = [
  ...(flags.has("--claude") || !flags.has("--codex") ? [join(base, ".claude", "skills")] : []),
  ...(flags.has("--codex") || !flags.has("--claude") ? [join(base, ".agents", "skills")] : []),
];
if (dirs.length > 0 && (project !== undefined || flags.has("--claude") || flags.has("--codex"))) {
  fail("--dir cannot be combined with --project, --claude, or --codex");
}
const destinations = dirs.length > 0 ? dirs : providers;
const dryRun = flags.has("--dry-run");

if (flags.has("--uninstall")) {
  for (const dest of destinations) {
    const owned = readManifest(dest)?.skills ?? [];
    if (!dryRun) uninstall(dest);
    console.log(`${dest}: ${dryRun ? "would remove" : "removed"} ${owned.length} p3 skills${owned.length === 0 ? ` (no ${manifestName})` : ""}`);
  }
  process.exit(0);
}

const selection = select(flags.has("--standalone") ? "standalone" : "full");
if (flags.has("--list")) {
  console.log(selection.manifest.skills.join("\n"));
  process.exit(0);
}

const plans = destinations.map((dest) => planInstall(dest, selection));
const blocked = plans.filter((plan) => plan.conflicts.length > 0);
if (blocked.length > 0 && !flags.has("--force")) {
  console.error("These skill directories already exist and were not installed by p3, so nothing was written:");
  for (const plan of blocked) console.error(`  ${plan.dest}: ${plan.conflicts.join(", ")}`);
  console.error("\nRemove or rename them, or pass --force to replace them with the p3 skills of the same name.");
  process.exit(1);
}

for (const plan of plans) {
  if (!dryRun) install(plan.dest, selection, { force: flags.has("--force") });
  const notes = [
    plan.conflicts.length > 0 ? `replaced ${plan.conflicts.join(", ")}` : "",
    plan.stale.length > 0 ? `removed ${plan.stale.join(", ")}` : "",
    plan.unchanged ? "already at this version" : "",
  ].filter(Boolean);
  console.log(
    `${plan.dest}: ${dryRun ? "would install" : "installed"} ${selection.manifest.skills.length} skills, version ${selection.manifest.version}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`,
  );
}

if (selection.manifest.mode === "full") {
  console.log("\nNext: restart the agent session, then start a task with $p3. Model choices stay in the p3 Executor app,");
  console.log("so Executor must be connected for each provider and the app deployed (README, Install steps 1 and 2).");
} else {
  console.log("\nNext: restart the agent session. These skills need no Executor and no $p3 entry point.");
}
