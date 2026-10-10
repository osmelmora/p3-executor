import { auditBundle, bundleFiles, inventory } from "./bundle.ts";

const files = bundleFiles();
const violations = auditBundle(files);
const report = inventory(files);

console.log(`app/: ${report.files} files, ${report.bytes} bytes`);
for (const group of report.groups) console.log(`  ${group.path.padEnd(58)} ${String(group.files).padStart(4)} files ${String(group.bytes).padStart(8)} bytes`);
if (process.argv.includes("--list")) for (const file of files) console.log(`${file.sha256.slice(0, 12)} ${String(file.bytes).padStart(7)} ${file.path}`);

if (violations.length > 0) {
  console.error(`\n${violations.length} bundle violation(s):`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log("\nbundle ok: deployable files only, apps pinned to the tested version, skill limits respected");
