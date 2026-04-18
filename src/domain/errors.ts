export class ConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationError";
  }
}

export class PluginNotFoundError extends Error {
  readonly pluginId: string;

  constructor(pluginId: string, knownPluginIds: string[] = [], options?: ErrorOptions) {
    super(
      `Plugin "${pluginId}" was not found.` +
        (knownPluginIds.length > 0
          ? ` Known plugins: ${knownPluginIds.map((id) => `"${id}"`).join(", ")}.`
          : ""),
      options,
    );
    this.name = "PluginNotFoundError";
    this.pluginId = pluginId;
  }
}

export class PluginAlreadyConfiguredError extends Error {
  readonly pluginId: string;

  constructor(pluginId: string, options?: ErrorOptions) {
    super(
      `Plugin "${pluginId}" is already configured.\nRe-run with --services-only to reinstall plugin services.`,
      options,
    );
    this.name = "PluginAlreadyConfiguredError";
    this.pluginId = pluginId;
  }
}

export class PluginNotConfiguredError extends Error {
  readonly pluginId: string;

  constructor(pluginId: string, options?: ErrorOptions) {
    super(`Plugin "${pluginId}" is not configured.`, options);
    this.name = "PluginNotConfiguredError";
    this.pluginId = pluginId;
  }
}

export class MissingPluginPackagePathError extends Error {
  readonly pluginId: string;

  constructor(pluginId: string, options?: ErrorOptions) {
    super(`Plugin "${pluginId}" does not have a package path in the config.`, options);
    this.name = "MissingPluginPackagePathError";
    this.pluginId = pluginId;
  }
}

export class ConfigAlreadyExistsError extends Error {
  readonly configPath: string;

  constructor(configPath: string, options?: ErrorOptions) {
    super(`Config file already exists: ${configPath}\nRe-run with --force to overwrite.`, options);
    this.name = "ConfigAlreadyExistsError";
    this.configPath = configPath;
  }
}

export class UnsupportedPlatformError extends Error {
  readonly platform: string;

  constructor(platform: string, options?: ErrorOptions) {
    super(`Service installation is not supported on platform: ${platform}`, options);
    this.name = "UnsupportedPlatformError";
    this.platform = platform;
  }
}

export class TransportResolutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransportResolutionError";
  }
}

export class RuntimeStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeStateError";
  }
}
