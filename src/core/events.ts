type Handler<T> = (payload: T) => void;

/* eslint-disable @typescript-eslint/no-explicit-any */
export class Emitter<Events extends object> {
  private handlers = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(key: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(fn as Handler<any>);
    return () => set!.delete(fn as Handler<any>);
  }

  emit<K extends keyof Events>(key: K, payload: Events[K]): void {
    const set = this.handlers.get(key);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
