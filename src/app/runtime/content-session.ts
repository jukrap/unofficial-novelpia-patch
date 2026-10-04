import type { ViewerPreparation } from './bootstrap';

export interface ViewerSession {
  ready: Promise<void>;
  stop(): void;
}

interface StartupPort {
  valid(): boolean;
  load(attempt: number): Promise<{
    startViewer(valid: () => boolean, preparation: ViewerPreparation): ViewerSession;
  }>;
  bodyReady(): Promise<void>;
  preparation: ViewerPreparation;
}

/** One live reader per document. Startup failures must not become a permanent native view. */
export function startContentSession(port: StartupPort) {
  let disposed = false;
  let phase: 'waiting' | 'starting' | 'running' = 'waiting';
  let attempt = 0;
  let session: ViewerSession | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const delays = [300, 1000, 3000];
  const valid = () => !disposed && port.valid();
  const start = async () => {
    if (!valid() || phase !== 'waiting' || attempt > delays.length) return;
    clearTimeout(timer);
    phase = 'starting';
    const current = attempt++;
    try {
      const runtime = await port.load(current);
      if (!valid()) return;
      await port.bodyReady();
      if (!valid()) return;
      session = runtime.startViewer(valid, port.preparation);
      await session.ready;
      if (valid()) phase = 'running';
    } catch {
      session?.stop();
      session = undefined;
      // Fail open immediately; a retry must not cover a page the user can already read.
      port.preparation.dispose();
      phase = 'waiting';
      if (valid() && current < delays.length)
        timer = setTimeout(() => void start(), delays[current]);
    }
  };
  void start();
  return {
    // pageshow/visibility can resume a pending retry after a restored background tab wakes.
    wake() {
      void start();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      port.preparation.dispose();
      session?.stop();
    },
  };
}
