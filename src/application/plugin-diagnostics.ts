import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppConfig, FileEndpointConfig } from "../config/types.js";
import { resolveConfigPath as resolvePathRelativeToConfig } from "../config/secret-value.js";
import type { DiscoveredPluginManifest } from "../plugins/discovery.js";

export interface PluginDiagnosticResult {
  pluginId: string;
  ok: boolean;
  checks: PluginDiagnosticCheck[];
}

export interface PluginDiagnosticCheck {
  label: string;
  status: "ok" | "warn" | "fail";
  detail?: string;
}

export async function diagnoseConfiguredPlugin(options: {
  config: AppConfig;
  configPath: string;
  pluginId: string;
  plugin?: DiscoveredPluginManifest;
  manifestError?: unknown;
}): Promise<PluginDiagnosticResult> {
  const checks: PluginDiagnosticCheck[] = [];
  const configuredPlugin = (options.config.plugins ?? []).find((plugin) => plugin.id === options.pluginId);
  if (!configuredPlugin) {
    return {
      pluginId: options.pluginId,
      ok: false,
      checks: [
        {
          label: "config entry",
          status: "fail",
          detail: `Plugin "${options.pluginId}" is not configured.`,
        },
      ],
    };
  }

  checks.push({
    label: "config entry",
    status: configuredPlugin.enabled ? "ok" : "warn",
    detail: configuredPlugin.enabled ? "enabled" : "disabled",
  });

  if (!configuredPlugin.package?.path) {
    checks.push({
      label: "package path",
      status: "fail",
      detail: "missing plugins[].package.path",
    });
  } else {
    const packagePath = resolvePathRelativeToConfig(configuredPlugin.package.path, dirname(options.configPath));
    checks.push({
      label: "package path",
      status: await pathExists(packagePath) ? "ok" : "fail",
      detail: packagePath,
    });
  }

  if (options.manifestError) {
    checks.push({
      label: "manifest",
      status: "fail",
      detail: options.manifestError instanceof Error ? options.manifestError.message : String(options.manifestError),
    });
  } else if (options.plugin) {
    checks.push({
      label: "manifest",
      status: options.plugin.manifest.id === options.pluginId ? "ok" : "fail",
      detail: `id=${options.plugin.manifest.id} version=${options.plugin.manifest.version}`,
    });
    checks.push(...await diagnoseManifestEndpoints(options.config, options.configPath, options.plugin));
  }

  return {
    pluginId: options.pluginId,
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}

async function diagnoseManifestEndpoints(
  config: AppConfig,
  configPath: string,
  plugin: DiscoveredPluginManifest,
): Promise<PluginDiagnosticCheck[]> {
  const checks: PluginDiagnosticCheck[] = [];
  const dataRoot = resolvePathRelativeToConfig(config.paths.dataRoot, dirname(configPath));

  for (const endpoint of plugin.manifest.endpoints ?? []) {
    const configuredEndpoint = config.endpoints.find(
      (candidate): candidate is FileEndpointConfig =>
        candidate.id === endpoint.id && candidate.type === "file",
    );
    if (!configuredEndpoint) {
      checks.push({
        label: `endpoint ${endpoint.id}`,
        status: "fail",
        detail: "missing configured file endpoint",
      });
      continue;
    }

    const endpointOk = configuredEndpoint.pluginId === plugin.manifest.id;
    checks.push({
      label: `endpoint ${endpoint.id}`,
      status: endpointOk ? "ok" : "fail",
      detail: endpointOk ? "configured" : `pluginId=${configuredEndpoint.pluginId}`,
    });

    const runtimeDir = join(dataRoot, "runtime", "plugins", plugin.manifest.id, "endpoints", endpoint.id);
    checks.push({
      label: `runtime ${endpoint.id}`,
      status: await pathExists(runtimeDir) ? "ok" : "warn",
      detail: runtimeDir,
    });
  }

  if (!plugin.manifest.endpoints?.length) {
    checks.push({
      label: "endpoints",
      status: "ok",
      detail: "no endpoint defaults declared",
    });
  }

  return checks;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function renderPluginDiagnostic(result: PluginDiagnosticResult): string {
  const lines = [`Plugin ${result.pluginId}: ${result.ok ? "ok" : "issues found"}`];
  for (const check of result.checks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.label}${check.detail ? `: ${check.detail}` : ""}`);
  }
  return lines.join("\n");
}
