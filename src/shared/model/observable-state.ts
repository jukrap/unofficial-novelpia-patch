import { createStore, type StoreApi } from 'zustand/vanilla';

/** One store per extension context. Persistence/IPC belong to the domain owner. */
export function observableState<T>(initial: T): StoreApi<T> & { dispose(): void } {
  const store = createStore<T>(() => initial);
  const subscriptions = new Set<() => void>();
  let disposed = false;
  return {
    ...store,
    subscribe(listener) {
      if (disposed) return () => {};
      const stop = store.subscribe(listener);
      const unsubscribe = () => {
        stop();
        subscriptions.delete(unsubscribe);
      };
      subscriptions.add(unsubscribe);
      return unsubscribe;
    },
    dispose() {
      disposed = true;
      subscriptions.forEach((stop) => stop());
    },
  };
}
