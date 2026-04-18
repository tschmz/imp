export interface DeferredActionController<TAction> {
  setHandler(handler: (action: TAction) => void): void;
  request(action: TAction): void;
}

export function createDeferredActionController<TAction>(): DeferredActionController<TAction> {
  let handler: ((action: TAction) => void) | undefined;
  const pending: TAction[] = [];

  return {
    setHandler(nextHandler) {
      handler = nextHandler;

      while (pending.length > 0) {
        const action = pending.shift();
        if (action === undefined) {
          break;
        }
        handler(action);
      }
    },
    request(action) {
      if (!handler) {
        pending.push(action);
        return;
      }

      handler(action);
    },
  };
}
