/**
 * Split app/ into `{ path, content }` chunks that each fit one Executor `execute` program
 * (65,536 characters of source), plus a manifest to verify the deployed source against.
 * Usage: node --import tsx scripts/deploy-payload.ts [outDir] [maxChars]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditBundle, bundleFiles, root } from "./bundle.ts";

const outDir = process.argv[2] ?? join(root, ".dev", "deploy");
const maxChars = Number(process.argv[3] ?? 60_000);

const files = bundleFiles();
const violations = auditBundle(files);
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

const core = (path: string) => !path.startsWith("skills/");
const ordered = [...files.filter((file) => core(file.path)), ...files.filter((file) => !core(file.path))];
const chunks: { path: string; content: string }[][] = [];
let current: { path: string; content: string }[] = [];
let size = 2;
for (const file of ordered) {
  const entry = { path: file.path, content: file.content };
  const cost = JSON.stringify(entry).length + 1;
  if (cost + 2 > maxChars) throw new Error(`${file.path} alone exceeds ${maxChars} characters; raise maxChars or split the file.`);
  if (size + cost > maxChars && current.length > 0) {
    chunks.push(current);
    current = [];
    size = 2;
  }
  current.push(entry);
  size += cost;
}
if (current.length > 0) chunks.push(current);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
chunks.forEach((chunk, index) => {
  writeFileSync(join(outDir, `chunk-${String(index + 1).padStart(2, "0")}.json`), JSON.stringify(chunk));
});
const upstream = JSON.parse(readFileSync(join(root, "UPSTREAM.json"), "utf8")) as Record<string, unknown>;
const appsVersion = (JSON.parse(readFileSync(join(root, "app", "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies["apps"];
writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(
    {
      appsVersion,
      upstream,
      chunks: chunks.map((chunk, index) => ({ file: `chunk-${String(index + 1).padStart(2, "0")}.json`, files: chunk.length })),
      files: files.map((file) => ({ path: file.path, bytes: file.bytes, chars: file.content.length, sha256: file.sha256 })),
    },
    null,
    2,
  ),
);
console.log(`${files.length} files in ${chunks.length} chunks (max ${maxChars} chars each) written to ${outDir}`);
