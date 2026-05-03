import { describe, expect, it } from "vitest";
import { getValueAtKeyPath, setValueAtKeyPath } from "./config-key-path.js";

describe("getValueAtKeyPath", () => {
  it("keeps exact key paths unchanged", () => {
    expect(
      getValueAtKeyPath(
        {
          agents: [
            { id: "default", model: { modelId: "gpt-5.5" } },
            { id: "ops", model: { modelId: "gpt-5.4-mini" } },
          ],
        },
        "agents.ops.model.modelId",
      ),
    ).toBe("gpt-5.4-mini");
  });

  it("maps wildcard segments over array values", () => {
    expect(
      getValueAtKeyPath(
        {
          agents: [
            { id: "default", model: { modelId: "gpt-5.5" } },
            { id: "ops", model: { modelId: "gpt-5.4-mini" } },
          ],
        },
        "agents.*.id",
      ),
    ).toEqual(["default", "ops"]);
  });

  it("uses dotted ids for array navigation", () => {
    expect(
      getValueAtKeyPath(
        {
          agents: [
            { id: "default", name: "Default" },
            { id: "imp-agents.cody", name: "Cody" },
          ],
        },
        "agents.imp-agents.cody.name",
      ),
    ).toBe("Cody");
  });

  it("maps wildcard segments over object values", () => {
    expect(
      getValueAtKeyPath(
        {
          tools: {
            mcp: {
              serversById: {
                filesystem: { command: "npx" },
                memory: { command: "node" },
              },
            },
          },
        },
        "tools.mcp.serversById.*.command",
      ),
    ).toEqual(["npx", "node"]);
  });

  it("treats missing descendants below a wildcard as an empty selection", () => {
    expect(
      getValueAtKeyPath(
        {
          agents: [
            { id: "default", tools: { mcp: { servers: ["filesystem"] } } },
            { id: "ops" },
          ],
        },
        "agents.*.tools.mcp.servers",
      ),
    ).toEqual([["filesystem"]]);
  });

  it("updates values below array items with dotted ids", () => {
    const config = {
      agents: [
        { id: "default", name: "Default" },
        { id: "imp-agents.cody", name: "Cody" },
      ],
    };

    setValueAtKeyPath(config, "agents.imp-agents.cody.name", "Custom Cody");

    expect(config.agents[1]?.name).toBe("Custom Cody");
  });
});
