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
  PluginPythonSetupManifest,
  PluginServiceManifest,
  PluginSetupManifest,
} from "./plugins/manifest.js";
