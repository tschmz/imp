export interface ServiceInstaller {
  run(command: string, args: string[]): Promise<void>;
  runAndCapture?(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

export function createSystemServiceInstaller(): ServiceInstaller {
  return {
    async run(command: string, args: string[]) {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync(command, args, {
        env: process.env,
      });
    },
    async runAndCapture(command: string, args: string[]) {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      try {
        const result = await execFileAsync(command, args, {
          env: process.env,
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          "stdout" in error &&
          "stderr" in error &&
          typeof error.stdout === "string" &&
          typeof error.stderr === "string"
        ) {
          return {
            stdout: error.stdout,
            stderr: error.stderr,
          };
        }

        throw error;
      }
    },
  };
}
