import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizePackageSpec,
  repairMissingLocalDependencySpecs,
  resolveInstalledPackageRoot,
  selectCandidatePackageNames,
} from "./plugin-package-installer.js";

const createdDirs: string[] = [];

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("selectCandidatePackageNames", () => {
  it("prefers dependency names whose declared spec matches the requested package", () => {
    expect(
      selectCandidatePackageNames({
        packageSpec: "github:tschmz/imp-voice#main",
        declaredBefore: {
          "imp-other": "^1.0.0",
          "imp-voice": "github:tschmz/imp-voice#old",
        },
        declaredAfter: {
          "imp-other": "^1.0.0",
          "imp-voice": "github:tschmz/imp-voice#main",
        },
      }),
    ).toEqual(["imp-voice"]);
  });

  it("falls back to changed dependency names when npm normalizes the stored spec", () => {
    expect(
      selectCandidatePackageNames({
        packageSpec: "github:tschmz/imp-voice#main",
        declaredBefore: {
          "imp-other": "^1.0.0",
          "imp-voice": "github:tschmz/imp-voice#old",
        },
        declaredAfter: {
          "imp-other": "^1.0.0",
          "imp-voice": "git+ssh://git@github.com/tschmz/imp-voice.git#main",
        },
      }),
    ).toEqual(["imp-voice"]);
  });
});

describe("normalizePackageSpec", () => {
  it("uses the latest tag for bare registry package specs", () => {
    expect(normalizePackageSpec("@tschmz/imp-agents")).toBe("@tschmz/imp-agents@latest");
    expect(normalizePackageSpec("imp-agents")).toBe("imp-agents@latest");
    expect(normalizePackageSpec("npm:@tschmz/imp-agents")).toBe("@tschmz/imp-agents@latest");
    expect(normalizePackageSpec("imp-pack@npm:@tschmz/imp-agents")).toBe(
      "imp-pack@npm:@tschmz/imp-agents@latest",
    );
  });

  it("preserves explicit registry, git, and file specs", () => {
    expect(normalizePackageSpec("@tschmz/imp-agents@0.1.2")).toBe("@tschmz/imp-agents@0.1.2");
    expect(normalizePackageSpec("@tschmz/imp-agents@next")).toBe("@tschmz/imp-agents@next");
    expect(normalizePackageSpec("github:tschmz/imp-agents")).toBe("github:tschmz/imp-agents");
    expect(normalizePackageSpec("./tschmz-imp-agents-0.1.2.tgz")).toBe("./tschmz-imp-agents-0.1.2.tgz");
  });
});

describe("repairMissingLocalDependencySpecs", () => {
  it("replaces missing file dependencies with installed package versions", async () => {
    const storeRoot = await createStoreRoot();
    await writeFile(
      join(storeRoot, "package.json"),
      `${JSON.stringify(
        {
          private: true,
          dependencies: {
            "@tschmz/imp-agents": "file:../../../Workspace/imp/plugins/imp-agents/tschmz-imp-agents-0.1.2.tgz",
            "@tschmz/imp-phone": "file:../../../../../tmp/missing/tschmz-imp-phone-0.1.2.tgz",
            "imp-local": "file:./existing.tgz",
            "imp-missing": "file:./missing.tgz",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writePackage(storeRoot, "@tschmz/imp-agents", true, "0.1.2");
    await writePackage(storeRoot, "@tschmz/imp-phone", true, "0.1.2");
    await writeFile(join(storeRoot, "existing.tgz"), "placeholder", "utf8");

    await repairMissingLocalDependencySpecs(storeRoot);

    await expect(readPackageJson(storeRoot)).resolves.toMatchObject({
      dependencies: {
        "@tschmz/imp-agents": "0.1.2",
        "@tschmz/imp-phone": "0.1.2",
        "imp-local": "file:./existing.tgz",
      },
    });
    await expect(readPackageJson(storeRoot)).resolves.not.toHaveProperty("dependencies.imp-missing");
  });
});

describe("resolveInstalledPackageRoot", () => {
  it("resolves git/url installs using selected package candidates", async () => {
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

async function writePackage(
  storeRoot: string,
  packageName: string,
  withPluginManifest: boolean,
  version = "0.1.0",
): Promise<void> {
  const packageRoot = join(storeRoot, "node_modules", ...packageName.split("/"));
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify({ name: packageName, version }, null, 2)}\n`,
    "utf8",
  );
  if (withPluginManifest) {
    await writeFile(
      join(packageRoot, "plugin.json"),
      `${JSON.stringify({ schemaVersion: 1, id: packageName, name: packageName, version: "0.1.0" }, null, 2)}\n`,
      "utf8",
    );
  }
}

async function readPackageJson(storeRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(storeRoot, "package.json"), "utf8")) as Record<string, unknown>;
}
