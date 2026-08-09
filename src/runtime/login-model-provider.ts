import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuthEvent, AuthPrompt, AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import writeFileAtomic from "write-file-atomic";

export interface LoginModelProviderRequest {
  provider: string;
  authFile: string;
  notify(event: AuthEvent): Promise<void> | void;
  prompt(prompt: AuthPrompt): Promise<string>;
}

export async function loginModelProvider(request: LoginModelProviderRequest): Promise<void> {
  const credentials = new JsonCredentialFileStore(request.authFile);
  const models = builtinModels({ credentials });
  await models.login(request.provider, "oauth", {
    notify: request.notify,
    prompt: request.prompt,
  });
}

class JsonCredentialFileStore implements CredentialStore {
  constructor(private readonly path: string) {}

  async read(providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
    void _options;
    return this.normalizeCredential((await this.readAll())[providerId]);
  }

  async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    void _options;
    return Object.entries(await this.readAll()).flatMap(([providerId, value]) => {
      const credential = this.normalizeCredential(value);
      return credential ? [{ providerId, type: credential.type }] : [];
    });
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
    _options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    void _options;
    const all = await this.readAll();
    const next = await update(this.normalizeCredential(all[providerId]));
    if (next) {
      all[providerId] = next;
      await this.writeAll(all);
      return next;
    }

    return this.normalizeCredential(all[providerId]);
  }

  async delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
    void _options;
    const all = await this.readAll();
    delete all[providerId];
    await this.writeAll(all);
  }

  private async readAll(): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  private async writeAll(value: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFileAtomic(this.path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
  }

  private normalizeCredential(value: unknown): Credential | undefined {
    if (typeof value !== "object" || value === null || !("type" in value)) {
      return undefined;
    }

    if (value.type === "api_key" || value.type === "oauth") {
      return value as Credential;
    }

    return undefined;
  }
}
