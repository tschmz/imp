import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveInstalledPackageRoot } from "./plugin-package-installer.js";

const createdDirs: string[] = [];

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("resolveInstalledPackageRoot", () => {
  it("resolves git/url installs using npm ls candidates", async () => {
    const storeRoot = await createStoreRoot();
    await writePackage(storeRoot, "@tschmz/imp-voice", true);

    const packageRoot = await resolveInstalledPackageRoot({
      packageSpec: "github:tschmz/imp-voice",
      storeRoot,
      candidatePackageNames: ["@tschmz/imp-voice"],
    });

    expect(packageRoot).toBe(join(storeRoot, "node_modules", "@tschmz", "imp-voice"));
  });

  it("resolves tarball specs with querystrings without URL substring heuristics", async () => {
    const storeRoot = await createStoreRoot();
    await writePackage(storeRoot, "imp-voice", true);

    const packageRoot = await resolveInstalledPackageRoot({
      packageSpec: "https://registry.example.test/imp-voice-0.1.0.tgz?sig=abc123",
      storeRoot,
      candidatePackageNames: ["imp-voice"],
    });

    expect(packageRoot).toBe(join(storeRoot, "node_modules", "imp-voice"));
  });

  it("fails on multiple matching plugin candidates", async () => {
    const storeRoot = await createStoreRoot();
    await writePackage(storeRoot, "imp-voice", true);
    await writePackage(storeRoot, "imp-voice-next", true);

    await expect(
      resolveInstalledPackageRoot({
        packageSpec: "https://registry.example.test/imp-voice-0.1.0.tgz?token=1",
        storeRoot,
        candidatePackageNames: ["imp-voice", "imp-voice-next"],
      }),
    ).rejects.toThrow('multiple plugin packages matched');
  });
});

async function createStoreRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "imp-plugin-package-installer-test-"));
  createdDirs.push(root);
  await mkdir(join(root, "node_modules"), { recursive: true });
  return root;
}

async function writePackage(storeRoot: string, packageName: string, withPluginManifest: boolean): Promise<void> {
  const packageRoot = join(storeRoot, "node_modules", ...packageName.split("/"));
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: packageName }, null, 2)}\n`, "utf8");
  if (withPluginManifest) {
    await writeFile(
      join(packageRoot, "plugin.json"),
      `${JSON.stringify({ schemaVersion: 1, id: packageName, name: packageName, version: "0.1.0" }, null, 2)}\n`,
      "utf8",
    );
  }
}
