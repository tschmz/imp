import type { OutgoingMessage } from "../domain/message.js";

export interface EndpointDeliveryTarget {
  conversationId: string;
  userId?: string;
}

export interface EndpointDeliveryRequest {
  endpointId: string;
  target: EndpointDeliveryTarget;
  message: OutgoingMessage;
}

export interface EndpointDeliveryAdapter {
  deliver(request: EndpointDeliveryRequest): Promise<void>;
}

export interface DeliveryRouter {
  register(endpointId: string, adapter: EndpointDeliveryAdapter): () => void;
  deliver(request: EndpointDeliveryRequest): Promise<void>;
}

export function createDeliveryRouter(): DeliveryRouter {
  const adapters = new Map<string, EndpointDeliveryAdapter>();

  return {
    register(endpointId, adapter) {
      adapters.set(endpointId, adapter);

      return () => {
        if (adapters.get(endpointId) === adapter) {
          adapters.delete(endpointId);
        }
      };
    },
    async deliver(request) {
      const adapter = adapters.get(request.endpointId);
      if (!adapter) {
        throw new Error(`Endpoint "${request.endpointId}" is not available for response delivery.`);
      }

      await adapter.deliver(request);
    },
  };
}
