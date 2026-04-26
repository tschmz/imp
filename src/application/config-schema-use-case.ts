import { z } from "zod";
import { appConfigSchema } from "../config/schema.js";

interface ConfigSchemaUseCaseDependencies {
  writeOutput: (text: string) => void;
}

export function createConfigSchemaUseCase(
  dependencies: Partial<ConfigSchemaUseCaseDependencies> = {},
): () => Promise<void> {
  const deps: ConfigSchemaUseCaseDependencies = {
    writeOutput: console.log,
    ...dependencies,
  };

  return async () => {
    deps.writeOutput(`${JSON.stringify(createAppConfigJsonSchema(), null, 2)}\n`);
  };
}

export function createAppConfigJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(appConfigSchema, {
    target: "draft-2020-12",
    unrepresentable: "any",
    io: "input",
  }) as Record<string, unknown>;

  return {
    ...schema,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Imp config",
    description:
      "JSON Schema for Imp configuration files. Use `imp config validate` for cross-reference and secret-reference checks that JSON Schema cannot express.",
  };
}
