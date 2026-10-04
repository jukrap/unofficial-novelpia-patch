export interface DecodedImageResource {
  url: string;
  bytes: number;
  dispose(): void;
}
export interface DecodedImageLease {
  url: string;
  reused: boolean;
  release(): void;
}
interface Entry {
  key: string;
  controller: AbortController;
  promise: Promise<DecodedImageResource>;
  resource?: DecodedImageResource;
  users: number;
  touched: number;
  retired: boolean;
}
const cancelled = () => new DOMException('이미지 불러오기를 취소했습니다.', 'AbortError');

/** Active consumers own leases; a bounded idle cache keeps a decoded image across tab re-entry. */
export class DecodedImageCache {
  private entries = new Map<string, Entry>();
  private clock = 0;
  constructor(
    private idleLimit = 8,
    private byteLimit = 64 * 1024 * 1024
  ) {}

  acquireReady(key: string): DecodedImageLease | null {
    const entry = this.entries.get(key);
    if (!entry?.resource) return null;
    entry.users++;
    entry.touched = ++this.clock;
    return this.lease(entry, true);
  }

  acquire(
    key: string,
    load: (signal: AbortSignal) => Promise<DecodedImageResource>,
    signal?: AbortSignal
  ): Promise<DecodedImageLease> {
    if (signal?.aborted) return Promise.reject(cancelled());
    let entry = this.entries.get(key);
    const reused = Boolean(entry?.resource);
    if (!entry) {
      const controller = new AbortController();
      entry = {
        key,
        controller,
        users: 0,
        touched: ++this.clock,
        retired: false,
        promise: Promise.resolve().then(() => load(controller.signal)),
      };
      const created = entry;
      created.promise = created.promise.then(
        (resource) => {
          if (created.retired) {
            resource.dispose();
            throw cancelled();
          }
          created.resource = resource;
          this.trim();
          return resource;
        },
        (error: unknown) => {
          this.retire(created);
          throw error;
        }
      );
      this.entries.set(key, created);
    }
    const current = entry;
    current.users++;
    current.touched = ++this.clock;
    return new Promise((resolve, reject) => {
      let waiting = true;
      const abort = () => {
        if (!waiting) return;
        waiting = false;
        signal?.removeEventListener('abort', abort);
        this.release(current);
        reject(cancelled());
      };
      signal?.addEventListener('abort', abort, { once: true });
      void current.promise.then(
        () => {
          if (!waiting) return;
          waiting = false;
          signal?.removeEventListener('abort', abort);
          resolve(this.lease(current, reused));
        },
        (error: unknown) => {
          if (!waiting) return;
          waiting = false;
          signal?.removeEventListener('abort', abort);
          this.release(current);
          reject(error);
        }
      );
    });
  }

  invalidate(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.retire(entry);
  }

  clear(): void {
    for (const entry of this.entries.values()) this.retire(entry);
  }

  private lease(entry: Entry, reused: boolean): DecodedImageLease {
    let released = false;
    return {
      url: entry.resource!.url,
      reused,
      release: () => {
        if (released) return;
        released = true;
        this.release(entry);
      },
    };
  }

  private release(entry: Entry): void {
    entry.users--;
    entry.touched = ++this.clock;
    if (!entry.users && (entry.retired || !entry.resource)) this.retire(entry);
    else this.trim();
  }

  private retire(entry: Entry): void {
    entry.retired = true;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    if (!entry.users) {
      entry.controller.abort();
      entry.resource?.dispose();
      entry.resource = undefined;
    }
  }

  private trim(): void {
    const idle = [...this.entries.values()]
      .filter((entry) => entry.resource && !entry.users)
      .sort((left, right) => left.touched - right.touched);
    let bytes = idle.reduce((sum, entry) => sum + entry.resource!.bytes, 0);
    // Keep the most recently used image even if that one image exceeds the idle budget.
    while (idle.length > this.idleLimit || (bytes > this.byteLimit && idle.length > 1)) {
      const entry = idle.shift()!;
      bytes -= entry.resource!.bytes;
      this.retire(entry);
    }
  }
}
