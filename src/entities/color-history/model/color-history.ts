import type { StoragePort } from '@/shared/platform/storage';

export const RECENT_COLORS_KEY = 'unp.recent-colors.v1';
export function recentColors(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter(
              (color): color is string => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)
            )
            .map((color) => color.toUpperCase())
        ),
      ].slice(0, 12)
    : [];
}
export class ColorHistory {
  private colors: string[] = [];
  private listeners = new Set<() => void>();
  private unlisten: (() => void) | undefined;
  private queue = Promise.resolve();
  private ready: Promise<void> = Promise.resolve();
  constructor(private storage: StoragePort) {}
  getSnapshot = () => this.colors;
  private receive = (value: unknown) => {
    const next = recentColors(value);
    if (next.join() === this.colors.join()) return;
    this.colors = next;
    this.listeners.forEach((fn) => fn());
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.unlisten) {
      this.unlisten = this.storage.listen((changes, area) => {
        if (area === 'local' && changes[RECENT_COLORS_KEY])
          this.receive(changes[RECENT_COLORS_KEY].newValue);
      });
      this.ready = this.storage.local
        .get(RECENT_COLORS_KEY)
        .then((raw) => this.receive(raw[RECENT_COLORS_KEY]))
        .catch(() => {});
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.unlisten?.();
        this.unlisten = undefined;
      }
    };
  };
  remember(color: string) {
    if (!recentColors([color]).length) return this.queue;
    this.queue = this.queue
      .then(async () => {
        await this.ready;
        const raw = await this.storage.local.get(RECENT_COLORS_KEY);
        const next = recentColors([color, ...recentColors(raw[RECENT_COLORS_KEY])]);
        await this.storage.local.set({ [RECENT_COLORS_KEY]: next });
        this.receive(next);
      })
      .catch(() => {});
    return this.queue;
  }
}
