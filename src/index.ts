export { createDaemon } from "./daemon/create-daemon.js";
export type { Daemon, DaemonConfig } from "./daemon/types.js";
export { discoverPluginManifests, readPluginManifest } from "./plugins/discovery.js";
export {
  PLUGIN_MANIFEST_FILE,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  pluginManifestSchema,
} from "./plugins/manifest.js";
export type {
  DiscoveredPluginManifest,
  PluginDiscoveryIssue,
  PluginDiscoveryResult,
} from "./plugins/discovery.js";
export type {
  PluginCapability,
  PluginEndpointManifest,
  PluginInitManifest,
  PluginManifest,
  PluginAgentManifest,
  PluginCommandToolRunnerManifest,
  PluginMcpServerManifest,
  PluginPythonSetupManifest,
  PluginServiceManifest,
  PluginSetupManifest,
} from "./plugins/manifest.js";

export type {
  JsPluginInitializer,
  JsPluginRegistration,
  JsPluginRuntimeConfig,
  JsPluginToolDefinition,
  PluginRuntimeContext,
} from "./runtime/js-plugin.js";
export type { ToolDefinition } from "./tools/types.js";
