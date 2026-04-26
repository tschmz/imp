import { describe, expect, it, vi } from "vitest";
import { createAppConfigJsonSchema, createConfigSchemaUseCase } from "./config-schema-use-case.js";

describe("createConfigSchemaUseCase", () => {
  it("prints the Imp config JSON Schema", async () => {
    const writeOutput = vi.fn();

    await createConfigSchemaUseCase({ writeOutput })();

    expect(writeOutput).toHaveBeenCalledTimes(1);
    const output = writeOutput.mock.calls[0]?.[0] as string;
    const schema = JSON.parse(output) as Record<string, unknown>;
    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Imp config",
      type: "object",
      properties: {
        agents: {
          type: "array",
        },
        endpoints: {
          type: "array",
        },
      },
    });
  });
});

describe("createAppConfigJsonSchema", () => {
  it("describes the top-level config shape", () => {
    const schema = createAppConfigJsonSchema();

    expect(schema).toMatchObject({
      required: ["instance", "paths", "defaults", "agents", "endpoints"],
      properties: {
        instance: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
          },
        },
        tools: {
          type: "object",
          properties: {
            mcp: {
              type: "object",
            },
          },
        },
      },
    });
  });
});
