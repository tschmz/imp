import type { ServicePlatform } from "./install-plan.js";

export type ServiceOperationName =
  | "install"
  | "uninstall"
  | "start"
  | "stop"
  | "restart"
  | "status"
  | "validate"
  | "diagnose";

export interface ServiceOperationResult {
  operation: ServiceOperationName;
  platform: ServicePlatform;
  serviceName: string;
  definitionPath: string;
  statusOutput?: string;
}
