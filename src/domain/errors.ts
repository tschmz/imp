export class ConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationError";
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
