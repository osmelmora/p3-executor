/**
 * The local-install target. `app/skills/` is the single source, written for delivery through the Executor
 * app. This module renders the copy that installs as skill directories on disk: the source with the
 * replacements in `local/overlay.md` applied, plus the local `p3` entry skill from `local/p3/`.
 *
 * Runs on Node's built-in type stripping, so it needs no dependencies and no `pnpm install`.
 */
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
const sourceDir = join(root, "app", "skills");
const localDir = join(root, "local");

export const entrySkill = "p3";
export const manifestName = ".p3-install.json";

/** One rendered file. `path` is `<skill>/<path inside the skill>`. */
export interface LocalFile {
  readonly path: string;
  readonly content: string;
  readonly mode: number;
}

export interface Replacement {
  readonly file: string;
  readonly executor: string;
  readonly local: string;
}

export interface Manifest {
  readonly version: string;
  readonly mode: "full" | "standalone";
  readonly upstream: string;
  readonly skills: readonly string[];
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const filesUnder = (dir: string, prefix = ""): LocalFile[] =>
  walk(dir)
    .filter((path) => !path.endsWith(".DS_Store"))
    .map((path) => ({
      path: prefix + relative(dir, path).split(sep).join("/"),
      content: readFileSync(path, "utf8"),
      mode: statSync(path).mode & 0o777,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

export const sourceFiles = (): LocalFile[] => filesUnder(sourceDir);

/** The replacements in `local/overlay.md`: a `## <file>` heading, then `@@ executor` / `@@ local` / `@@ end` blocks. */
export const parseOverlay = (text: string = readFileSync(join(localDir, "overlay.md"), "utf8")): Replacement[] => {
  const replacements: Replacement[] = [];
  let file: string | undefined;
  let side: "executor" | "local" | undefined;
  let executor: string[] = [];
  let local: string[] = [];
  text.split("\n").forEach((line, index) => {
    const where = `overlay.md:${index + 1}`;
    if (side === undefined) {
      if (line.startsWith("## ")) file = line.slice(3).trim();
      else if (line === "@@ executor") {
        if (file === undefined) throw new Error(`${where}: a block needs a "## <file>" heading before it`);
        side = "executor";
        executor = [];
        local = [];
      } else if (line.startsWith("@@ ")) throw new Error(`${where}: "${line}" outside a block`);
    } else if (line === "@@ local" && side === "executor") side = "local";
    else if (line === "@@ end" && side === "local") {
      replacements.push({ file: file!, executor: executor.join("\n"), local: local.join("\n") });
      side = undefined;
    } else if (line.startsWith("@@ ")) throw new Error(`${where}: "${line}" is out of order`);
    else (side === "executor" ? executor : local).push(line);
  });
  if (side !== undefined) throw new Error("overlay.md: the last block has no @@ end");
  return replacements;
};

/** The local-install files: every source skill with the overlay applied, and the local entry skill. */
export const renderLocal = (
  source: readonly LocalFile[] = sourceFiles(),
  overlay: readonly Replacement[] = parseOverlay(),
): LocalFile[] => {
  const rendered = new Map(source.map((file) => [file.path, file]));
  for (const { file, executor, local } of overlay) {
    const target = rendered.get(file);
    if (target === undefined) throw new Error(`overlay: ${file} is not a file under app/skills/`);
    const matches = target.content.split(executor).length - 1;
    if (matches !== 1) {
      throw new Error(`overlay: ${file} has ${matches} matches, expected 1, for: ${executor.slice(0, 90)}`);
    }
    rendered.set(file, { ...target, content: target.content.replace(executor, () => local) });
  }
  if (skillNames([...rendered.values()]).includes(entrySkill)) {
    throw new Error(`app/skills/${entrySkill} collides with the local entry skill`);
  }
  for (const file of filesUnder(join(localDir, entrySkill), `${entrySkill}/`)) rendered.set(file.path, file);
  for (const file of modelCommandFiles()) rendered.set(file.path, file);
  return [...rendered.values()].sort((a, b) => a.path.localeCompare(b.path));
};

/** Where the model command lives in the install, and the app modules it runs. */
export const modelCommandDir = "p3-mode/scripts";
const sharedModules = ["model-config.ts", "service.ts"];

/**
 * The model command: `local/models/` plus the storage-independent modules from `app/lib/`, with import
 * paths rewritten so the copy runs under Node's type stripping from inside the install.
 */
const modelCommandFiles = (): LocalFile[] => {
  const libDir = join(root, "app", "lib");
  const shared = sharedModules.map((name): LocalFile => {
    const content = readFileSync(join(libDir, name), "utf8");
    for (const match of content.matchAll(/from "([^"]+)"/g)) {
      if (!sharedModules.includes(match[1]!.replace(/^\.\//, "").replace(/\.js$/, ".ts"))) {
        throw new Error(`app/lib/${name} imports ${match[1]}, which the on-disk install does not ship`);
      }
    }
    return { path: `${modelCommandDir}/lib/${name}`, content: content.replace(/(from "\.\/[^"]+)\.js"/g, '$1.ts"'), mode: 0o644 };
  });
  const command = filesUnder(join(localDir, "models"), `${modelCommandDir}/`).map((file) => ({
    ...file,
    content: file.content.replaceAll('"../../app/lib/', '"./lib/'),
  }));
  return [...command, ...shared];
};

export const skillNames = (files: readonly LocalFile[]): string[] =>
  [...new Set(files.map((file) => file.path.split("/")[0]!))].sort();

const skillText = (files: readonly LocalFile[], skill: string): string =>
  files
    .filter((file) => file.path.startsWith(`${skill}/`) && file.path.endsWith(".md"))
    .map((file) => file.content)
    .join("\n");

/** Text that only works with the p3 router, its Executor model tools, or T3 delegation. */
export const routerDependent = /Executor|p3-mode|setup-p3|\$p3\b|\bmodels\.[a-z]+|\bP3_[A-Z]+|delegate_task/;

/** The skills a skill's text names in bold: `**how**`, or `**prove-it-works**` for `principle-prove-it-works`. */
export const namedSkills = (files: readonly LocalFile[], skill: string): string[] => {
  const names = new Set(skillNames(files));
  const found = new Set<string>();
  for (const match of skillText(files, skill).matchAll(/\*\*([a-z0-9-]+)\*\*/g)) {
    for (const name of [match[1]!, `principle-${match[1]}`]) if (names.has(name) && name !== skill) found.add(name);
  }
  return [...found].sort();
};

/**
 * Skills that work alone: no router, no Executor, no delegation, and every skill they name is in the set
 * too. These install with nothing else set up.
 */
export const standaloneSkills = (files: readonly LocalFile[]): string[] => {
  const set = new Set(
    skillNames(files).filter((skill) => skill !== entrySkill && !routerDependent.test(skillText(files, skill))),
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (const skill of set) {
      if (namedSkills(files, skill).some((name) => !set.has(name))) {
        set.delete(skill);
        changed = true;
      }
    }
  }
  return [...set].sort();
};

/** A short content hash of the rendered files, so an agent can tell one install from the next. */
export const versionOf = (files: readonly LocalFile[]): string => {
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file.path}\0${file.content}\0`);
  return hash.digest("hex").slice(0, 12);
};

export interface Selection {
  readonly manifest: Manifest;
  readonly files: readonly LocalFile[];
}

export const select = (mode: Manifest["mode"], files: readonly LocalFile[] = renderLocal()): Selection => {
  const skills = mode === "full" ? skillNames(files) : standaloneSkills(files);
  const picked = files.filter((file) => skills.includes(file.path.split("/")[0]!));
  const upstream = (JSON.parse(readFileSync(join(root, "UPSTREAM.json"), "utf8")) as { commit: string }).commit;
  return { manifest: { version: versionOf(picked), mode, upstream, skills }, files: picked };
};

const exists = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined;

const validName = (name: unknown): name is string => typeof name === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);

/** The manifest a previous install left in a skills directory, or undefined when there is none. */
export const readManifest = (dest: string): Manifest | undefined => {
  const path = join(dest, manifestName);
  if (!exists(path)) return undefined;
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  if (!Array.isArray(manifest.skills) || !manifest.skills.every(validName)) {
    throw new Error(`${path}: not a p3 install manifest`);
  }
  return manifest;
};

export interface InstallPlan {
  readonly dest: string;
  /** Skills in the selection that already exist in `dest` and that no earlier p3 install put there. */
  readonly conflicts: readonly string[];
  /** Skills an earlier p3 install put there that the selection no longer has. */
  readonly stale: readonly string[];
  readonly unchanged: boolean;
}

export const planInstall = (dest: string, selection: Selection): InstallPlan => {
  const previous = readManifest(dest);
  const owned = new Set(previous?.skills ?? []);
  const wanted = new Set(selection.manifest.skills);
  return {
    dest,
    conflicts: selection.manifest.skills.filter((name) => !owned.has(name) && exists(join(dest, name))),
    stale: [...owned].filter((name) => !wanted.has(name)),
    unchanged:
      previous?.version === selection.manifest.version &&
      previous.mode === selection.manifest.mode &&
      selection.manifest.skills.every((name) => exists(join(dest, name))),
  };
};

/**
 * Writes the selection into `dest`. Replaces only directories a p3 install owns, unless `force` is set.
 * Without `force`, a conflict throws before anything is written.
 */
export const install = (dest: string, selection: Selection, options: { force?: boolean } = {}): InstallPlan => {
  const plan = planInstall(dest, selection);
  if (plan.conflicts.length > 0 && !options.force) {
    throw new Error(`${dest}: not installed by p3, so left alone: ${plan.conflicts.join(", ")}`);
  }
  mkdirSync(dest, { recursive: true });
  for (const name of [...plan.stale, ...selection.manifest.skills]) rmSync(join(dest, name), { recursive: true, force: true });
  for (const file of selection.files) {
    const path = join(dest, ...file.path.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
    chmodSync(path, file.mode);
  }
  writeFileSync(join(dest, manifestName), `${JSON.stringify(selection.manifest, null, 2)}\n`);
  return plan;
};

/** Removes what the manifest in `dest` lists, and the manifest. Returns the removed skill names. */
export const uninstall = (dest: string): string[] => {
  const previous = readManifest(dest);
  if (previous === undefined) return [];
  for (const name of previous.skills) rmSync(join(dest, name), { recursive: true, force: true });
  rmSync(join(dest, manifestName));
  return [...previous.skills];
};
