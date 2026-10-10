import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const appDir = join(root, "app");

export interface BundleFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly content: string;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** Every file under app/, exactly what a directory deploy sends. */
export const bundleFiles = (): BundleFile[] =>
  walk(appDir)
    .map((absolute) => {
      const buffer = readFileSync(absolute);
      return {
        path: relative(appDir, absolute).split(sep).join("/"),
        bytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        content: buffer.toString("utf8"),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

const allowedTop = new Set(["index.ts", "package.json", "LICENSE", "NOTICE.md", "lib", "migrations", "skills"]);
const allowedExtension = /\.(ts|json|sql|md|tsv|sh)$/;
const secretPatterns: readonly [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
];
const skillLimits = { files: 1000, fileBytes: 2_000_000, totalBytes: 20_000_000 };

/** Deployability rules for app/. Each violation names the file and the rule. */
export const auditBundle = (files: readonly BundleFile[] = bundleFiles()): string[] => {
  const violations: string[] = [];
  for (const file of files) {
    const top = file.path.split("/")[0]!;
    if (!allowedTop.has(top)) violations.push(`${file.path}: not part of the deployable app (allowed: ${[...allowedTop].join(", ")})`);
    if (file.path !== "LICENSE" && !allowedExtension.test(file.path)) violations.push(`${file.path}: unexpected file type`);
    if (/(^|\/)(node_modules|\.git|dist|build|coverage|test|tests|__tests__)(\/|$)/.test(file.path)) violations.push(`${file.path}: development or build artifact`);
    if (/\.(test|spec)\.ts$|(^|\/)\.DS_Store$|(^|\/)\.env|\.map$|\.tgz$/.test(file.path)) violations.push(`${file.path}: development artifact`);
    if (/(^|\/)(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|tsconfig\.json)$/.test(file.path)) violations.push(`${file.path}: lockfile or build config does not ship`);
    if (Buffer.from(file.content, "utf8").length !== file.bytes) violations.push(`${file.path}: not valid UTF-8 text`);
    for (const [label, pattern] of secretPatterns) {
      if (pattern.test(file.content)) violations.push(`${file.path}: looks like it contains a ${label}`);
    }
  }

  const manifest = files.find((file) => file.path === "package.json");
  if (manifest === undefined) violations.push("package.json: missing");
  else {
    const pkg = JSON.parse(manifest.content) as Record<string, unknown>;
    const devPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    const deps = (pkg["dependencies"] ?? {}) as Record<string, string>;
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(deps["apps"] ?? "")) violations.push("package.json: apps must be pinned to an exact version");
    if (deps["apps"] !== devPkg.devDependencies["apps"]) violations.push(`package.json: apps ${deps["apps"]} differs from the version typechecked and tested (${devPkg.devDependencies["apps"]})`);
    const extra = Object.keys(deps).filter((name) => name !== "apps");
    if (extra.length > 0) violations.push(`package.json: unexpected dependencies ${extra.join(", ")}`);
    for (const key of ["devDependencies", "scripts", "workspaces"]) {
      if (key in pkg) violations.push(`package.json: "${key}" does not belong in the deployed manifest`);
    }
  }
  for (const required of ["index.ts", "LICENSE", "NOTICE.md", "migrations/0001_model_config.sql", "migrations/0002_revision_clock.sql"]) {
    if (!files.some((file) => file.path === required)) violations.push(`${required}: missing`);
  }

  const skillFiles = files.filter((file) => file.path.startsWith("skills/"));
  const skillBytes = skillFiles.reduce((sum, file) => sum + file.bytes, 0);
  if (skillFiles.length > skillLimits.files) violations.push(`skills/: ${skillFiles.length} files exceeds ${skillLimits.files}`);
  if (skillBytes > skillLimits.totalBytes) violations.push(`skills/: ${skillBytes} bytes exceeds ${skillLimits.totalBytes}`);
  for (const file of skillFiles) {
    if (file.bytes > skillLimits.fileBytes) violations.push(`${file.path}: ${file.bytes} bytes exceeds ${skillLimits.fileBytes}`);
  }
  return violations;
};

/** Counts by top-level entry and skill, for the inventory report. */
export const inventory = (files: readonly BundleFile[]) => {
  const groups = new Map<string, { files: number; bytes: number }>();
  for (const file of files) {
    const parts = file.path.split("/");
    const key = parts[0] === "skills" ? `skills/${parts[1]}/` : parts.length > 1 ? `${parts[0]}/` : parts[0]!;
    const group = groups.get(key) ?? { files: 0, bytes: 0 };
    groups.set(key, { files: group.files + 1, bytes: group.bytes + file.bytes });
  }
  return {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    groups: [...groups.entries()].map(([path, group]) => ({ path, ...group })),
  };
};
