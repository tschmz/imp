import { describe, expect, it } from "vitest";
import {
  createServiceInstallPlan,
  detectServicePlatform,
  renderServiceDefinition,
} from "./install-plan.js";

describe("service install plan", () => {
  it("detects supported platforms", () => {
    expect(detectServicePlatform("linux")).toBe("linux-systemd-user");
    expect(detectServicePlatform("darwin")).toBe("macos-launchd-agent");
    expect(detectServicePlatform("win32")).toBe("windows-winsw");
  });

  it("creates a node-based command line for js entrypoints", () => {
    const plan = createServiceInstallPlan({
      platform: "linux",
      configPath: "/tmp/imp/config.json",
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
    });

    expect(plan.command).toBe("/usr/bin/node");
    expect(plan.args).toEqual(["/app/dist/main.js", "start", "--config", "/tmp/imp/config.json"]);
  });

  it("renders a systemd user unit", () => {
    const definition = renderServiceDefinition(
      createServiceInstallPlan({
        platform: "linux",
        configPath: "/tmp/imp/config.json",
        execPath: "/usr/bin/node",
        argv: ["/usr/bin/node", "/app/dist/main.js"],
      }),
    );

    expect(definition).toContain("[Unit]");
    expect(definition).toContain("WorkingDirectory=/tmp/imp");
    expect(definition).toContain("ExecStart=");
    expect(definition).toContain("WantedBy=default.target");
  });

  it("renders a launchd plist", () => {
    const definition = renderServiceDefinition(
      createServiceInstallPlan({
        platform: "darwin",
        configPath: "/tmp/imp/config.json",
        execPath: "/usr/bin/node",
        argv: ["/usr/bin/node", "/app/dist/main.js"],
      }),
    );

    expect(definition).toContain("<plist version=\"1.0\">");
    expect(definition).toContain("<key>ProgramArguments</key>");
    expect(definition).toContain("<key>KeepAlive</key>");
  });

  it("renders a winsw service config", () => {
    const definition = renderServiceDefinition(
      createServiceInstallPlan({
        platform: "win32",
        configPath: "C:/imp/config.json",
        execPath: "C:/Program Files/nodejs/node.exe",
        argv: ["C:/Program Files/nodejs/node.exe", "C:/app/dist/main.js"],
      }),
    );

    expect(definition).toContain("<service>");
    expect(definition).toContain("<executable>");
    expect(definition).toContain("<onfailure action=\"restart\" delay=\"5 sec\" />");
  });
});
