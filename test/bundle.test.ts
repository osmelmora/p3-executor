import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { auditBundle, bundleFiles, root } from "../scripts/bundle.ts";

const readJson = <T>(path: string | URL): T => JSON.parse(readFileSync(path, "utf8")) as T;
const pinned = readJson<{ dependencies: Record<string, string> }>(join(root, "app", "package.json")).dependencies["apps"];
/** The `apps` the harness loads through `apps/host`, so the version these tests actually ran on. */
const tested = readJson<{ version: string }>(new URL("../package.json", import.meta.resolve("apps/host"))).version;

describe("deployable bundle", () => {
  it("ships only app source, skills, migrations, license, and notice", () => {
    assert.deepEqual(auditBundle(), []);
    const tops = new Set(bundleFiles().map((file) => file.path.split("/")[0]));
    assert.deepEqual([...tops].sort(), ["LICENSE", "NOTICE.md", "index.ts", "lib", "migrations", "package.json", "skills"]);
  });

  it("flags development artifacts, unpinned framework versions, and secrets", () => {
    const files = bundleFiles();
    const manifest = files.find((file) => file.path === "package.json")!;
    const loose = JSON.parse(manifest.content) as { dependencies: Record<string, string> };
    loose.dependencies["apps"] = `^${pinned}`;
    const tampered = [
      ...files.filter((file) => file.path !== "package.json"),
      { ...manifest, content: JSON.stringify(loose) },
      { path: "lib/model-config.test.ts", bytes: 1, sha256: "", content: "x" },
      { path: "skills/how/.DS_Store", bytes: 1, sha256: "", content: "x" },
      { path: "lib/settings.ts", bytes: 60, sha256: "", content: `const token = "ghp_${"a".repeat(36)}";` },
    ];
    const violations = auditBundle(tampered).join("\n");
    assert.match(violations, /apps must be pinned to an exact version/);
    assert.match(violations, /lib\/model-config\.test\.ts: development artifact/);
    assert.match(violations, /skills\/how\/\.DS_Store/);
    assert.match(violations, /lib\/settings\.ts: looks like it contains a GitHub token/);
  });

  it("splits into execute-sized chunks that reassemble to exactly the app files", () => {
    const out = mkdtempSync(join(tmpdir(), "p3-deploy-"));
    execFileSync(process.execPath, ["--import", "tsx", join(root, "scripts", "deploy-payload.ts"), out], {
      cwd: root,
      stdio: "pipe",
    });
    const chunkFiles = readdirSync(out).filter((name) => name.startsWith("chunk-")).sort();
    const chunks = chunkFiles.map((name) => readFileSync(join(out, name), "utf8"));
    for (const chunk of chunks) assert.ok(chunk.length <= 60_000, "chunk leaves room for its program inside the 65,536-character execute limit");
    const first = JSON.parse(chunks[0]!) as { path: string }[];
    assert.deepEqual(
      ["index.ts", "package.json"].filter((path) => first.some((file) => file.path === path)),
      ["index.ts", "package.json"],
      "the first chunk can create the app on its own",
    );
    const shipped = chunks.flatMap((chunk) => JSON.parse(chunk) as { path: string; content: string }[]);
    const expected = bundleFiles().map(({ path, content }) => ({ path, content }));
    assert.deepEqual(
      [...shipped].sort((a, b) => a.path.localeCompare(b.path)),
      expected,
    );
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as {
      appsVersion: string;
      upstream: { commit: string };
      files: { path: string; chars: number }[];
    };
    assert.equal(tested, pinned, "npm install has put the pinned apps in node_modules");
    assert.equal(manifest.appsVersion, tested, "the payload names the framework the tests ran on");
    assert.equal(manifest.upstream.commit, "09909ebb5c0125e27fad3e57d96b81e832696d69");
    assert.equal(manifest.files.length, expected.length);
  });
});
