type Handler<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Set<Handler<Events[K]>> } = {};

  on<K extends keyof Events>(key: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers[key];
    if (!set) {
      set = new Set();
      this.handlers[key] = set;
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof Events>(key: K, payload: Events[K]): void {
    const set = this.handlers[key];
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers = {};
  }
}
