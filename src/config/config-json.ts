export function parseConfigJson(raw: string, options: { errorPrefix: string }): unknown {
  try {
    return JSON.parse(stripUtf8Bom(raw)) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${options.errorPrefix}\nMalformed JSON: ${message}`);
  }
}

function stripUtf8Bom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}
