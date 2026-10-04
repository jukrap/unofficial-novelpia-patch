import type { StoragePort } from '@/shared/platform/storage';
import { parseAnchor, type ReadingAnchor } from './anchor';

export interface BookmarkState {
  anchor: ReadingAnchor | null;
  legacy: number | null;
  ready: boolean;
  error: string;
}
export class BookmarkStore {
  private snapshot: BookmarkState = { anchor: null, legacy: null, ready: false, error: '' };
  private listeners = new Set<() => void>();
  private stop = () => {};
  private disposed = false;
  private key: string;
  constructor(
    private episode: string,
    private storage: StoragePort,
    private legacy: { read: () => string | null; clear: () => void }
  ) {
    this.key = `unp.bookmark.v1.${episode}`;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<BookmarkState>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private valid(value: unknown) {
    const anchor = parseAnchor(value);
    return anchor?.episodeId === this.episode ? anchor : null;
  }
  async initialize() {
    this.stop();
    try {
      const raw = await this.storage.local.get(this.key);
      const old = Number(this.legacy.read());
      if (this.disposed) return;
      this.publish({
        anchor: this.valid(raw[this.key]),
        legacy: Number.isInteger(old) && old > 0 && old < 1e8 ? old : null,
        ready: true,
      });
      this.stop = this.storage.listen((changes, area) => {
        if (area === 'local' && changes[this.key])
          this.publish({ anchor: this.valid(changes[this.key]?.newValue) });
      });
    } catch {
      this.publish({ ready: true, error: '북마크를 불러오지 못했습니다.' });
    }
  }
  async save(anchor: ReadingAnchor | null) {
    if (!this.snapshot.ready) return;
    const valid = this.valid(anchor);
    if (!valid) {
      this.publish({ error: '본문이 보이는 위치에서 북마크를 저장해 주세요.' });
      return;
    }
    try {
      await this.storage.local.set({ [this.key]: valid });
      this.publish({ anchor: valid, error: '' });
    } catch {
      this.publish({ error: '북마크를 저장하지 못했습니다.' });
    }
  }
  async clear() {
    if (!this.snapshot.ready) return;
    try {
      await this.storage.local.remove(this.key);
      this.legacy.clear();
      this.publish({ anchor: null, legacy: null, error: '' });
    } catch {
      this.publish({ error: '북마크를 지우지 못했습니다.' });
    }
  }
  dispose() {
    this.disposed = true;
    this.stop();
    this.listeners.clear();
  }
}
